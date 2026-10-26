'use strict';

const crypto = require('crypto');
const { pool, withTransaction } = require('../../config/db');
const { recalcularPesoCono } = require('./peso-cono');
const { porPalabras } = require('../../utils/query');
const { AppError, enOtraTienda } = require('../../middlewares/error');
const { filtroAlmacen } = require('../permisos/service');
const { anotarAlmacen } = require('../tiempo-real/contexto');
const configuracionModel = require('../configuracion/model');

/**
 * CADA QUIEN, SUS TIENDAS (2026-10-15): agrega al WHERE el filtro de los
 * almacenes que puede ver (`almacenes` null = todos; vacío = ninguno).
 */
function _deSusTiendas(where, params, columna, almacenes) {
  const f = filtroAlmacen(columna, almacenes);
  if (!f.sql) return;
  where.push(f.sql.replace(/^ AND /, ''));
  Object.assign(params, f.params);
}

// Acceso a datos de inventario (multi-almacén) y su bitácora (kardex).
// REGLA: todo cambio de existencias = UPDATE inventario + INSERT movimiento,
// siempre dentro de una transacción (ver registrarMovimiento / crearTraspaso).

// Signo del efecto sobre las existencias según el tipo de movimiento.
// 'ajuste' es especial: la cantidad enviada es el valor absoluto objetivo.
const SIGNO = { entrada: 1, devolucion: 1, salida: -1, merma: -1 };

// Las cantidades son DECIMAL(12,3): un gramo de resolución.
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

const SELECT_STOCK = `
  SELECT i.id, i.variante_id, pv.sku, p.nombre AS producto,
         -- La pantalla agrupa las presentaciones por PRODUCTO, no por el nombre:
         -- "MARINO OSCURO 1/30" y "MARINO OSCURO 2/30" se llaman igual y son dos.
         pv.producto_id,
         pv.presentacion, pv.tipo_presentacion, pv.peso_kg,
         -- Cómo se clasifica el hilo: material, línea de procedencia y calibre.
         -- Sin esto la pantalla solo mostraba el COLOR, y el mismo color en otro
         -- calibre es otro producto.
         p.grosor_calibre AS calibre, cat.nombre AS material, lin.nombre AS linea,
         i.almacen_id, a.nombre AS almacen,
         i.cantidad, i.cantidad_reservada,
         (i.cantidad - i.cantidad_reservada) AS disponible,
         i.stock_minimo, i.stock_maximo, i.ubicacion_fisica, i.actualizado_en
    FROM inventario i
    JOIN producto_variantes pv ON pv.id = i.variante_id
    JOIN productos p           ON p.id = pv.producto_id
    JOIN categorias cat        ON cat.id = p.categoria_id
    LEFT JOIN lineas lin       ON lin.id = p.linea_id
    JOIN almacenes a           ON a.id = i.almacen_id
`;

/**
 * Qué cuenta como alerta de stock. El `stock_minimo > 0` es imprescindible: sin
 * él, una fila en CERO y sin mínimo definido (0 <= 0) se contaba como alerta, y
 * la pantalla decía cosas como "0 productos · sin existencias · 1 bajo mínimo"
 * en un almacén vacío. Sin mínimo capturado no hay nada que avisar.
 */
const COND_ALERTA = '(i.stock_minimo > 0 AND (i.cantidad - i.cantidad_reservada) <= i.stock_minimo)';

async function listarStock({ almacen_id, variante_id, q, bajo_stock, apartado, limit, offset, almacenes }) {
  const where = [];
  const params = {};
  _deSusTiendas(where, params, 'i.almacen_id', almacenes);
  if (almacen_id !== undefined) {
    where.push('i.almacen_id = :almacen_id');
    params.almacen_id = almacen_id;
  }
  if (variante_id !== undefined) {
    where.push('i.variante_id = :variante_id');
    params.variante_id = variante_id;
  }
  // Color, calibre, SKU o código, palabra por palabra ("marino 2/30"). El
  // código del bulto también cuenta: con el lector en la mano se escanea el
  // paquete para saber de qué hilo es y cuánto queda.
  const busca = porPalabras(q, [
    'pv.sku', 'pv.codigo_barras', 'p.nombre',
    { col: 'p.grosor_calibre', calibre: true },
    // EXISTS y no GROUP_CONCAT: GROUP_CONCAT se corta a 1,024 caracteres.
    (c) => `EXISTS (SELECT 1 FROM variante_codigos vc WHERE vc.variante_id = pv.id AND vc.codigo LIKE ${c})`,
  ]);
  if (busca) {
    where.push(busca.sql);
    Object.assign(params, busca.params);
  }
  if (bajo_stock) {
    where.push(COND_ALERTA);
  }
  // Solo lo que tiene algo apartado (por un cliente o por una solicitud de
  // traspaso): es lo que ya tiene dueño aunque siga en el estante.
  if (apartado) {
    where.push('i.cantidad_reservada > 0');
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `${SELECT_STOCK} ${whereSql} ORDER BY p.nombre, pv.sku LIMIT :limit OFFSET :offset`,
    { ...params, limit, offset }
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM inventario i
       JOIN producto_variantes pv ON pv.id = i.variante_id
       JOIN productos p ON p.id = pv.producto_id ${whereSql}`,
    params
  );
  return { rows, total };
}

// Tope de renglones del comparativo. Si el catálogo lo rebasa se avisa en la
// respuesta en vez de recortar en silencio.
const TOPE_RESUMEN = 300;

/**
 * Panorama de qué hay en cada almacén: un total por almacén y una matriz de
 * producto × almacén para comparar sucursales de un vistazo.
 *
 * Las cantidades no se pueden sumar todas juntas: los conos son piezas y el
 * resto son kilos, así que el total va separado.
 */
async function resumenPorAlmacen(alcance = null) {
  const fa = filtroAlmacen('a.id', alcance);
  const fi = filtroAlmacen('i.almacen_id', alcance);
  const [almacenes] = await pool.query(
    `SELECT a.id AS almacen_id, a.nombre, a.es_punto_venta, a.es_matriz,
            a.es_tienda_linea, a.activo,
            COALESCE(SUM(CASE WHEN i.cantidad > 0 THEN 1 ELSE 0 END), 0) AS skus,
            0 AS piezas,
            COALESCE(SUM(i.cantidad), 0) AS kilos,
            -- Desglose por presentación: cuánto sigue en paquete y cuánto ya se
            -- enconó. En el mostrador es la diferencia entre lo que hay que bajar
            -- y lo que ya se puede vender por cono.
            COALESCE(SUM(CASE WHEN pv.tipo_presentacion = 'cono' THEN i.cantidad ELSE 0 END), 0)
              AS kilos_cono,
            COALESCE(SUM(CASE WHEN pv.tipo_presentacion <> 'cono' THEN i.cantidad ELSE 0 END), 0)
              AS kilos_paquete,
            COALESCE(SUM(CASE WHEN ${COND_ALERTA} THEN 1 ELSE 0 END), 0) AS alertas
       FROM almacenes a
       LEFT JOIN inventario i          ON i.almacen_id = a.id
       LEFT JOIN producto_variantes pv ON pv.id = i.variante_id
      WHERE a.activo = 1${fa.sql}
      GROUP BY a.id, a.nombre, a.es_punto_venta, a.es_matriz, a.es_tienda_linea, a.activo
      ORDER BY a.es_matriz DESC, a.nombre`,
    fa.params
  );

  // Variantes con presencia en algún almacén (existencia o mínimo definido).
  const [detalle] = await pool.query(
    `SELECT i.variante_id, i.almacen_id, i.cantidad, i.stock_minimo,
            pv.sku, pv.presentacion, pv.tipo_presentacion, pv.peso_kg,
            pv.producto_id, prod.nombre AS producto,
            -- El calibre y la línea distinguen productos que se llaman igual:
            -- "MARINO OSCURO 1/30" y "MARINO OSCURO 2/30" son dos productos.
            prod.grosor_calibre AS calibre, cat.nombre AS material,
            lin.nombre AS linea
       FROM inventario i
       JOIN producto_variantes pv ON pv.id = i.variante_id
       JOIN productos prod        ON prod.id = pv.producto_id
       JOIN categorias cat        ON cat.id = prod.categoria_id
       LEFT JOIN lineas lin       ON lin.id = prod.linea_id
      WHERE (i.cantidad > 0 OR i.stock_minimo > 0)${fi.sql}
      ORDER BY prod.nombre, pv.sku`,
    fi.params
  );

  const porVariante = new Map();
  for (const d of detalle) {
    if (!porVariante.has(d.variante_id)) {
      porVariante.set(d.variante_id, {
        variante_id: d.variante_id,
        sku: d.sku,
        producto_id: d.producto_id,
        producto: d.producto,
        calibre: d.calibre,
        material: d.material,
        linea: d.linea,
        presentacion: d.presentacion,
        tipo_presentacion: d.tipo_presentacion,
        peso_kg: d.peso_kg,
        // Todo se lleva en kilos, también los conos.
        unidad: 'kg',
        existencias: {},
        total: 0,
      });
    }
    const fila = porVariante.get(d.variante_id);
    fila.existencias[d.almacen_id] = {
      cantidad: d.cantidad,
      bajo_minimo: Number(d.cantidad) <= Number(d.stock_minimo) && Number(d.stock_minimo) > 0,
    };
    fila.total = round3(fila.total + Number(d.cantidad));
  }

  const todas = [...porVariante.values()];
  return {
    almacenes,
    filas: todas.slice(0, TOPE_RESUMEN),
    truncado: todas.length > TOPE_RESUMEN,
    total_variantes: todas.length,
  };
}

/** Existencias por debajo (o al nivel) del stock mínimo, con mínimo capturado. */
async function alertas(almacenes = null) {
  const f = filtroAlmacen('i.almacen_id', almacenes);
  const [rows] = await pool.query(
    `${SELECT_STOCK} WHERE ${COND_ALERTA}${f.sql}
      ORDER BY (i.cantidad - i.cantidad_reservada) - i.stock_minimo`,
    f.params
  );
  return rows;
}

// Agrupa los movimientos como los piensa la tienda, no por el `tipo` crudo.
const FILTROS_CONCEPTO = {
  ventas: "m.referencia_tipo = 'pedido'",
  traspasos: "m.referencia_tipo = 'traspaso'",
  desarmes: "m.referencia_tipo = 'conversion'",
  // La mercancía que entra por la remesa del proveedor ES la entrada de
  // mercancía; sin ella el filtro solo mostraba las capturadas a mano.
  entradas: "m.tipo = 'entrada' AND (m.referencia_tipo IS NULL OR m.referencia_tipo IN ('remesa', 'bulto'))",
  ajustes: "m.tipo = 'ajuste'",
  mermas: "m.tipo = 'merma'",
  manuales: 'm.referencia_tipo IS NULL',
};

/**
 * El documento que originó un movimiento (venta, traspaso, desarme o remesa).
 * Lo comparten el kardex y el "último movimiento" de cada renglón de
 * existencias, para que los dos digan lo mismo de un mismo movimiento.
 */
const CAMPOS_DOCUMENTO = `
            ped.numero_pedido, ped.canal AS pedido_canal,
            tr.folio AS traspaso_folio,
            tao.nombre AS traspaso_origen, tad.nombre AS traspaso_destino,
            tr.almacen_origen_id AS traspaso_origen_id,
            cvo.sku AS conversion_paquete, cvd.sku AS conversion_cono,
            cv.codigo_bulto AS conversion_bulto,
            rem.folio AS remesa_folio,
            bm.codigo AS bulto_codigo`;

const JOINS_DOCUMENTO = `
       LEFT JOIN pedidos ped      ON m.referencia_tipo = 'pedido'
                                 AND ped.id = m.referencia_id
       LEFT JOIN traspasos tr     ON m.referencia_tipo = 'traspaso'
                                 AND tr.id = m.referencia_id
       LEFT JOIN almacenes tao    ON tao.id = tr.almacen_origen_id
       LEFT JOIN almacenes tad    ON tad.id = tr.almacen_destino_id
       LEFT JOIN variante_conversiones cv ON m.referencia_tipo = 'conversion'
                                         AND cv.id = m.referencia_id
       LEFT JOIN producto_variantes cvo ON cvo.id = cv.variante_origen_id
       LEFT JOIN producto_variantes cvd ON cvd.id = cv.variante_destino_id
       LEFT JOIN remesas rem      ON m.referencia_tipo = 'remesa'
                                 AND rem.id = m.referencia_id
       LEFT JOIN variante_codigos bm ON m.referencia_tipo = 'bulto'
                                    AND bm.id = m.referencia_id`;

const FROM_KARDEX = `
       FROM movimientos_inventario m
       JOIN producto_variantes pv ON pv.id = m.variante_id
       JOIN productos prod        ON prod.id = pv.producto_id
       JOIN unidades_medida um    ON um.id = prod.unidad_medida_id
       JOIN almacenes a           ON a.id = m.almacen_id
       LEFT JOIN usuarios u       ON u.id = m.usuario_id
       ${JOINS_DOCUMENTO}`;

async function listarMovimientos({ variante_id, almacen_id, tipo, concepto, q, desde, hasta, limit, offset, almacenes }) {
  const where = [];
  const params = {};
  _deSusTiendas(where, params, 'm.almacen_id', almacenes);
  if (concepto && FILTROS_CONCEPTO[concepto]) {
    where.push(`(${FILTROS_CONCEPTO[concepto]})`);
  }
  if (variante_id !== undefined) {
    where.push('m.variante_id = :variante_id');
    params.variante_id = variante_id;
  }
  if (almacen_id !== undefined) {
    where.push('m.almacen_id = :almacen_id');
    params.almacen_id = almacen_id;
  }
  if (tipo) {
    where.push('m.tipo = :tipo');
    params.tipo = tipo;
  }
  // Color, calibre o código, palabra por palabra. "Código" es lo que la tienda
  // tiene en la mano: el SKU, el folio del documento (POS-…, TRA-…, REM-…) o
  // el código del bulto que se bajó a conos.
  const busca = porPalabras(q, [
    'pv.sku', 'prod.nombre',
    { col: 'prod.grosor_calibre', calibre: true },
    'ped.numero_pedido', 'tr.folio', 'rem.folio', 'cv.codigo_bulto', 'bm.codigo', 'm.motivo',
  ]);
  if (busca) {
    where.push(busca.sql);
    Object.assign(params, busca.params);
  }
  // Rango de días, los dos inclusive. `hasta` se compara contra el día
  // siguiente para no perder lo que pasó ese mismo día después de las 00:00.
  if (desde) {
    where.push('m.creado_en >= :desde');
    params.desde = desde;
  }
  if (hasta) {
    where.push('m.creado_en < DATE_ADD(:hasta, INTERVAL 1 DAY)');
    params.hasta = hasta;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Se traen los datos del documento que originó el movimiento (venta,
  // traspaso o desarme) para que el kardex diga qué pasó y no solo el tipo.
  const [rows] = await pool.query(
    `SELECT m.id, m.variante_id, pv.sku, prod.nombre AS producto,
            prod.grosor_calibre AS calibre,
            m.almacen_id, a.nombre AS almacen,
            m.tipo, m.cantidad, m.costo_unitario, m.referencia_tipo, m.referencia_id,
            m.usuario_id, u.nombre AS usuario, m.motivo, m.creado_en,
            ${CAMPOS_DOCUMENTO},
            CASE pv.tipo_presentacion
              WHEN 'paquete' THEN 'kg'
              WHEN 'cono'    THEN 'kg'
              ELSE um.abreviatura
            END AS unidad,
            pv.tipo_presentacion, pv.peso_kg
       ${FROM_KARDEX}
       ${whereSql}
      ORDER BY m.creado_en DESC, m.id DESC
      LIMIT :limit OFFSET :offset`,
    { ...params, limit, offset }
  );
  // El conteo lleva las mismas uniones: la búsqueda mira el folio del
  // documento, que vive en otra tabla. Son uniones de uno a uno, no multiplican.
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total ${FROM_KARDEX} ${whereSql}`,
    params
  );
  return { rows, total };
}

/**
 * El ÚLTIMO movimiento del kardex de cada renglón de existencias (variante +
 * almacén), con su documento. `inventario.actualizado_en` no sirve para esto:
 * cambia también al apartar o al fijar el mínimo, y la pantalla diría
 * "último movimiento: hoy" de un hilo que nadie movió.
 *
 * Una sola consulta para toda la página: el IN por las dos columnas trae de
 * más (otras combinaciones de variante y almacén) y el service se queda solo
 * con las parejas que pidió.
 */
async function ultimosMovimientos(filas) {
  if (!filas.length) return [];
  const variantes = [...new Set(filas.map((f) => f.variante_id))];
  const almacenes = [...new Set(filas.map((f) => f.almacen_id))];
  const [rows] = await pool.query(
    `SELECT m.id, m.variante_id, m.almacen_id, m.tipo, m.cantidad, m.motivo, m.creado_en,
            m.referencia_tipo, m.referencia_id,
            ${CAMPOS_DOCUMENTO}
       FROM movimientos_inventario m
       JOIN (SELECT MAX(id) AS id FROM movimientos_inventario
              WHERE variante_id IN (:variantes) AND almacen_id IN (:almacenes)
              GROUP BY variante_id, almacen_id) ult ON ult.id = m.id
       ${JOINS_DOCUMENTO}`,
    { variantes, almacenes }
  );
  return rows;
}

/** Lee existencias de una variante en un almacén (0 si no hay fila). */
async function _leerCantidad(conn, variante_id, almacen_id) {
  const [rows] = await conn.query(
    `SELECT id, cantidad, cantidad_reservada FROM inventario
      WHERE variante_id = :variante_id AND almacen_id = :almacen_id FOR UPDATE`,
    { variante_id, almacen_id }
  );
  return rows[0] || null;
}

/**
 * Mueve lo APARTADO de una variante en un almacén. Positivo aparta, negativo
 * libera; nunca baja de cero (la columna lo prohíbe).
 *
 * El apartado es BLANDO: lo usa la solicitud de traspaso para que se vea que esos
 * kilos ya están prometidos, pero la venta de mostrador NO lo respeta —el cliente
 * que está enfrente manda— así que puede quedar por encima de la existencia. El
 * envío lo revalida y ahí sale el problema, no antes.
 */
async function _moverReserva(conn, variante_id, almacen_id, delta) {
  const fila = await _leerCantidad(conn, variante_id, almacen_id);
  const actual = fila ? Number(fila.cantidad_reservada) : 0;
  const nueva = Math.max(0, round3(actual + delta));
  await conn.query(
    `INSERT INTO inventario (variante_id, almacen_id, cantidad, cantidad_reservada)
     VALUES (:variante_id, :almacen_id, 0, :nueva)
     ON DUPLICATE KEY UPDATE cantidad_reservada = :nueva`,
    { variante_id, almacen_id, nueva }
  );
  return nueva;
}

/** Aplica un nuevo saldo (upsert) a la fila de inventario. */
async function _aplicarSaldo(conn, variante_id, almacen_id, nuevo) {
  await conn.query(
    `INSERT INTO inventario (variante_id, almacen_id, cantidad)
     VALUES (:variante_id, :almacen_id, :nuevo)
     ON DUPLICATE KEY UPDATE cantidad = :nuevo`,
    { variante_id, almacen_id, nuevo }
  );
}

async function _insertarMovimiento(conn, mov) {
  anotarAlmacen(mov.almacen_id);
  const [r] = await conn.query(
    `INSERT INTO movimientos_inventario
       (variante_id, almacen_id, tipo, cantidad, costo_unitario,
        referencia_tipo, referencia_id, usuario_id, motivo)
     VALUES
       (:variante_id, :almacen_id, :tipo, :cantidad, :costo_unitario,
        :referencia_tipo, :referencia_id, :usuario_id, :motivo)`,
    mov
  );
  return r.insertId;
}

/**
 * Registra un movimiento simple (entrada/salida/ajuste/devolucion/merma) en un
 * solo almacén. `cantidad` es magnitud positiva salvo en 'ajuste', donde es el
 * valor absoluto objetivo. El movimiento guarda el delta con signo.
 */
async function registrarMovimiento(datos, usuarioId) {
  const { variante_id, almacen_id, tipo, cantidad } = datos;
  return withTransaction(async (conn) => {
    const fila = await _leerCantidad(conn, variante_id, almacen_id);
    const actual = fila ? Number(fila.cantidad) : 0;

    let delta;
    if (tipo === 'ajuste') {
      delta = cantidad - actual; // llevar el saldo al valor contado
    } else {
      delta = SIGNO[tipo] * cantidad;
    }

    const nuevo = actual + delta;
    if (nuevo < 0) {
      // Dice de qué hilo, dónde y qué hacer (2026-10-19); antes: "hay 12.5, se
      // intenta descontar 20", sin unidad ni hilo.
      const [[d]] = await conn.query(
        `SELECT p.nombre, p.grosor_calibre AS calibre, a.nombre AS almacen
           FROM producto_variantes pv JOIN productos p ON p.id = pv.producto_id, almacenes a
          WHERE pv.id = :variante_id AND a.id = :almacen_id`,
        { variante_id, almacen_id }
      );
      const hilo = d ? `${d.nombre}${d.calibre ? ' ' + d.calibre : ''}` : 'ese hilo';
      throw new AppError(409, 'STOCK_INSUFICIENTE',
        `En «${d?.almacen ?? 'ese almacén'}» hay ${round3(actual)} kg de ${hilo}: no se pueden sacar ` +
        `${round3(Math.abs(delta))} kg. Si contaste otra cantidad, usa «Ajuste» con lo que contaste.`);
    }

    await _aplicarSaldo(conn, variante_id, almacen_id, nuevo);
    const movId = await _insertarMovimiento(conn, {
      variante_id,
      almacen_id,
      tipo,
      cantidad: delta,
      costo_unitario: datos.costo_unitario ?? null,
      referencia_tipo: datos.referencia_tipo ?? null,
      referencia_id: datos.referencia_id ?? null,
      usuario_id: usuarioId ?? null,
      motivo: datos.motivo ?? null,
    });

    return { movimiento_id: movId, variante_id, almacen_id, tipo, delta, saldo_anterior: actual, saldo_nuevo: nuevo };
  });
}

/**
 * Desarma paquetes y los convierte en conos.
 *
 * Consume `paquetes × peso_kg` kilos de la variante paquete en el almacén de
 * origen y da entrada a `paquetes × piezas_por_origen` conos en el destino
 * (normalmente el mostrador). Deja en el kardex una salida y una entrada
 * ligadas por el mismo folio de `variante_conversiones`.
 */
/**
 * Cuánto pesa "un paquete" de una variante en un almacén, para pedir por
 * paquetes: el PROMEDIO real de los bultos que hay ahí, o el peso del catálogo
 * si no hay ninguno con peso (`nominal: true`).
 *
 * Es un promedio y no "los N más antiguos" porque quien surte agarra los
 * paquetes de ese color y calibre que tenga a la mano, no los busca por fecha
 * (usuario, 2026-10-06). N paquetes son, más o menos, N × este peso: eso se
 * aparta al solicitar y eso sale al enviar. La pantalla usa la MISMA cifra
 * (`peso_referencia` de `GET /inventario/equivalencia-paquetes`), así lo que
 * enseña es lo que valida el servidor.
 */
async function pesoPorPaquete(conn, v, almacenId) {
  const [[f]] = await (conn ?? pool).query(
    `SELECT COUNT(*) AS paquetes, COALESCE(SUM(peso_kg), 0) AS kg FROM variante_codigos
      WHERE variante_id = :v AND almacen_id = :a AND estado = 'disponible'
        AND peso_kg IS NOT NULL`,
    { v: v.id, a: almacenId }
  );
  const paquetes = Number(f?.paquetes ?? 0);
  const kg = round3(f?.kg ?? 0);
  if (paquetes > 0 && kg > 0) {
    return {
      peso: round3(kg / paquetes),
      nominal: false,
      // Se multiplica por kg ÷ paquetes SIN redondear: con el promedio a tres
      // decimales, pedir TODOS los paquetes daba unos gramos más de los que hay
      // y no dejaba (683 × 18.963 > 12,951.4). La pantalla hace igual.
      kilos: (n) => round3((n * kg) / paquetes),
    };
  }
  const nominal = round3(v.peso_kg ?? 0);
  return { peso: nominal, nominal: true, kilos: (n) => round3(n * nominal) };
}

/**
 * Cuántos paquetes hay de una variante en un almacén y cuánto pesan de verdad.
 * Con esto la pantalla puede decir "100 kg ≈ 5 paquetes" usando el peso REAL
 * promedio y no el nominal, que nunca corresponde.
 */
async function disponibilidadEnPaquetes(varianteId, almacenId) {
  const [[fila]] = await pool.query(
    `SELECT COUNT(*) AS paquetes, COALESCE(SUM(peso_kg), 0) AS kg,
            COALESCE(AVG(peso_kg), 0) AS promedio,
            COALESCE(MIN(peso_kg), 0) AS minimo, COALESCE(MAX(peso_kg), 0) AS maximo
       FROM variante_codigos
      WHERE variante_id = :v AND almacen_id = :a AND estado = 'disponible'
        AND peso_kg IS NOT NULL`,
    { v: varianteId, a: almacenId }
  );
  const [[saldo]] = await pool.query(
    `SELECT COALESCE(cantidad, 0) AS kg, COALESCE(cantidad_reservada, 0) AS apartado
       FROM inventario WHERE variante_id = :v AND almacen_id = :a`,
    { v: varianteId, a: almacenId }
  );
  const kgInventario = round3(saldo?.kg ?? 0);
  const kgApartado = round3(saldo?.apartado ?? 0);
  return {
    paquetes: Number(fila.paquetes),
    kg_en_bultos: round3(fila.kg),
    peso_promedio: round3(fila.promedio),
    peso_min: round3(fila.minimo),
    peso_max: round3(fila.maximo),
    // El saldo de inventario puede diferir de la suma de bultos: hay mercancía
    // que entró sin bultos (captura manual) o bultos sin ubicar.
    kg_inventario: kgInventario,
    // Lo que ya tiene dueño: apartados de clientes y otras solicitudes de
    // traspaso. La solicitud se valida contra lo LIBRE, así que la pantalla
    // tiene que enseñar lo libre y no la existencia: si no, dice "hay 200 kg",
    // se piden 150 y el servidor contesta que no alcanza.
    kg_apartado: kgApartado,
    kg_libre: round3(Math.max(0, kgInventario - kgApartado)),
  };
}

/** El cono que sale de un paquete, o null si todavía no se ha dado de alta. */
async function conoDe(paqueteId) {
  const [rows] = await pool.query(
    `SELECT id, sku, piezas_por_origen, precio, modo_precio
       FROM producto_variantes
      WHERE origen_variante_id = :id AND tipo_presentacion = 'cono' AND activo = 1
      ORDER BY id LIMIT 1`,
    { id: paqueteId }
  );
  return rows[0] || null;
}

/** En qué almacenes hay existencias de una variante, para proponer el origen. */
async function existenciasDe(varianteId, almacenes = null) {
  const f = filtroAlmacen('i.almacen_id', almacenes);
  const [rows] = await pool.query(
    `SELECT i.almacen_id, a.nombre AS almacen, i.cantidad
       FROM inventario i
       JOIN almacenes a ON a.id = i.almacen_id
      WHERE i.variante_id = :id AND i.cantidad > 0${f.sql}
      ORDER BY i.cantidad DESC`,
    { id: varianteId, ...f.params }
  );
  return rows;
}

/**
 * Dónde está un bulto según el sistema, y si viene EN CAMINO en un traspaso
 * enviado y todavía no recibido (el envío ya lo apunta al destino). Para bajar
 * conos el paquete tiene que estar en la tienda (usuario, 2026-10-06).
 */
async function ubicacionBulto(ejecutor, bultoId) {
  const [[u]] = await (ejecutor ?? pool).query(
    `SELECT vc.almacen_id, a.nombre AS almacen, a.es_punto_venta,
            (SELECT t.folio
               FROM traspaso_bultos tb
               JOIN traspaso_detalle td ON td.id = tb.detalle_id
               JOIN traspasos t         ON t.id = td.traspaso_id
              WHERE tb.variante_codigo_id = vc.id AND t.estado = 'en_transito'
              ORDER BY t.id DESC LIMIT 1) AS en_camino_folio
       FROM variante_codigos vc
       LEFT JOIN almacenes a ON a.id = vc.almacen_id
      WHERE vc.id = :id`,
    { id: bultoId }
  );
  return u ?? null;
}

async function desarmar(datos, usuarioId) {
  const { cono_variante_id, almacen_origen_id, almacen_destino_id, paquetes } = datos;

  return withTransaction(async (conn) => {
    // LOS CONOS SOLO SE BAJAN EN UNA TIENDA (2026-10-06: "solo se pueden bajar
    // conos en tiendas, en bodega eso no se puede"). Y el paquete se abre donde
    // está: si sigue en la bodega, primero va a la tienda por un traspaso —el
    // único camino entre almacenes—, no se brinca con el desarme.
    const [[tienda]] = await conn.query(
      'SELECT id, nombre, es_punto_venta FROM almacenes WHERE id = :id', { id: almacen_destino_id }
    );
    if (!tienda) throw new AppError(422, 'ALMACEN_INVALIDO', 'Ese almacén no existe');
    if (!Number(tienda.es_punto_venta)) {
      throw new AppError(422, 'SOLO_EN_TIENDA',
        `Los conos se bajan en una tienda; en «${tienda.nombre}» no se puede porque no tiene mostrador.`);
    }
    if (Number(almacen_origen_id) !== Number(almacen_destino_id)) {
      throw new AppError(422, 'DESARME_EN_OTRO_ALMACEN',
        `El paquete se abre en la tienda donde está. Si está en otro almacén, primero mándalo a ` +
        `«${tienda.nombre}» con Surtir sucursal.`);
    }

    // Datos del cono y de su paquete de origen, bloqueados para no competir
    // con otra conversión simultánea.
    const [crows] = await conn.query(
      `SELECT c.id, c.sku, c.piezas_por_origen, c.origen_variante_id, c.tipo_presentacion,
              p.sku AS paquete_sku, p.peso_kg AS paquete_peso_kg,
              prod.nombre AS producto
         FROM producto_variantes c
         JOIN producto_variantes p ON p.id = c.origen_variante_id
         JOIN productos prod       ON prod.id = c.producto_id
        WHERE c.id = :id
        FOR UPDATE`,
      { id: cono_variante_id }
    );
    const cono = crows[0];
    if (!cono) {
      throw new AppError(422, 'CONO_INVALIDO',
        'Esa presentación no existe o no está ligada a un paquete');
    }
    if (cono.tipo_presentacion !== 'cono') {
      throw new AppError(422, 'NO_ES_CONO',
        `La variante ${cono.sku} no es una presentación de tipo cono`);
    }

    // Si el desarme se hizo escaneando un bulto, ese bulto se consume: no se
    // puede desarmar dos veces ni venderse después. Se bloquea antes de tocar
    // saldos para que el 409 no deje nada a medias.
    let bulto = null;
    if (datos.codigo_bulto) {
      const [brows] = await conn.query(
        'SELECT id, codigo, estado FROM variante_codigos WHERE codigo = :c LIMIT 1 FOR UPDATE',
        { c: datos.codigo_bulto }
      );
      bulto = brows[0] ?? null;
      if (!bulto) {
        throw new AppError(422, 'BULTO_DESCONOCIDO',
          `El bulto ${datos.codigo_bulto} no está registrado`);
      }
      if (bulto.estado !== 'disponible') {
        throw new AppError(409, 'BULTO_NO_DISPONIBLE', bulto.estado === 'faltante'
          ? `El bulto ${bulto.codigo} se dio por faltante al recibir un envío (no llegó); no se puede desarmar.`
          : `El bulto ${bulto.codigo} ya está ${bulto.estado}; no se puede desarmar.`);
      }
      // EL PAQUETE TIENE QUE ESTAR EN ESA TIENDA (usuario, 2026-10-06: "si no,
      // que mande una alerta de que el paquete en esa sucursal no existe"). Es
      // la misma regla que al vender (2026-10-07, pedidos/model.js →
      // _exigirPaqueteAqui): si el sistema lo tiene en otro almacén o viene en
      // camino, no se abre aquí. Sin almacén (capturado a mano) se permite: no
      // hay nada que contradiga.
      const u = await ubicacionBulto(conn, bulto.id);
      if (u?.en_camino_folio) {
        throw new AppError(409, 'PAQUETE_EN_CAMINO',
          `El paquete ${bulto.codigo} viene en camino (${u.en_camino_folio}): primero recibe el envío en Surtir sucursal.`);
      }
      if (u?.almacen_id != null && Number(u.almacen_id) !== Number(almacen_destino_id)) {
        throw enOtraTienda(new AppError(409, 'PAQUETE_EN_OTRA_SUCURSAL',
          `El paquete ${bulto.codigo} no está en «${tienda.nombre}»: el sistema lo tiene en «${u.almacen}». ` +
          (Number(u.es_punto_venta)
            ? 'Bájalo en esa tienda, o mándalo con Surtir sucursal.'
            : 'Primero mándalo a la tienda con Surtir sucursal.')),
        [u.almacen_id],
        `El paquete ${bulto.codigo} no está registrado en «${tienda.nombre}»: toma uno que esté aquí.`);
      }
    }

    const pesoPaquete = Number(cono.paquete_peso_kg);
    const piezas = Number(cono.piezas_por_origen);
    // El peso del paquete puede estar pendiente si nunca llegó una remesa: aquí
    // sí hace falta, porque de él salen los kilos a descontar.
    if (!pesoPaquete || pesoPaquete <= 0) {
      throw new AppError(422, 'PAQUETE_SIN_PESO',
        `"${cono.paquete_sku}" todavía no tiene peso de paquete. Lo pone la carga del ` +
        `Excel, o captúralo en la presentación.`);
    }
    // Por omisión se consume el peso nominal del paquete, pero se puede ajustar
    // cuando el bulto real no pesó exactamente eso.
    const kgConsumidos =
      datos.kg != null ? round3(datos.kg) : round3(pesoPaquete * paquetes);
    // Igual con las piezas: hay bultos que rinden menos conos —vienen así de
    // fábrica— y darles de alta los nominales infla el inventario de conos.
    const piezasGeneradas =
      datos.conos != null ? round3(datos.conos) : round3(piezas * paquetes);
    if (kgConsumidos <= 0) {
      throw new AppError(422, 'KG_INVALIDOS', 'Los kilos a consumir deben ser mayores a cero');
    }

    // DESTARE: lo que GANA de peso el hilo al enconarse, por el tubo de cada
    // cono. Lo captura la tienda; el sistema no lo calcula porque depende del
    // tubo que se use. Solo dice cuánto pesó el resultado: del paquete sale
    // `kgConsumidos` y eso es lo que se descuenta del inventario.
    // La pantalla manda el destare DEL PAQUETE completo, `destare_kg` (2026-10-21,
    // usuario: "es el destare del paquete completo, no por conos"; del 2026-10-06
    // a esa fecha pedía el de UN cono). `destare_por_cono_kg` se sigue aceptando y
    // se multiplica por los conos que salen.
    const destareKg =
      datos.destare_por_cono_kg != null
        ? round3(Number(datos.destare_por_cono_kg) * piezasGeneradas)
        : datos.destare_kg != null ? round3(datos.destare_kg) : null;
    if (destareKg != null && destareKg < 0) {
      throw new AppError(422, 'DESTARE_INVALIDO', 'El destare no puede ser negativo');
    }
    // EL TOPE QUE PONE LA TIENDA (2026-10-20, auditoría: dos bajadas llevaban 0.8 kg
    // por cono). Es POR CONO —lo que puede pesar un tubo— y lo fija en
    // Configuración → Bajar conos; sin él, vale 1 kg por cono. Se mide igual con el
    // destare del paquete: entre sus conos (antes el total no tenía tope).
    const tope = await configuracionModel.numero('desarme_destare_max_kg', null, conn);
    const limite = tope != null && tope > 0 ? tope : 1;
    const porCono = destareKg != null && piezasGeneradas > 0 ? destareKg / piezasGeneradas : 0;
    if (porCono > limite + 0.0005) {
      const g = (kg) => `${Math.round(kg * 1000).toLocaleString('es-MX')} g`;
      throw new AppError(422, 'DESTARE_MUY_ALTO',
        `El destare del paquete es de ${destareKg} kg: con ${piezasGeneradas} conos son ${g(porCono)} por cono ` +
        `y el tope es de ${g(limite)} por cono${tope != null && tope > 0 ? ' (Configuración → Bajar conos)' : ''}. ` +
        `Para este paquete, hasta ${round3(limite * piezasGeneradas)} kg: escribe lo que pesan los tubos de todos sus conos juntos.`,
        { tope_kg: limite });
    }
    const kgEnconados = round3(kgConsumidos + (destareKg ?? 0));

    // Descuenta kilos del paquete.
    const filaPaq = await _leerCantidad(conn, cono.origen_variante_id, almacen_origen_id);
    const saldoPaq = filaPaq ? Number(filaPaq.cantidad) : 0;
    if (saldoPaq < kgConsumidos) {
      throw new AppError(409, 'STOCK_INSUFICIENTE',
        `No alcanza el paquete "${cono.producto} · ${cono.paquete_sku}": ` +
        `hay ${saldoPaq} kg y el desarme necesita ${kgConsumidos} kg.`);
    }

    const filaCono = await _leerCantidad(conn, cono_variante_id, almacen_destino_id);
    const saldoCono = filaCono ? Number(filaCono.cantidad) : 0;

    await _aplicarSaldo(conn, cono.origen_variante_id, almacen_origen_id, saldoPaq - kgConsumidos);
    // El cono entra en KILOS, ya con el destare: es el mismo hilo, solo enconado,
    // y se vende por peso. `piezasGeneradas` queda como dato informativo.
    await _aplicarSaldo(conn, cono_variante_id, almacen_destino_id, round3(saldoCono + kgEnconados));

    const [conv] = await conn.query(
      `INSERT INTO variante_conversiones
         (variante_origen_id, variante_destino_id, almacen_origen_id, almacen_destino_id,
          paquetes, kg_consumidos, destare_kg, piezas_generadas, codigo_bulto,
          usuario_id, motivo)
       VALUES (:origen, :destino, :alm_origen, :alm_destino,
               :paquetes, :kg, :destare, :piezas, :codigo_bulto, :usuario, :motivo)`,
      {
        origen: cono.origen_variante_id,
        destino: cono_variante_id,
        alm_origen: almacen_origen_id,
        alm_destino: almacen_destino_id,
        paquetes,
        kg: kgConsumidos,
        destare: destareKg,
        piezas: piezasGeneradas,
        codigo_bulto: datos.codigo_bulto ?? null,
        usuario: usuarioId ?? null,
        motivo: datos.motivo ?? null,
      }
    );

    // El bulto queda consumido: se convirtió en conos. Y se corrige su ubicación
    // al almacén de donde de verdad salió: el traspaso asigna bultos por FIFO,
    // pero quien surte se lleva los que tiene a mano, así que lo que vale es
    // dónde se escaneó.
    if (bulto) {
      await conn.query(
        `UPDATE variante_codigos
            SET estado = 'desarmado', consumido_en = NOW(),
                consumido_tipo = 'conversion', consumido_id = :conv,
                almacen_id = :almacen
          WHERE id = :id`,
        { conv: conv.insertId, id: bulto.id, almacen: almacen_origen_id }
      );
    }

    // Kardex: los dos lados comparten folio para poder reconstruir el desarme.
    const base = {
      costo_unitario: null,
      referencia_tipo: 'conversion',
      referencia_id: conv.insertId,
      usuario_id: usuarioId ?? null,
    };
    await _insertarMovimiento(conn, {
      ...base,
      variante_id: cono.origen_variante_id,
      almacen_id: almacen_origen_id,
      tipo: 'salida',
      cantidad: -kgConsumidos,
      motivo:
        datos.motivo ??
        `Desarme de ${paquetes} paquete(s) (${kgConsumidos} kg) en ${piezasGeneradas} cono(s)` +
        (destareKg ? ` · quedan ${kgEnconados} kg enconados (+${destareKg} de destare)` : ''),
    });
    await _insertarMovimiento(conn, {
      ...base,
      variante_id: cono_variante_id,
      almacen_id: almacen_destino_id,
      tipo: 'entrada',
      cantidad: kgEnconados,
      motivo:
        datos.motivo ??
        `Enconado de ${paquetes} paquete(s) de ${cono.paquete_sku}: ${piezasGeneradas} cono(s)` +
        (destareKg
          ? ` · ${kgConsumidos} kg + ${destareKg} de destare` +
            (datos.destare_por_cono_kg != null ? ` (${round3(datos.destare_por_cono_kg)} kg por cono)` : '')
          : ''),
    });

    // EL PESO DE UN CONO se rehace con esta bajada (2026-10-19): lo que pesaron
    // sus conos —el paquete escaneado más su destare— entre cuántos salieron,
    // con todas las bajadas. Con él se sabe cuántos conos hay (peso-cono.js).
    await recalcularPesoCono(conn, cono_variante_id);

    return {
      conversion_id: conv.insertId,
      destare_kg: destareKg,
      destare_por_cono_kg: datos.destare_por_cono_kg != null ? round3(datos.destare_por_cono_kg) : null,
      kg_enconados: kgEnconados,
      producto: cono.producto,
      paquetes,
      kg_consumidos: kgConsumidos,
      kg_nominales: round3(pesoPaquete * paquetes),
      piezas_generadas: piezasGeneradas,
      paquete: {
        variante_id: cono.origen_variante_id,
        sku: cono.paquete_sku,
        almacen_id: almacen_origen_id,
        saldo_nuevo: round3(saldoPaq - kgConsumidos),
      },
      cono: {
        variante_id: cono_variante_id,
        sku: cono.sku,
        almacen_id: almacen_destino_id,
        saldo_nuevo: round3(saldoCono + kgEnconados),
      },
    };
  });
}

/** Datos de la variante que necesita un traspaso, con su validación básica. */
async function _varianteParaTraspaso(conn, varianteId) {
  const [rows] = await conn.query(
    `SELECT pv.id, pv.sku, pv.tipo_presentacion, pv.peso_kg, pv.activo,
            prod.nombre AS producto, prod.grosor_calibre AS calibre
       FROM producto_variantes pv
       JOIN productos prod ON prod.id = pv.producto_id
      WHERE pv.id = :id`,
    { id: varianteId }
  );
  const v = rows[0];
  if (!v) throw new AppError(422, 'VARIANTE_INVALIDA', `La variante ${varianteId} no existe`);
  if (!v.activo) {
    throw new AppError(422, 'VARIANTE_INACTIVA', `"${v.producto} · ${v.sku}" está inactiva`);
  }
  // La sucursal se surte con PAQUETES cerrados; los conos nacen allá, al
  // desarmarlos. Mandar conos sería mover piezas ya abiertas y no tiene sentido.
  if (v.tipo_presentacion === 'cono') {
    throw new AppError(422, 'NO_SE_TRASPASAN_CONOS',
      `"${v.producto} · ${v.sku}" es un cono: a la sucursal se le manda el paquete y allá se ` +
      `desarma. Elige la presentación de paquete.`);
  }
  return v;
}

/**
 * SOLICITAR un traspaso: el documento con folio y sus líneas, sin mover nada.
 *
 * Antes el traspaso era inmediato —salía y entraba en la misma transacción—; el
 * usuario pidió el 2026-07-28 modelar el camino, con acuse de quien recibe.
 *
 * Aquí solo se valida y se APARTA en el origen. La mercancía sale al enviar y
 * entra al recibir. Cuando la variante es un paquete la línea llega en PAQUETES y
 * se convierte a kilos, que es como se lleva el inventario: la conversión usa los
 * bultos que de verdad hay (su peso real) y cae al nominal si no hay ubicados.
 */
async function solicitarTraspaso(datos, usuarioId, { aCiegas = false } = {}) {
  const { almacen_origen_id, almacen_destino_id, items } = datos;
  if (almacen_origen_id === almacen_destino_id) {
    throw new AppError(422, 'ALMACENES_IGUALES', 'El origen y el destino deben ser distintos');
  }

  return withTransaction(async (conn) => {
    const folio = `TRA-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const [t] = await conn.query(
      `INSERT INTO traspasos
         (folio, almacen_origen_id, almacen_destino_id, estado, usuario_id, notas)
       VALUES (:folio, :origen, :destino, 'solicitado', :usuario, :notas)`,
      {
        folio,
        origen: almacen_origen_id,
        destino: almacen_destino_id,
        usuario: usuarioId ?? null,
        notas: datos.notas ?? null,
      }
    );
    const traspasoId = t.insertId;
    const lineas = [];

    for (const item of items) {
      const v = await _varianteParaTraspaso(conn, item.variante_id);
      const esPaquete = v.tipo_presentacion === 'paquete';

      let paquetes = null;
      let cantidad;
      let estimado = false;
      if (esPaquete && item.paquetes != null) {
        if (!v.peso_kg || Number(v.peso_kg) <= 0) {
          throw new AppError(422, 'PAQUETE_SIN_PESO',
            `"${v.producto} · ${v.sku}" no tiene peso de paquete configurado`);
        }
        paquetes = Number(item.paquetes);
        // N × el peso promedio de los paquetes del origen: quien surte agarra los
        // que tenga a la mano, así que es un aproximado y se dice así.
        const ref = await pesoPorPaquete(conn, v, almacen_origen_id);
        cantidad = ref.kilos(paquetes);
        estimado = ref.nominal;
      } else if (item.cantidad != null) {
        cantidad = round3(item.cantidad);
      } else {
        throw new AppError(422, 'CANTIDAD_REQUERIDA',
          `Indica cuánto mandar de "${v.producto} · ${v.sku}"`);
      }
      if (cantidad <= 0) {
        throw new AppError(422, 'CANTIDAD_INVALIDA', 'Las cantidades deben ser mayores a cero');
      }

      // Se mide contra lo DISPONIBLE (existencia menos lo ya apartado a otras
      // solicitudes): así dos sucursales no se pelean los mismos kilos.
      const fila = await _leerCantidad(conn, v.id, almacen_origen_id);
      const saldo = fila ? Number(fila.cantidad) : 0;
      const apartado = fila ? Number(fila.cantidad_reservada) : 0;
      const libre = round3(saldo - apartado);
      // A CIEGAS (2026-10-15, "nada de la Matriz"): quien pide para SU tienda no
      // ve lo que hay en el origen, así que no se le rechaza ni se le dice cuánto
      // hay. Se aparta lo pedido (el apartado es blando) y al surtir sale lo que
      // haya ("se manda lo que hay").
      if (!aCiegas && libre < cantidad) {
        throw new AppError(409, 'STOCK_INSUFICIENTE',
          `No alcanza "${v.producto} · ${v.sku}": en el origen hay ${saldo} kg` +
          (apartado > 0 ? ` (${apartado} kg ya apartados a otra solicitud)` : '') +
          `, quedan ${libre} kg libres y se piden ${cantidad} kg.`);
      }

      await _moverReserva(conn, v.id, almacen_origen_id, cantidad);

      const [d] = await conn.query(
        `INSERT INTO traspaso_detalle
            (traspaso_id, variante_id, paquetes_solicitados, cantidad_solicitada, paquetes, cantidad)
         VALUES (:traspaso_id, :variante_id, :paquetes, :cantidad, :paquetes, :cantidad)`,
        { traspaso_id: traspasoId, variante_id: v.id, paquetes, cantidad }
      );

      lineas.push({
        detalle_id: d.insertId,
        variante_id: v.id,
        sku: v.sku,
        producto: v.producto,
        paquetes,
        cantidad,
        unidad: 'kg',
        peso_estimado: estimado,
        peso_nominal: esPaquete && v.peso_kg ? round3(paquetes * Number(v.peso_kg)) : null,
        ...(aCiegas ? {} : { saldo_origen: saldo, apartado_origen: round3(apartado + cantidad) }),
      });
    }

    return {
      id: traspasoId,
      folio,
      estado: 'solicitado',
      almacen_origen_id,
      almacen_destino_id,
      lineas,
    };
  });
}

/**
 * Los paquetes ESCANEADOS al surtir, bloqueados y revisados. Al surtir se
 * escanea cada paquete que sube a la camioneta (usuario, 2026-10-06: "aquí
 * cuando se surte sí se escanean los paquetes que salen"), así que se sabe cuáles
 * son y cuánto pesan de verdad.
 *
 * Se exige que esté disponible, que tenga peso, que sea de un hilo del traspaso
 * y que no venga EN CAMINO en otro envío (409 PAQUETE_EN_CAMINO: todavía va en
 * la camioneta). Uno ya APARTADO para este mismo traspaso (se guardó a medio
 * surtir) sí vale. Si el sistema lo tiene en OTRO almacén, eso lo resuelve
 * `_traerAlOrigen` (trae `almacen_id` y `almacen`).
 */
async function _bultosEscaneados(conn, codigos, variantesDelTraspaso, nombreDe, traspasoId = null) {
  const limpios = codigos.map((c) => String(c).trim()).filter(Boolean);
  const vistos = new Set();
  for (const c of limpios) {
    if (vistos.has(c)) {
      throw new AppError(422, 'BULTO_REPETIDO', `El paquete ${c} está escaneado dos veces.`);
    }
    vistos.add(c);
  }
  if (!limpios.length) return [];

  const [rows] = await conn.query(
    `SELECT vc.id, vc.variante_id, vc.codigo, vc.peso_kg, vc.lote, vc.estado, vc.consumido_tipo, vc.consumido_id,
            ped.numero_pedido AS pedido_folio, tra.folio AS traspaso_folio,
            vc.almacen_id, alm.nombre AS almacen,
            (SELECT t2.folio
               FROM traspaso_bultos tb2
               JOIN traspaso_detalle td2 ON td2.id = tb2.detalle_id
               JOIN traspasos t2         ON t2.id = td2.traspaso_id
              WHERE tb2.variante_codigo_id = vc.id AND t2.estado = 'en_transito'
              ORDER BY t2.id DESC LIMIT 1) AS en_camino_folio
       FROM variante_codigos vc
       LEFT JOIN pedidos ped   ON vc.consumido_tipo = 'pedido' AND ped.id = vc.consumido_id
       LEFT JOIN traspasos tra ON vc.consumido_tipo = 'traspaso' AND tra.id = vc.consumido_id
       LEFT JOIN almacenes alm ON alm.id = vc.almacen_id
      WHERE vc.codigo IN (:c) FOR UPDATE`,
    { c: limpios }
  );
  const porCodigo = new Map(rows.map((r) => [r.codigo, r]));
  for (const c of limpios) {
    const b = porCodigo.get(c);
    if (!b) {
      const [[pres]] = await conn.query(
        'SELECT id FROM producto_variantes WHERE codigo_barras = :c LIMIT 1',
        { c }
      );
      throw pres
        ? new AppError(422, 'CODIGO_NO_ES_PAQUETE',
          `El código ${c} es el de la presentación, no el de un paquete: escanea la etiqueta del paquete.`)
        : new AppError(422, 'CODIGO_DESCONOCIDO', `El código ${c} no está registrado.`);
    }
    if (!variantesDelTraspaso.has(Number(b.variante_id))) {
      throw new AppError(422, 'BULTO_NO_ES_DEL_TRASPASO',
        `El paquete ${c} es de otro hilo: no está en este traspaso.`);
    }
    const delMismo = b.estado === 'apartado' && b.consumido_tipo === 'traspaso' &&
      traspasoId != null && Number(b.consumido_id) === Number(traspasoId);
    if (b.estado !== 'disponible' && !delMismo) {
      const apartadoPara = b.consumido_tipo === 'traspaso'
        ? `está apartado para el envío ${b.traspaso_folio ?? ''} a otra sucursal`
        : `está apartado para ${b.pedido_folio ? 'el pedido ' + b.pedido_folio : 'un pedido de un cliente'}`;
      const que = {
        vendido: 'ya se vendió', desarmado: 'ya se bajó a conos', apartado: apartadoPara,
        faltante: 'se dio por faltante al recibir un envío (no llegó)',
      };
      throw enOtraTienda(new AppError(409, 'BULTO_NO_DISPONIBLE',
        `El paquete ${c} de ${nombreDe(b.variante_id)} ${que[b.estado] ?? 'no está disponible'}.`),
      [b.almacen_id], `El paquete ${c} no está disponible en esta tienda: escanea otro.`);
    }
    if (b.peso_kg == null || Number(b.peso_kg) <= 0) {
      throw new AppError(422, 'BULTO_SIN_PESO',
        `El paquete ${c} no tiene peso registrado: no se puede saber cuánto sale.`);
    }
    if (b.en_camino_folio) {
      throw new AppError(409, 'PAQUETE_EN_CAMINO',
        `El paquete ${c} viene en camino (${b.en_camino_folio}): primero se recibe ese envío.`);
    }
  }
  return limpios.map((c) => porCodigo.get(c));
}

/**
 * Un paquete escaneado al SURTIR que el sistema tiene en OTRO almacén
 * (2026-10-07, el usuario eligió "avisar y, si confirman que sí está aquí,
 * pasarlo con sus kilos"). Si quien surte lo tiene en la mano, ahí está: antes
 * el envío lo aceptaba y le cambiaba la ubicación, pero los kilos salían del
 * origen y se quedaban en el otro almacén, y los dos quedaban "no cuadra".
 *
 *   · Sin confirmar (no viene en `encontrados`): 409 PAQUETE_EN_OTRO_ALMACEN,
 *     que dice dónde lo tiene el sistema; no se mueve nada.
 *   · Confirmado: el paquete y SUS KILOS pasan de aquel almacén al que surte
 *     (salida allá, entrada aquí, `referencia_tipo = 'bulto'`, tipo
 *     'transferencia', el kardex dice "Paquete encontrado en otro almacén" y el
 *     folio del envío). Si aquel almacén ya no tiene esos kilos, 409
 *     STOCK_INSUFICIENTE: no se inventan kilos.
 * Sin almacén (capturado a mano antes del 2026-10-07) no se pregunta: se
 * apunta al moverlo, como siempre.
 */
async function _traerAlOrigen(conn, bultos, t, encontrados, usuarioId, nombreDe) {
  const fuera = bultos.filter((b) => b.almacen_id != null && Number(b.almacen_id) !== Number(t.almacen_origen_id));
  if (!fuera.length) return [];
  const confirmados = new Set((encontrados ?? []).map((c) => String(c).trim()));
  const sinConfirmar = fuera.filter((b) => !confirmados.has(b.codigo));
  const [[origen]] = await conn.query('SELECT nombre FROM almacenes WHERE id = :id', { id: t.almacen_origen_id });
  if (sinConfirmar.length) {
    const b = sinConfirmar[0];
    throw enOtraTienda(new AppError(409, 'PAQUETE_EN_OTRO_ALMACEN',
      `El paquete ${b.codigo} el sistema lo tiene en «${b.almacen}», no en «${origen.nombre}». ` +
      'Si de verdad está aquí, quítalo de la lista y vuelve a escanearlo para confirmarlo.',
      { paquetes: sinConfirmar.map((x) => ({ codigo: x.codigo, almacen_id: x.almacen_id, almacen: x.almacen })) }),
    sinConfirmar.map((x) => x.almacen_id),
    `El paquete ${b.codigo} el sistema lo tiene en otra tienda, no en «${origen.nombre}». ` +
      'Si de verdad está aquí, quítalo de la lista y vuelve a escanearlo para confirmarlo.');
  }
  for (const b of fuera) {
    const peso = round3(b.peso_kg);
    const hilo = nombreDe(b.variante_id);
    const alla = await _leerCantidad(conn, b.variante_id, b.almacen_id);
    const saldoAlla = alla ? Number(alla.cantidad) : 0;
    if (saldoAlla + 0.0005 < peso) {
      throw enOtraTienda(new AppError(409, 'STOCK_INSUFICIENTE',
        `«${b.almacen}» solo tiene ${round3(saldoAlla)} kg de ${hilo}: no alcanza para pasar los ${peso} kg ` +
        `del paquete ${b.codigo} a «${origen.nombre}». Cuadra ese almacén con un Ajuste o avisa al administrador.`),
      [b.almacen_id], `No se puede pasar el paquete ${b.codigo} a «${origen.nombre}»: el almacén donde lo ` +
        'tenía el sistema no tiene esos kilos. Avisa al administrador.');
    }
    const aqui = await _leerCantidad(conn, b.variante_id, t.almacen_origen_id);
    await _aplicarSaldo(conn, b.variante_id, b.almacen_id, round3(saldoAlla - peso));
    await _aplicarSaldo(conn, b.variante_id, t.almacen_origen_id, round3((aqui ? Number(aqui.cantidad) : 0) + peso));
    const motivo = `Paquete ${b.codigo} encontrado en «${origen.nombre}» al surtir ${t.folio} ` +
      `(el sistema lo tenía en «${b.almacen}»)`;
    for (const [almacen, cantidad] of [[b.almacen_id, -peso], [t.almacen_origen_id, peso]]) {
      await _insertarMovimiento(conn, {
        variante_id: b.variante_id, almacen_id: almacen, tipo: 'transferencia', cantidad,
        costo_unitario: null, referencia_tipo: 'bulto', referencia_id: b.id,
        usuario_id: usuarioId ?? null, motivo,
      });
    }
    await conn.query('UPDATE variante_codigos SET almacen_id = :a WHERE id = :id', { a: t.almacen_origen_id, id: b.id });
    b.almacen_id = t.almacen_origen_id;
    b.almacen = origen.nombre;
  }
  return fuera.map((b) => b.codigo);
}

/**
 * ENVIAR: la mercancía sale del origen y queda en camino.
 *
 * SOLO con los paquetes ESCANEADOS (`codigos`): "aquí cada cosa que sale se
 * escanea, no se puede enviar si no se escanea" (usuario, 2026-10-06). De cada
 * hilo sale EXACTAMENTE el peso real de sus paquetes escaneados, y esos —no
 * otros— pasan a la sucursal. Pueden ser MENOS de los que se pidieron (sale lo
 * que hay), NUNCA MÁS (2026-10-19: con la autorización se pide y se autoriza una
 * cantidad, "si autorizo 10, solo salen 10"; 422 MAS_DE_LO_PEDIDO). La línea
 * queda con esos paquetes y esos kilos. Sin ningún código, 422 SIN_ESCANEAR: lo
 * que no se escanea no sale.
 *
 * SE MANDA LO QUE HAY (usuario, 2026-10-06): "si pido 20 de negro 1/30 y solo
 * tengo 15, que se envíen esos y nada más". Un hilo con menos paquetes que los
 * pedidos sale con los que se escanearon; uno sin ninguno NO sale (su línea
 * queda en 0 para que se vea). Lo pedido sigue en `paquetes_solicitados` y lo que
 * no salió completo se anota solo en `envio_notas` ("…era lo único que había"),
 * junto con lo que escriba quien surte (`notas`).
 *
 * Se vuelve a validar la existencia; si ya no alcanza, 409 y no se envía nada.
 */
/**
 * NO SALE MÁS DE LO PEDIDO (2026-10-19, autorizaciones: "si autorizas 10, que
 * solo se puedan mandar 10"). De cada hilo pedido en PAQUETES, no más paquetes
 * escaneados que los pedidos (o autorizados: el traspaso nace con lo que se
 * autorizó). Lo pedido en kilos (presentación suelta o una solicitud vieja) no
 * se topa: sus kilos son un aproximado. Antes de mover nada.
 */
function _exigirNoMasDeLoPedido(det, escaneados, nombreDe) {
  const demas = [];
  for (const d of det) {
    const pedidos = d.paquetes_solicitados != null ? Number(d.paquetes_solicitados)
      : d.paquetes != null ? Number(d.paquetes) : null;
    if (pedidos == null) continue;
    const n = escaneados.filter((b) => Number(b.variante_id) === Number(d.variante_id)).length;
    if (n > pedidos) demas.push(`${nombreDe(d.variante_id)}: se pidieron ${pedidos} y van ${n} (quita ${n - pedidos})`);
  }
  if (demas.length) {
    throw new AppError(422, 'MAS_DE_LO_PEDIDO', `No sale más de lo pedido. ${demas.join('; ')}.`);
  }
}

async function enviarTraspaso(id, usuarioId, datos = {}) {
  return withTransaction(async (conn) => {
    const [trows] = await conn.query('SELECT * FROM traspasos WHERE id = :id FOR UPDATE', { id });
    const t = trows[0];
    if (!t) throw new AppError(404, 'NO_ENCONTRADO', 'Traspaso no encontrado');
    if (t.estado !== 'solicitado') {
      throw new AppError(409, 'ESTADO_INVALIDO',
        `El traspaso ${t.folio} está "${t.estado}": solo se puede enviar una solicitud.`);
    }

    const [det] = await conn.query(
      'SELECT * FROM traspaso_detalle WHERE traspaso_id = :id ORDER BY id',
      { id }
    );
    const lineas = [];

    // Los paquetes escaneados, agrupados por hilo.
    const variantes = new Map();
    for (const d of det) variantes.set(Number(d.variante_id), await _varianteParaTraspaso(conn, d.variante_id));
    const nombreDe = (vid) => {
      const v = variantes.get(Number(vid));
      return v ? `${v.producto}${v.calibre ? ' ' + v.calibre : ''}` : 'otro hilo';
    };
    const escaneados = await _bultosEscaneados(
      conn, datos.codigos ?? [], new Set(variantes.keys()), nombreDe, t.id
    );
    const escaneadosDe = (vid) => escaneados.filter((b) => Number(b.variante_id) === Number(vid));

    // Lo que no se escanea no sale.
    if (!escaneados.length) {
      throw new AppError(422, 'SIN_ESCANEAR',
        'Escanea los paquetes que salen: sin escanear no se puede enviar.');
    }
    _exigirNoMasDeLoPedido(det, escaneados, nombreDe);
    // Los que el sistema tenía en otro almacén: confirmados, pasan aquí con sus kilos.
    await _traerAlOrigen(conn, escaneados, t, datos.encontrados, usuarioId, nombreDe);

    // Lo que se había guardado a medio surtir: los renglones se rehacen abajo con
    // lo que de verdad sale, y lo guardado que ya no va queda libre otra vez.
    await conn.query(
      `DELETE tb FROM traspaso_bultos tb JOIN traspaso_detalle d ON d.id = tb.detalle_id
        WHERE d.traspaso_id = :id`,
      { id: t.id }
    );
    await _soltarApartados(conn, t.id, escaneados.map((b) => b.id));
    const incompletos = [];

    for (const d of det) {
      const v = variantes.get(Number(d.variante_id));
      const solicitado = Number(d.cantidad);
      const pedidos = d.paquetes_solicitados != null ? Number(d.paquetes_solicitados)
        : d.paquetes != null ? Number(d.paquetes) : null;
      // Sale su peso REAL y viajan ESOS paquetes.
      const bultos = escaneadosDe(v.id);
      const paquetes = bultos.length;
      const cantidad = round3(bultos.reduce((acc, b) => acc + Number(b.peso_kg), 0));

      if (paquetes === 0) {
        // De este hilo no había: NO sale. Se suelta lo que tenía apartado y la
        // línea se queda en 0 para que se vea que se pidió y no salió.
        await _moverReserva(conn, v.id, t.almacen_origen_id, -solicitado);
        await conn.query(
          'UPDATE traspaso_detalle SET cantidad = 0, paquetes = 0 WHERE id = :id',
          { id: d.id }
        );
        incompletos.push(`${nombreDe(v.id)}: no salió${pedidos != null ? ` (se pidieron ${pedidos})` : ''}`);
        lineas.push({
          detalle_id: d.id, variante_id: v.id, sku: v.sku, producto: v.producto,
          paquetes: 0, paquetes_pedidos: pedidos, cantidad: 0, solicitado,
          no_salio: true, bultos: [],
        });
        continue;
      }
      if (pedidos != null && paquetes < pedidos) {
        incompletos.push(`${nombreDe(v.id)}: salieron ${paquetes} de ${pedidos}`);
      }

      const fila = await _leerCantidad(conn, v.id, t.almacen_origen_id);
      const saldo = fila ? Number(fila.cantidad) : 0;
      if (saldo < cantidad) {
        throw new AppError(409, 'STOCK_INSUFICIENTE',
          `Ya no alcanza "${v.producto} · ${v.sku}": quedan ${saldo} kg en el origen y el ` +
          `traspaso pide ${cantidad} kg. Ajusta la solicitud o cancélala.`);
      }

      // Sale del origen. Todavía NO entra al destino: va en camino.
      await _aplicarSaldo(conn, v.id, t.almacen_origen_id, round3(saldo - cantidad));
      // Se libera el apartado de ESTA solicitud, que ya se convirtió en salida.
      await _moverReserva(conn, v.id, t.almacen_origen_id, -solicitado);

      // Los paquetes escaneados ya apuntan a la sucursal (y los que estaban
      // apartados para este envío vuelven a estar disponibles: ya salieron).
      await conn.query(
        // (Solo llegan aquí paquetes disponibles o apartados para ESTE envío.)
        `UPDATE variante_codigos
            SET almacen_id = :destino, estado = 'disponible',
                consumido_tipo = NULL, consumido_id = NULL, consumido_en = NULL
          WHERE id IN (:ids)`,
        { destino: t.almacen_destino_id, ids: bultos.map((b) => b.id) }
      );
      // Y queda escrito cuáles viajaron: si el envío se cancela, regresan ESOS y
      // no los que la sucursal ya tenía de traspasos anteriores.
      await conn.query(
        'INSERT INTO traspaso_bultos (detalle_id, variante_codigo_id) VALUES ?',
        [bultos.map((b) => [d.id, b.id])]
      );

      // La línea queda con lo que de verdad salió: cuántos paquetes y cuántos kilos.
      await conn.query(
        'UPDATE traspaso_detalle SET cantidad = :cantidad, paquetes = :paquetes WHERE id = :id',
        { cantidad, paquetes, id: d.id }
      );

      await _insertarMovimiento(conn, {
        variante_id: v.id,
        almacen_id: t.almacen_origen_id,
        tipo: 'transferencia',
        cantidad: -cantidad,
        costo_unitario: null,
        referencia_tipo: 'traspaso',
        referencia_id: t.id,
        usuario_id: usuarioId ?? null,
        motivo: `Envío del traspaso ${t.folio}`,
      });

      lineas.push({
        detalle_id: d.id,
        variante_id: v.id,
        sku: v.sku,
        producto: v.producto,
        paquetes,
        paquetes_pedidos: pedidos,
        cantidad,
        solicitado,
        ajustado: cantidad !== solicitado,
        bultos: bultos.map((b) => ({ codigo: b.codigo, peso_kg: b.peso_kg, lote: b.lote })),
        saldo_origen: round3(saldo - cantidad),
      });
    }

    // Lo que no salió completo se anota solo, y después lo que escriba quien surte.
    const automatica = incompletos.length
      ? `${incompletos.join('; ')}. Era lo único que había.`
      : null;
    const notas = [automatica, (datos.notas ?? '').trim() || null].filter(Boolean).join(' ');
    await conn.query(
      `UPDATE traspasos SET estado = 'en_transito', enviado_en = NOW(), enviado_por = :u,
                            envio_notas = :notas
        WHERE id = :id`,
      { u: usuarioId ?? null, notas: notas || null, id }
    );

    return { id: t.id, folio: t.folio, estado: 'en_transito', envio_notas: notas || null, lineas };
  });
}

/** Deja libres los paquetes apartados para este traspaso (salvo `quedan`). */
async function _soltarApartados(conn, traspasoId, quedan = []) {
  await conn.query(
    `UPDATE variante_codigos
        SET estado = 'disponible', consumido_tipo = NULL, consumido_id = NULL, consumido_en = NULL
      WHERE consumido_tipo = 'traspaso' AND consumido_id = :id AND estado = 'apartado'
        ${quedan.length ? 'AND id NOT IN (:quedan)' : ''}`,
    { id: traspasoId, quedan: quedan.length ? quedan : [0] }
  );
}

/**
 * GUARDAR LO ESCANEADO A MEDIO SURTIR (2026-10-07: "que se puedan escanear una
 * parte, se guarden esos códigos de barras pero que ya no se puedan vender hasta
 * que cancele el pedido; que haya un como en espera hasta que terminen de
 * escanear los demás").
 *
 * `codigos` es la lista COMPLETA de lo escaneado hasta ahora (la reemplaza):
 *   · los nuevos quedan ligados a su línea (`traspaso_bultos`) y APARTADOS para
 *     este traspaso (`estado = 'apartado'`, `consumido_tipo = 'traspaso'`): la
 *     caja no los vende, no se bajan a conos ni se mandan en otro envío;
 *   · los que estaban y ya no vienen se sueltan.
 * No mueve kilos: lo apartado al pedir sigue igual. El traspaso sigue
 * "solicitado" (en espera) hasta que se ENVÍA, que toma estos y los que se
 * escaneen después, o se CANCELA, que los suelta.
 */
async function guardarEscaneos(id, usuarioId, codigos = [], encontrados = []) {
  return withTransaction(async (conn) => {
    const [[t]] = await conn.query('SELECT * FROM traspasos WHERE id = :id FOR UPDATE', { id });
    if (!t) throw new AppError(404, 'NO_ENCONTRADO', 'Traspaso no encontrado');
    if (t.estado !== 'solicitado') {
      throw new AppError(409, 'ESTADO_INVALIDO',
        `El traspaso ${t.folio} está "${t.estado}": solo se guarda lo escaneado de una solicitud por enviar.`);
    }
    const [det] = await conn.query(
      'SELECT id, variante_id, paquetes_solicitados, paquetes FROM traspaso_detalle WHERE traspaso_id = :id ORDER BY id', { id });
    const variantes = new Map();
    for (const d of det) variantes.set(Number(d.variante_id), await _varianteParaTraspaso(conn, d.variante_id));
    const nombreDe = (vid) => {
      const v = variantes.get(Number(vid));
      return v ? `${v.producto}${v.calibre ? ' ' + v.calibre : ''}` : 'otro hilo';
    };
    const bultos = await _bultosEscaneados(conn, codigos, new Set(variantes.keys()), nombreDe, t.id);
    _exigirNoMasDeLoPedido(det, bultos, nombreDe);
    // Igual que al enviar: el que estaba en otro almacén y se confirmó, pasa aquí con sus kilos.
    await _traerAlOrigen(conn, bultos, t, encontrados, usuarioId, nombreDe);

    // Lo que ya estaba guardado.
    const [antes] = await conn.query(
      `SELECT tb.id, tb.variante_codigo_id FROM traspaso_bultos tb
         JOIN traspaso_detalle d ON d.id = tb.detalle_id
        WHERE d.traspaso_id = :id`,
      { id }
    );
    const nuevos = new Set(bultos.map((b) => Number(b.id)));
    const yaEstaban = new Set(antes.map((a) => Number(a.variante_codigo_id)));
    const quitar = antes.filter((a) => !nuevos.has(Number(a.variante_codigo_id)));
    if (quitar.length) {
      await conn.query('DELETE FROM traspaso_bultos WHERE id IN (:ids)', { ids: quitar.map((a) => a.id) });
    }
    await _soltarApartados(conn, t.id, [...nuevos]);

    const lineaDe = new Map(det.map((d) => [Number(d.variante_id), d.id]));
    const agregar = bultos.filter((b) => !yaEstaban.has(Number(b.id)));
    if (agregar.length) {
      await conn.query(
        'INSERT INTO traspaso_bultos (detalle_id, variante_codigo_id) VALUES ?',
        [agregar.map((b) => [lineaDe.get(Number(b.variante_id)), b.id])]
      );
      await conn.query(
        `UPDATE variante_codigos
            SET estado = 'apartado', consumido_tipo = 'traspaso', consumido_id = :t, consumido_en = NULL
          WHERE id IN (:ids)`,
        { t: t.id, ids: agregar.map((b) => b.id) }
      );
    }

    return {
      id: t.id,
      folio: t.folio,
      guardados: bultos.length,
      kg: round3(bultos.reduce((s, b) => s + Number(b.peso_kg), 0)),
      agregados: agregar.length,
      soltados: quitar.length,
    };
  });
}

/**
 * Lo escaneado y guardado de los traspasos que todavía no se envían, por línea:
 * `l.guardados = [{ codigo, peso_kg, lote, variante_id }]`.
 */
async function _conGuardados(ejecutor, traspasos) {
  await _conEnviados(ejecutor, traspasos);
  const porEnviar = traspasos.filter((t) => t.estado === 'solicitado');
  const lineas = porEnviar.flatMap((t) => t.lineas ?? []);
  for (const l of lineas) l.guardados = [];
  if (!lineas.length) return;
  const [rows] = await ejecutor.query(
    `SELECT tb.detalle_id, vc.codigo, vc.peso_kg, vc.lote, vc.variante_id
       FROM traspaso_bultos tb JOIN variante_codigos vc ON vc.id = tb.variante_codigo_id
      WHERE tb.detalle_id IN (:ids)
      ORDER BY tb.id`,
    { ids: lineas.map((l) => l.detalle_id) }
  );
  const porLinea = new Map(lineas.map((l) => [Number(l.detalle_id), l]));
  for (const r of rows) {
    porLinea.get(Number(r.detalle_id))?.guardados.push({
      codigo: r.codigo, peso_kg: r.peso_kg, lote: r.lote, variante_id: Number(r.variante_id),
    });
  }
}

/**
 * LOS PAQUETES QUE SALIERON en un envío ya enviado (en camino o recibido), en
 * cada línea (`enviados`, con `falto` si al recibirlo se dijo que no llegó). Con
 * ellos quien recibe palomea los que no llegaron (2026-10-20).
 */
async function _conEnviados(ejecutor, traspasos) {
  const salieron = traspasos.filter((t) => t.estado === 'en_transito' || t.estado === 'recibido');
  const lineas = salieron.flatMap((t) => t.lineas ?? []);
  for (const l of lineas) l.enviados = [];
  if (!lineas.length) return;
  const [rows] = await ejecutor.query(
    // "No llegó" solo en el envío donde faltó: el mismo paquete pudo viajar antes en otro.
    `SELECT tb.detalle_id, vc.codigo, vc.peso_kg, vc.lote,
            (vc.estado = 'faltante' AND vc.consumido_tipo = 'traspaso' AND vc.consumido_id = td.traspaso_id) AS falto
       FROM traspaso_bultos tb
       JOIN traspaso_detalle td ON td.id = tb.detalle_id
       JOIN variante_codigos vc ON vc.id = tb.variante_codigo_id
      WHERE tb.detalle_id IN (:ids)
      ORDER BY vc.codigo`,
    { ids: lineas.map((l) => l.detalle_id) }
  );
  const porLinea = new Map(lineas.map((l) => [Number(l.detalle_id), l]));
  for (const r of rows) {
    porLinea.get(Number(r.detalle_id))?.enviados.push({
      codigo: r.codigo, peso_kg: r.peso_kg, lote: r.lote, falto: Boolean(Number(r.falto)),
    });
  }
}

/**
 * RECIBIR: el responsable de la sucursal acepta y dice QUÉ llegó.
 *
 * Entra al destino lo que se envió, y si llegó menos, la diferencia se asienta
 * como MERMA con el folio del traspaso: así el kardex explica los kilos que se
 * perdieron en el camino, en vez de que aparezcan como si nunca hubieran salido.
 * Queda guardado quién aceptó y cuándo, que es el punto de todo esto.
 *
 * `recibido` es opcional: sin él se acepta el envío completo.
 *
 * LOS PAQUETES QUE NO LLEGARON (2026-10-20, auditoría; el usuario eligió "marcar
 * cuáles faltaron"): de una línea que viajó con sus paquetes escaneados se dice
 * CUÁLES no llegaron (`faltan`, sus códigos). La merma es su peso real y pasan a
 * 'faltante': antes se decía "llegaron 18 de 20", los kilos de 2 se daban de
 * baja con el promedio y los 20 paquetes seguían disponibles en la sucursal.
 */
async function recibirTraspaso(id, usuarioId, datos = {}) {
  return withTransaction(async (conn) => {
    const [trows] = await conn.query('SELECT * FROM traspasos WHERE id = :id FOR UPDATE', { id });
    const t = trows[0];
    if (!t) throw new AppError(404, 'NO_ENCONTRADO', 'Traspaso no encontrado');
    if (t.estado !== 'en_transito') {
      throw new AppError(409, 'ESTADO_INVALIDO',
        `El traspaso ${t.folio} está "${t.estado}": solo se recibe lo que va en tránsito.`);
    }

    const [det] = await conn.query(
      'SELECT * FROM traspaso_detalle WHERE traspaso_id = :id ORDER BY id',
      { id }
    );
    const porDetalle = new Map((datos.recibido ?? []).map((r) => [Number(r.detalle_id), r]));
    const lineas = [];

    for (const d of det) {
      const v = await _varianteParaTraspaso(conn, d.variante_id);
      const enviado = Number(d.cantidad);
      const dicho = porDetalle.get(d.id);

      // Un hilo que no salió (no había) no entra ni falta: no se mueve nada.
      if (enviado === 0) {
        await conn.query(
          'UPDATE traspaso_detalle SET cantidad_recibida = 0, paquetes_recibidos = 0 WHERE id = :id',
          { id: d.id }
        );
        lineas.push({
          detalle_id: d.id, variante_id: v.id, sku: v.sku, producto: v.producto,
          enviado: 0, recibida: 0, faltante: 0, paquetes: 0, paquetes_recibidos: 0, no_salio: true,
        });
        continue;
      }

      // Los paquetes que viajaron en esta línea (los escaneados al surtir).
      const [viajaron] = await conn.query(
        `SELECT vc.id, vc.codigo, vc.peso_kg, vc.estado
           FROM traspaso_bultos tb JOIN variante_codigos vc ON vc.id = tb.variante_codigo_id
          WHERE tb.detalle_id = :d FOR UPDATE`,
        { d: d.id }
      );
      const faltan = [...new Set((dicho?.faltan ?? []).map((c) => String(c).trim()).filter(Boolean))];
      const porCodigo = new Map(viajaron.map((b) => [b.codigo, b]));
      const noLlegaron = [];
      for (const c of faltan) {
        const b = porCodigo.get(c);
        if (!b) {
          throw new AppError(422, 'BULTO_NO_ES_DEL_ENVIO',
            `El paquete ${c} no viene en este envío de ${v.producto} · ${v.sku}.`);
        }
        noLlegaron.push(b);
      }

      // Lo que llegó, en la unidad que sea más natural: paquetes si así se pidió.
      let recibida = enviado;
      let paquetesRecibidos = d.paquetes != null ? Number(d.paquetes) : null;
      if (noLlegaron.length) {
        // Se sabe CUÁLES faltaron: la merma es su peso real.
        const kgFaltan = round3(noLlegaron.reduce((s, b) => s + Number(b.peso_kg ?? 0), 0));
        recibida = round3(Math.max(0, enviado - kgFaltan));
        if (paquetesRecibidos != null) paquetesRecibidos = Math.max(0, paquetesRecibidos - noLlegaron.length);
      } else if (dicho && viajaron.length &&
                 ((dicho.paquetes != null && d.paquetes != null && Number(dicho.paquetes) < Number(d.paquetes)) ||
                  (dicho.paquetes == null && dicho.cantidad != null && round3(Number(dicho.cantidad)) < enviado))) {
        // Viajó con sus paquetes escaneados: hay que decir cuáles no llegaron, o
        // quedarían "disponibles" en la sucursal paquetes que no están.
        throw new AppError(422, 'DI_CUALES_FALTARON',
          `De ${v.producto} · ${v.sku} salieron ${Number(d.paquetes)} paquetes con su código: marca cuáles no llegaron.`);
      } else if (dicho) {
        if (dicho.paquetes != null && d.paquetes != null) {
          paquetesRecibidos = Number(dicho.paquetes);
          const porPaquete = Number(d.paquetes) > 0 ? enviado / Number(d.paquetes) : 0;
          recibida = round3(paquetesRecibidos * porPaquete);
        } else if (dicho.cantidad != null) {
          recibida = round3(Number(dicho.cantidad));
        }
      }
      if (recibida < 0) {
        throw new AppError(422, 'CANTIDAD_INVALIDA', 'Lo recibido no puede ser negativo');
      }
      if (recibida > enviado) {
        throw new AppError(422, 'RECIBE_MAS_DE_LO_ENVIADO',
          `De "${v.producto} · ${v.sku}" se enviaron ${enviado} kg y estás aceptando ` +
          `${recibida} kg. Si llegó de más, revisa el envío.`);
      }

      const fila = await _leerCantidad(conn, v.id, t.almacen_destino_id);
      const saldo = fila ? Number(fila.cantidad) : 0;

      // Entra al destino solo lo que de verdad llegó…
      await _aplicarSaldo(conn, v.id, t.almacen_destino_id, round3(saldo + recibida));
      await _insertarMovimiento(conn, {
        variante_id: v.id,
        almacen_id: t.almacen_destino_id,
        tipo: 'transferencia',
        cantidad: enviado,
        costo_unitario: null,
        referencia_tipo: 'traspaso',
        referencia_id: t.id,
        usuario_id: usuarioId ?? null,
        motivo: `Recepción del traspaso ${t.folio}`,
      });

      // …y si llegó menos, el faltante se asienta aparte, con su explicación, para
      // que el kardex cuadre: entró lo enviado y se dio de baja la diferencia.
      const faltante = round3(enviado - recibida);
      if (faltante > 0) {
        const cuales = noLlegaron.length
          ? `; no llegaron ${noLlegaron.length === 1 ? 'el paquete' : `${noLlegaron.length} paquetes:`} ` +
            noLlegaron.map((b) => b.codigo).slice(0, 12).join(', ') + (noLlegaron.length > 12 ? '…' : '')
          : '';
        await _insertarMovimiento(conn, {
          variante_id: v.id,
          almacen_id: t.almacen_destino_id,
          tipo: 'merma',
          cantidad: -faltante,
          costo_unitario: null,
          referencia_tipo: 'traspaso',
          referencia_id: t.id,
          usuario_id: usuarioId ?? null,
          motivo:
            `Faltante en el traspaso ${t.folio}: se enviaron ${enviado} kg y llegaron ${recibida} kg${cuales}`.slice(0, 255),
        });
      }
      // Los que no llegaron dejan de estar en la sucursal: ya no se venden ni se
      // bajan a conos, y el detalle del hilo dice que faltaron en este envío.
      if (noLlegaron.length) {
        await conn.query(
          `UPDATE variante_codigos
              SET estado = 'faltante', consumido_en = NOW(), consumido_tipo = 'traspaso', consumido_id = :t
            WHERE id IN (:ids)`,
          { t: t.id, ids: noLlegaron.map((b) => b.id) }
        );
      }

      await conn.query(
        `UPDATE traspaso_detalle
            SET cantidad_recibida = :recibida, paquetes_recibidos = :paquetes
          WHERE id = :id`,
        { recibida, paquetes: paquetesRecibidos, id: d.id }
      );

      lineas.push({
        detalle_id: d.id,
        variante_id: v.id,
        sku: v.sku,
        producto: v.producto,
        enviado,
        recibida,
        faltante,
        paquetes: d.paquetes != null ? Number(d.paquetes) : null,
        paquetes_recibidos: paquetesRecibidos,
        no_llegaron: noLlegaron.map((b) => b.codigo),
        saldo_destino: round3(saldo + recibida),
      });
    }

    await conn.query(
      `UPDATE traspasos
          SET estado = 'recibido', recibido_en = NOW(), recibido_por = :u,
              recepcion_notas = :notas
        WHERE id = :id`,
      { u: usuarioId ?? null, notas: datos.notas ?? null, id }
    );

    const faltantes = lineas.filter((l) => l.faltante > 0).length;
    return { id: t.id, folio: t.folio, estado: 'recibido', faltantes, lineas };
  });
}

/**
 * CANCELAR. Si estaba solicitado, solo se libera lo apartado. Si ya iba en
 * tránsito, la mercancía REGRESA al origen con su movimiento y los bultos
 * vuelven. Un traspaso recibido ya no se cancela: eso se corrige con otro
 * traspaso de vuelta.
 */
async function cancelarTraspaso(id, usuarioId, motivo) {
  return withTransaction(async (conn) => {
    const [trows] = await conn.query('SELECT * FROM traspasos WHERE id = :id FOR UPDATE', { id });
    const t = trows[0];
    if (!t) throw new AppError(404, 'NO_ENCONTRADO', 'Traspaso no encontrado');
    if (t.estado === 'recibido') {
      throw new AppError(409, 'ESTADO_INVALIDO',
        `El traspaso ${t.folio} ya se recibió: para devolver la mercancía haz un traspaso de vuelta.`);
    }
    if (t.estado === 'cancelado') {
      throw new AppError(409, 'ESTADO_INVALIDO', `El traspaso ${t.folio} ya estaba cancelado.`);
    }

    const [det] = await conn.query(
      'SELECT * FROM traspaso_detalle WHERE traspaso_id = :id ORDER BY id',
      { id }
    );

    if (t.estado === 'solicitado') {
      // Lo que se había escaneado y guardado a medio surtir queda libre otra vez.
      await conn.query(
        `DELETE tb FROM traspaso_bultos tb JOIN traspaso_detalle d ON d.id = tb.detalle_id
          WHERE d.traspaso_id = :id`,
        { id: t.id }
      );
      await _soltarApartados(conn, t.id);
    }

    for (const d of det) {
      const cantidad = Number(d.cantidad);
      if (t.estado === 'solicitado') {
        // Nada se movió: solo se suelta lo apartado.
        await _moverReserva(conn, d.variante_id, t.almacen_origen_id, -cantidad);
        continue;
      }
      // Iba en camino: la mercancía vuelve a donde salió (un hilo que no salió, no).
      if (cantidad === 0) continue;
      const fila = await _leerCantidad(conn, d.variante_id, t.almacen_origen_id);
      const saldo = fila ? Number(fila.cantidad) : 0;
      await _aplicarSaldo(conn, d.variante_id, t.almacen_origen_id, round3(saldo + cantidad));
      await _insertarMovimiento(conn, {
        variante_id: d.variante_id,
        almacen_id: t.almacen_origen_id,
        tipo: 'transferencia',
        cantidad,
        costo_unitario: null,
        referencia_tipo: 'traspaso',
        referencia_id: t.id,
        usuario_id: usuarioId ?? null,
        motivo: `Cancelación del traspaso ${t.folio}: la mercancía regresó`,
      });
      // Y regresan al origen los bultos que viajaron en ESTE envío
      // (`traspaso_bultos`), no todos los de ese hilo que haya en la sucursal:
      // los de traspasos anteriores ya recibidos son de allá. Un envío anterior
      // a esa tabla no tiene renglones y sus bultos se quedan donde están (su
      // ubicación es aproximada a propósito; los saldos son la verdad).
      await conn.query(
        `UPDATE variante_codigos vc
           JOIN traspaso_bultos tb ON tb.variante_codigo_id = vc.id
            SET vc.almacen_id = :origen
          WHERE tb.detalle_id = :detalle AND vc.almacen_id = :destino AND vc.estado = 'disponible'`,
        { origen: t.almacen_origen_id, destino: t.almacen_destino_id, detalle: d.id }
      );
    }

    await conn.query(
      `UPDATE traspasos
          SET estado = 'cancelado', cancelado_en = NOW(), cancelado_por = :u,
              motivo_cancelacion = :motivo
        WHERE id = :id`,
      { u: usuarioId ?? null, motivo: motivo ?? null, id }
    );

    return { id: t.id, folio: t.folio, estado: 'cancelado', estado_anterior: t.estado };
  });
}

/** Historial de traspasos con sus líneas. */
async function listarTraspasos({ almacen_destino_id, limit, offset, almacenes }) {
  const condiciones = [];
  const params = { almacen_destino_id, limit, offset };
  if (almacen_destino_id) condiciones.push('t.almacen_destino_id = :almacen_destino_id');
  // Los de SUS tiendas: los que salen de ellas y los que les llegan.
  if (Array.isArray(almacenes)) {
    if (!almacenes.length) condiciones.push('1 = 0');
    else {
      condiciones.push('(t.almacen_origen_id IN (:almacenesAlcance) OR t.almacen_destino_id IN (:almacenesAlcance))');
      params.almacenesAlcance = almacenes;
    }
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT t.id, t.folio, t.estado, t.notas, t.creado_en,
            t.almacen_origen_id, t.almacen_destino_id,
            t.enviado_en, t.recibido_en, t.cancelado_en,
            t.envio_notas, t.recepcion_notas, t.motivo_cancelacion,
            ao.nombre AS almacen_origen, ad.nombre AS almacen_destino,
            u.nombre AS usuario, ue.nombre AS enviado_por, ur.nombre AS recibido_por,
            uc.nombre AS cancelado_por,
            (SELECT COUNT(*) FROM traspaso_detalle d WHERE d.traspaso_id = t.id) AS num_lineas
       FROM traspasos t
       JOIN almacenes ao     ON ao.id = t.almacen_origen_id
       JOIN almacenes ad     ON ad.id = t.almacen_destino_id
       LEFT JOIN usuarios u  ON u.id = t.usuario_id
       LEFT JOIN usuarios ue ON ue.id = t.enviado_por
       LEFT JOIN usuarios ur ON ur.id = t.recibido_por
       LEFT JOIN usuarios uc ON uc.id = t.cancelado_por
       ${where}
      ORDER BY t.creado_en DESC, t.id DESC
      LIMIT :limit OFFSET :offset`,
    params
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM traspasos t ${where}`,
    params
  );

  if (rows.length) {
    const [det] = await pool.query(
      `SELECT d.id AS detalle_id, d.traspaso_id, d.variante_id, d.paquetes_solicitados, d.cantidad_solicitada,
              d.paquetes, d.cantidad,
              d.cantidad_recibida, d.paquetes_recibidos,
              pv.sku, pv.tipo_presentacion, pv.peso_kg, prod.nombre AS producto,
              prod.grosor_calibre AS calibre, cat.nombre AS material, lin.nombre AS linea
         FROM traspaso_detalle d
         JOIN producto_variantes pv ON pv.id = d.variante_id
         JOIN productos prod        ON prod.id = pv.producto_id
         JOIN categorias cat        ON cat.id = prod.categoria_id
         LEFT JOIN lineas lin       ON lin.id = prod.linea_id
        WHERE d.traspaso_id IN (:ids)
        ORDER BY d.id`,
      { ids: rows.map((r) => r.id) }
    );
    const porTraspaso = new Map(rows.map((r) => [r.id, []]));
    for (const d of det) porTraspaso.get(d.traspaso_id)?.push(d);
    for (const r of rows) r.lineas = porTraspaso.get(r.id) ?? [];
    await _conGuardados(pool, rows);
  }
  return { rows, total };
}

/** Un traspaso con sus líneas, para poder ver qué se mandó desde el kardex. */
async function obtenerTraspaso(id) {
  const [rows] = await pool.query(
    `SELECT t.id, t.folio, t.estado, t.notas, t.creado_en,
            t.almacen_origen_id, t.almacen_destino_id,
            t.enviado_en, t.recibido_en, t.cancelado_en,
            t.envio_notas, t.recepcion_notas, t.motivo_cancelacion,
            ao.nombre AS almacen_origen, ad.nombre AS almacen_destino,
            u.nombre AS usuario, ue.nombre AS enviado_por, ur.nombre AS recibido_por,
            uc.nombre AS cancelado_por
       FROM traspasos t
       JOIN almacenes ao     ON ao.id = t.almacen_origen_id
       JOIN almacenes ad     ON ad.id = t.almacen_destino_id
       LEFT JOIN usuarios u  ON u.id = t.usuario_id
       LEFT JOIN usuarios ue ON ue.id = t.enviado_por
       LEFT JOIN usuarios ur ON ur.id = t.recibido_por
       LEFT JOIN usuarios uc ON uc.id = t.cancelado_por
      WHERE t.id = :id LIMIT 1`,
    { id }
  );
  const traspaso = rows[0];
  if (!traspaso) return null;

  const [lineas] = await pool.query(
    `SELECT d.id AS detalle_id, d.variante_id, d.paquetes_solicitados, d.cantidad_solicitada,
              d.paquetes, d.cantidad,
            d.cantidad_recibida, d.paquetes_recibidos,
            pv.sku, pv.tipo_presentacion, pv.peso_kg, prod.nombre AS producto,
            prod.grosor_calibre AS calibre, cat.nombre AS material, lin.nombre AS linea
       FROM traspaso_detalle d
       JOIN producto_variantes pv ON pv.id = d.variante_id
       JOIN productos prod        ON prod.id = pv.producto_id
       JOIN categorias cat        ON cat.id = prod.categoria_id
       LEFT JOIN lineas lin       ON lin.id = prod.linea_id
      WHERE d.traspaso_id = :id
      ORDER BY d.id`,
    { id }
  );
  traspaso.lineas = lineas;
  await _conGuardados(pool, [traspaso]);
  return traspaso;
}

/** Historial de desarmes, para auditar de dónde salieron los conos. */
async function listarConversiones({ variante_id, limit, offset, almacenes }) {
  const condiciones = [];
  const params = { variante_id, limit, offset };
  if (variante_id) condiciones.push('(c.variante_origen_id = :variante_id OR c.variante_destino_id = :variante_id)');
  _deSusTiendas(condiciones, params, 'c.almacen_destino_id', almacenes);
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT c.id, c.paquetes, c.kg_consumidos, c.destare_kg, c.piezas_generadas, c.codigo_bulto,
            c.motivo, c.creado_en,
            c.variante_origen_id, vo.sku AS paquete_sku,
            c.variante_destino_id, vd.sku AS cono_sku,
            prod.nombre AS producto, prod.grosor_calibre AS calibre,
            ao.nombre AS almacen_origen, ad.nombre AS almacen_destino,
            u.nombre AS usuario
       FROM variante_conversiones c
       JOIN producto_variantes vo ON vo.id = c.variante_origen_id
       JOIN producto_variantes vd ON vd.id = c.variante_destino_id
       JOIN productos prod        ON prod.id = vd.producto_id
       JOIN almacenes ao          ON ao.id = c.almacen_origen_id
       JOIN almacenes ad          ON ad.id = c.almacen_destino_id
       LEFT JOIN usuarios u       ON u.id = c.usuario_id
       ${where}
      ORDER BY c.creado_en DESC, c.id DESC
      LIMIT :limit OFFSET :offset`,
    params
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM variante_conversiones c ${where}`,
    params
  );
  return { rows, total };
}

/**
 * MÍNIMO PARA VARIOS HILOS DE UN ALMACÉN, de una vez (2026-10-16: "avisarme en
 * Sucursal Moroleón cuando queden menos de 5 paquetes de cualquier color, para
 * que en 10 segundos queden protegidos todos los colores"). Es el mismo mínimo
 * que pone la ventana de cada renglón: en KILOS, traducidos de paquetes con el
 * peso PROMEDIO REAL de los paquetes que hay en ese almacén (`pesoPorPaquete`;
 * sin paquetes ahí, el peso del catálogo, y lo dice).
 *
 * Solo a los hilos que ese almacén YA maneja (tienen su renglón de inventario):
 * ponérselo a un color que la tienda nunca tiene encendería alertas de algo que
 * no vende. Solo paquetes: el cono se baja en la tienda, no se resurte.
 * `solo_sin_minimo` (lo recomendado) respeta el que ya tenía su propio mínimo.
 * `paquetes = 0` quita el aviso. Sin `guardar` solo responde lo que haría.
 */
async function minimosEnPaquetes({ almacen_id, paquetes, solo_sin_minimo, guardar }) {
  const [filas] = await pool.query(
    `SELECT i.variante_id, i.stock_minimo, pv.peso_kg, pv.sku,
            p.nombre AS producto, p.grosor_calibre AS calibre
       FROM inventario i
       JOIN producto_variantes pv ON pv.id = i.variante_id
       JOIN productos p           ON p.id = pv.producto_id
      WHERE i.almacen_id = :a AND pv.tipo_presentacion = 'paquete' AND pv.activo = 1 AND p.activo = 1
      ORDER BY p.nombre, p.grosor_calibre, pv.id`,
    { a: almacen_id }
  );
  const renglones = [];
  for (const f of filas) {
    const tenia = round3(f.stock_minimo ?? 0);
    const peso = await pesoPorPaquete(null, { id: f.variante_id, peso_kg: f.peso_kg }, almacen_id);
    const sinPeso = paquetes > 0 && !(peso.peso > 0);
    const kg = paquetes > 0 && !sinPeso ? peso.kilos(paquetes) : 0;
    const respeta = solo_sin_minimo && tenia > 0;
    renglones.push({
      variante_id: Number(f.variante_id),
      producto: f.producto,
      calibre: f.calibre,
      sku: f.sku,
      tenia_kg: tenia,
      kg,
      peso_paquete: peso.peso,
      peso_estimado: peso.nominal,
      sin_peso: sinPeso,
      // Lo que va a pasar con este hilo.
      cambia: !respeta && !sinPeso && Math.abs(kg - tenia) > 0.0005,
      se_queda: respeta,
    });
  }
  if (guardar) {
    await withTransaction(async (conn) => {
      for (const r of renglones.filter((x) => x.cambia)) {
        await conn.query(
          'UPDATE inventario SET stock_minimo = :kg WHERE variante_id = :v AND almacen_id = :a',
          { kg: r.kg, v: r.variante_id, a: almacen_id }
        );
      }
    });
  }
  return {
    almacen_id: Number(almacen_id),
    paquetes,
    solo_sin_minimo,
    guardado: !!guardar,
    cambian: renglones.filter((r) => r.cambia).length,
    se_quedan: renglones.filter((r) => r.se_queda).length,
    sin_peso: renglones.filter((r) => r.sin_peso).length,
    renglones,
  };
}

/** Configura umbrales/ubicación SIN mover existencias (upsert). */
async function configurar(datos) {
  await pool.query(
    `INSERT INTO inventario (variante_id, almacen_id, stock_minimo, stock_maximo, ubicacion_fisica)
     VALUES (:variante_id, :almacen_id, :stock_minimo, :stock_maximo, :ubicacion_fisica)
     ON DUPLICATE KEY UPDATE
       stock_minimo = :stock_minimo, stock_maximo = :stock_maximo, ubicacion_fisica = :ubicacion_fisica`,
    datos
  );
  const [rows] = await pool.query(
    `${SELECT_STOCK} WHERE i.variante_id = :variante_id AND i.almacen_id = :almacen_id LIMIT 1`,
    { variante_id: datos.variante_id, almacen_id: datos.almacen_id }
  );
  return rows[0];
}

/** De dónde sale y a dónde llega un traspaso (para "cada quien, sus tiendas"). */
async function almacenesDeTraspaso(id) {
  const [[t]] = await pool.query(
    'SELECT almacen_origen_id, almacen_destino_id FROM traspasos WHERE id = :id', { id: Number(id) }
  );
  return t ?? null;
}

module.exports = {
  almacenesDeTraspaso,
  minimosEnPaquetes,
  listarStock,
  resumenPorAlmacen,
  alertas,
  listarMovimientos,
  ultimosMovimientos,
  registrarMovimiento,
  desarmar,
  ubicacionBulto,
  conoDe,
  disponibilidadEnPaquetes,
  pesoPorPaquete,
  existenciasDe,
  listarConversiones,
  solicitarTraspaso,
  enviarTraspaso,
  guardarEscaneos,
  recibirTraspaso,
  cancelarTraspaso,
  listarTraspasos,
  obtenerTraspaso,
  configurar,
};
