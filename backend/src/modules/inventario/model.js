'use strict';

const crypto = require('crypto');
const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');

// Acceso a datos de inventario (multi-almacén) y su bitácora (kardex).
// REGLA: todo cambio de existencias = UPDATE inventario + INSERT movimiento,
// siempre dentro de una transacción (ver registrarMovimiento / transferir).

// Signo del efecto sobre las existencias según el tipo de movimiento.
// 'ajuste' es especial: la cantidad enviada es el valor absoluto objetivo.
const SIGNO = { entrada: 1, devolucion: 1, salida: -1, merma: -1 };

// Las cantidades son DECIMAL(12,3): un gramo de resolución.
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

const SELECT_STOCK = `
  SELECT i.id, i.variante_id, pv.sku, p.nombre AS producto, col.nombre AS color,
         i.almacen_id, a.nombre AS almacen,
         i.cantidad, i.cantidad_reservada,
         (i.cantidad - i.cantidad_reservada) AS disponible,
         i.stock_minimo, i.stock_maximo, i.ubicacion_fisica, i.actualizado_en
    FROM inventario i
    JOIN producto_variantes pv ON pv.id = i.variante_id
    JOIN productos p           ON p.id = pv.producto_id
    LEFT JOIN colores col      ON col.id = pv.color_id
    JOIN almacenes a           ON a.id = i.almacen_id
`;

async function listarStock({ almacen_id, variante_id, q, bajo_stock, limit, offset }) {
  const where = [];
  const params = {};
  if (almacen_id !== undefined) {
    where.push('i.almacen_id = :almacen_id');
    params.almacen_id = almacen_id;
  }
  if (variante_id !== undefined) {
    where.push('i.variante_id = :variante_id');
    params.variante_id = variante_id;
  }
  if (q) {
    where.push('(pv.sku LIKE :q OR p.nombre LIKE :q)');
    params.q = `%${q}%`;
  }
  if (bajo_stock) {
    where.push('(i.cantidad - i.cantidad_reservada) <= i.stock_minimo');
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
async function resumenPorAlmacen() {
  const [almacenes] = await pool.query(
    `SELECT a.id AS almacen_id, a.nombre, a.es_punto_venta, a.es_matriz,
            a.es_tienda_linea, a.activo,
            COALESCE(SUM(CASE WHEN i.cantidad > 0 THEN 1 ELSE 0 END), 0) AS skus,
            COALESCE(SUM(CASE WHEN pv.tipo_presentacion = 'cono'
                              THEN i.cantidad ELSE 0 END), 0) AS piezas,
            COALESCE(SUM(CASE WHEN pv.tipo_presentacion <> 'cono'
                              THEN i.cantidad ELSE 0 END), 0) AS kilos,
            COALESCE(SUM(CASE WHEN (i.cantidad - i.cantidad_reservada) <= i.stock_minimo
                              THEN 1 ELSE 0 END), 0) AS alertas
       FROM almacenes a
       LEFT JOIN inventario i          ON i.almacen_id = a.id
       LEFT JOIN producto_variantes pv ON pv.id = i.variante_id
      WHERE a.activo = 1
      GROUP BY a.id, a.nombre, a.es_punto_venta, a.es_matriz, a.es_tienda_linea, a.activo
      ORDER BY a.es_matriz DESC, a.nombre`
  );

  // Variantes con presencia en algún almacén (existencia o mínimo definido).
  const [detalle] = await pool.query(
    `SELECT i.variante_id, i.almacen_id, i.cantidad, i.stock_minimo,
            pv.sku, pv.presentacion, pv.tipo_presentacion, pv.peso_kg,
            prod.nombre AS producto
       FROM inventario i
       JOIN producto_variantes pv ON pv.id = i.variante_id
       JOIN productos prod        ON prod.id = pv.producto_id
      WHERE i.cantidad > 0 OR i.stock_minimo > 0
      ORDER BY prod.nombre, pv.sku`
  );

  const porVariante = new Map();
  for (const d of detalle) {
    if (!porVariante.has(d.variante_id)) {
      porVariante.set(d.variante_id, {
        variante_id: d.variante_id,
        sku: d.sku,
        producto: d.producto,
        presentacion: d.presentacion,
        tipo_presentacion: d.tipo_presentacion,
        peso_kg: d.peso_kg,
        unidad: d.tipo_presentacion === 'cono' ? 'pz' : 'kg',
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

/** Existencias por debajo (o al nivel) del stock mínimo. */
async function alertas() {
  const [rows] = await pool.query(
    `${SELECT_STOCK} WHERE (i.cantidad - i.cantidad_reservada) <= i.stock_minimo
      ORDER BY (i.cantidad - i.cantidad_reservada) - i.stock_minimo`
  );
  return rows;
}

// Agrupa los movimientos como los piensa la tienda, no por el `tipo` crudo.
const FILTROS_CONCEPTO = {
  ventas: "m.referencia_tipo = 'pedido'",
  traspasos: "m.referencia_tipo = 'traspaso'",
  desarmes: "m.referencia_tipo = 'conversion'",
  entradas: "m.tipo = 'entrada' AND m.referencia_tipo IS NULL",
  ajustes: "m.tipo = 'ajuste'",
  mermas: "m.tipo = 'merma'",
  manuales: 'm.referencia_tipo IS NULL',
};

async function listarMovimientos({ variante_id, almacen_id, tipo, concepto, limit, offset }) {
  const where = [];
  const params = {};
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
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Se traen los datos del documento que originó el movimiento (venta,
  // traspaso o desarme) para que el kardex diga qué pasó y no solo el tipo.
  const [rows] = await pool.query(
    `SELECT m.id, m.variante_id, pv.sku, prod.nombre AS producto,
            m.almacen_id, a.nombre AS almacen,
            m.tipo, m.cantidad, m.costo_unitario, m.referencia_tipo, m.referencia_id,
            m.usuario_id, u.nombre AS usuario, m.motivo, m.creado_en,
            ped.numero_pedido, ped.canal AS pedido_canal,
            tr.folio AS traspaso_folio,
            tao.nombre AS traspaso_origen, tad.nombre AS traspaso_destino,
            cvo.sku AS conversion_paquete, cvd.sku AS conversion_cono,
            CASE pv.tipo_presentacion
              WHEN 'paquete' THEN 'kg'
              WHEN 'cono'    THEN 'pz'
              ELSE um.abreviatura
            END AS unidad,
            pv.tipo_presentacion, pv.peso_kg
       FROM movimientos_inventario m
       JOIN producto_variantes pv ON pv.id = m.variante_id
       JOIN productos prod        ON prod.id = pv.producto_id
       JOIN unidades_medida um    ON um.id = prod.unidad_medida_id
       JOIN almacenes a           ON a.id = m.almacen_id
       LEFT JOIN usuarios u       ON u.id = m.usuario_id
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
       ${whereSql}
      ORDER BY m.creado_en DESC, m.id DESC
      LIMIT :limit OFFSET :offset`,
    { ...params, limit, offset }
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM movimientos_inventario m ${whereSql}`,
    params
  );
  return { rows, total };
}

/** Lee existencias de una variante en un almacén (0 si no hay fila). */
async function _leerCantidad(conn, variante_id, almacen_id) {
  const [rows] = await conn.query(
    'SELECT id, cantidad FROM inventario WHERE variante_id = :variante_id AND almacen_id = :almacen_id FOR UPDATE',
    { variante_id, almacen_id }
  );
  return rows[0] || null;
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
      throw new AppError(409, 'STOCK_INSUFICIENTE',
        `Existencias insuficientes: hay ${actual}, se intenta descontar ${Math.abs(delta)}`);
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
 * Transferencia entre almacenes: salida en origen + entrada en destino,
 * dos movimientos 'transferencia' dentro de una sola transacción.
 */
async function transferir(datos, usuarioId) {
  const { variante_id, almacen_origen_id, almacen_destino_id, cantidad } = datos;
  if (almacen_origen_id === almacen_destino_id) {
    throw new AppError(422, 'ALMACENES_IGUALES', 'El origen y el destino deben ser distintos');
  }
  return withTransaction(async (conn) => {
    const filaOrigen = await _leerCantidad(conn, variante_id, almacen_origen_id);
    const actualOrigen = filaOrigen ? Number(filaOrigen.cantidad) : 0;
    if (actualOrigen - cantidad < 0) {
      throw new AppError(409, 'STOCK_INSUFICIENTE',
        `Existencias insuficientes en el origen: hay ${actualOrigen}, se intenta transferir ${cantidad}`);
    }
    const filaDestino = await _leerCantidad(conn, variante_id, almacen_destino_id);
    const actualDestino = filaDestino ? Number(filaDestino.cantidad) : 0;

    await _aplicarSaldo(conn, variante_id, almacen_origen_id, actualOrigen - cantidad);
    await _aplicarSaldo(conn, variante_id, almacen_destino_id, actualDestino + cantidad);

    const base = {
      variante_id,
      tipo: 'transferencia',
      costo_unitario: datos.costo_unitario ?? null,
      referencia_tipo: 'transferencia',
      referencia_id: null,
      usuario_id: usuarioId ?? null,
      motivo: datos.motivo ?? null,
    };
    await _insertarMovimiento(conn, { ...base, almacen_id: almacen_origen_id, cantidad: -cantidad });
    await _insertarMovimiento(conn, { ...base, almacen_id: almacen_destino_id, cantidad });

    return {
      variante_id,
      origen: { almacen_id: almacen_origen_id, saldo_nuevo: actualOrigen - cantidad },
      destino: { almacen_id: almacen_destino_id, saldo_nuevo: actualDestino + cantidad },
    };
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
async function desarmar(datos, usuarioId) {
  const { cono_variante_id, almacen_origen_id, almacen_destino_id, paquetes } = datos;

  return withTransaction(async (conn) => {
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

    const pesoPaquete = Number(cono.paquete_peso_kg);
    const piezas = Number(cono.piezas_por_origen);
    // Por omisión se consume el peso nominal del paquete, pero se puede ajustar
    // cuando el bulto real no pesó exactamente eso.
    const kgConsumidos =
      datos.kg != null ? round3(datos.kg) : round3(pesoPaquete * paquetes);
    const piezasGeneradas = round3(piezas * paquetes);
    if (kgConsumidos <= 0) {
      throw new AppError(422, 'KG_INVALIDOS', 'Los kilos a consumir deben ser mayores a cero');
    }

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
    await _aplicarSaldo(conn, cono_variante_id, almacen_destino_id, saldoCono + piezasGeneradas);

    const [conv] = await conn.query(
      `INSERT INTO variante_conversiones
         (variante_origen_id, variante_destino_id, almacen_origen_id, almacen_destino_id,
          paquetes, kg_consumidos, piezas_generadas, usuario_id, motivo)
       VALUES (:origen, :destino, :alm_origen, :alm_destino,
               :paquetes, :kg, :piezas, :usuario, :motivo)`,
      {
        origen: cono.origen_variante_id,
        destino: cono_variante_id,
        alm_origen: almacen_origen_id,
        alm_destino: almacen_destino_id,
        paquetes,
        kg: kgConsumidos,
        piezas: piezasGeneradas,
        usuario: usuarioId ?? null,
        motivo: datos.motivo ?? null,
      }
    );

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
        `Desarme de ${paquetes} paquete(s) (${kgConsumidos} kg) en ${piezasGeneradas} cono(s)`,
    });
    await _insertarMovimiento(conn, {
      ...base,
      variante_id: cono_variante_id,
      almacen_id: almacen_destino_id,
      tipo: 'entrada',
      cantidad: piezasGeneradas,
      motivo: datos.motivo ?? `Desarme de ${paquetes} paquete(s) de ${cono.paquete_sku}`,
    });

    return {
      conversion_id: conv.insertId,
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
        saldo_nuevo: round3(saldoCono + piezasGeneradas),
      },
    };
  });
}

/**
 * Traspaso de matriz a sucursal: varias líneas en un solo documento con folio.
 *
 * El movimiento es inmediato (sale del origen y entra al destino en la misma
 * transacción). Cuando la variante es un paquete, la línea llega en PAQUETES y
 * aquí se convierte a kilos, que es como se lleva su inventario.
 */
async function crearTraspaso(datos, usuarioId) {
  const { almacen_origen_id, almacen_destino_id, items } = datos;
  if (almacen_origen_id === almacen_destino_id) {
    throw new AppError(422, 'ALMACENES_IGUALES', 'El origen y el destino deben ser distintos');
  }

  return withTransaction(async (conn) => {
    const folio = `TRA-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const [t] = await conn.query(
      `INSERT INTO traspasos (folio, almacen_origen_id, almacen_destino_id, usuario_id, notas)
       VALUES (:folio, :origen, :destino, :usuario, :notas)`,
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
      const [vrows] = await conn.query(
        `SELECT pv.id, pv.sku, pv.tipo_presentacion, pv.peso_kg, pv.activo,
                prod.nombre AS producto
           FROM producto_variantes pv
           JOIN productos prod ON prod.id = pv.producto_id
          WHERE pv.id = :id`,
        { id: item.variante_id }
      );
      const v = vrows[0];
      if (!v) throw new AppError(422, 'VARIANTE_INVALIDA', `La variante ${item.variante_id} no existe`);
      if (!v.activo) {
        throw new AppError(422, 'VARIANTE_INACTIVA', `"${v.producto} · ${v.sku}" está inactiva`);
      }

      // Un paquete se captura en paquetes; el inventario va en kilos.
      const esPaquete = v.tipo_presentacion === 'paquete';
      let paquetes = null;
      let cantidad;
      if (esPaquete && item.paquetes != null) {
        if (!v.peso_kg || Number(v.peso_kg) <= 0) {
          throw new AppError(422, 'PAQUETE_SIN_PESO',
            `"${v.producto} · ${v.sku}" no tiene peso de paquete configurado`);
        }
        paquetes = Number(item.paquetes);
        cantidad = round3(paquetes * Number(v.peso_kg));
      } else if (item.cantidad != null) {
        cantidad = round3(item.cantidad);
      } else {
        throw new AppError(422, 'CANTIDAD_REQUERIDA',
          `Indica cuánto mandar de "${v.producto} · ${v.sku}"`);
      }
      if (cantidad <= 0) {
        throw new AppError(422, 'CANTIDAD_INVALIDA', 'Las cantidades deben ser mayores a cero');
      }

      const filaOrigen = await _leerCantidad(conn, v.id, almacen_origen_id);
      const saldoOrigen = filaOrigen ? Number(filaOrigen.cantidad) : 0;
      if (saldoOrigen < cantidad) {
        const unidad = esPaquete ? 'kg' : 'pz';
        throw new AppError(409, 'STOCK_INSUFICIENTE',
          `No alcanza "${v.producto} · ${v.sku}": hay ${saldoOrigen} ${unidad} en el origen ` +
          `y el traspaso pide ${cantidad} ${unidad}.`);
      }
      const filaDestino = await _leerCantidad(conn, v.id, almacen_destino_id);
      const saldoDestino = filaDestino ? Number(filaDestino.cantidad) : 0;

      await _aplicarSaldo(conn, v.id, almacen_origen_id, round3(saldoOrigen - cantidad));
      await _aplicarSaldo(conn, v.id, almacen_destino_id, round3(saldoDestino + cantidad));

      await conn.query(
        `INSERT INTO traspaso_detalle (traspaso_id, variante_id, paquetes, cantidad)
         VALUES (:traspaso_id, :variante_id, :paquetes, :cantidad)`,
        { traspaso_id: traspasoId, variante_id: v.id, paquetes, cantidad }
      );

      // Kardex: las dos patas comparten el folio del traspaso.
      const base = {
        variante_id: v.id,
        tipo: 'transferencia',
        costo_unitario: null,
        referencia_tipo: 'traspaso',
        referencia_id: traspasoId,
        usuario_id: usuarioId ?? null,
        motivo: datos.notas ?? `Traspaso ${folio}`,
      };
      await _insertarMovimiento(conn, { ...base, almacen_id: almacen_origen_id, cantidad: -cantidad });
      await _insertarMovimiento(conn, { ...base, almacen_id: almacen_destino_id, cantidad });

      lineas.push({
        variante_id: v.id,
        sku: v.sku,
        producto: v.producto,
        paquetes,
        cantidad,
        unidad: esPaquete ? 'kg' : 'pz',
        saldo_origen: round3(saldoOrigen - cantidad),
        saldo_destino: round3(saldoDestino + cantidad),
      });
    }

    return { id: traspasoId, folio, almacen_origen_id, almacen_destino_id, lineas };
  });
}

/** Historial de traspasos con sus líneas. */
async function listarTraspasos({ almacen_destino_id, limit, offset }) {
  const where = almacen_destino_id ? 'WHERE t.almacen_destino_id = :almacen_destino_id' : '';
  const params = { almacen_destino_id, limit, offset };

  const [rows] = await pool.query(
    `SELECT t.id, t.folio, t.notas, t.creado_en,
            ao.nombre AS almacen_origen, ad.nombre AS almacen_destino,
            u.nombre AS usuario,
            (SELECT COUNT(*) FROM traspaso_detalle d WHERE d.traspaso_id = t.id) AS num_lineas
       FROM traspasos t
       JOIN almacenes ao    ON ao.id = t.almacen_origen_id
       JOIN almacenes ad    ON ad.id = t.almacen_destino_id
       LEFT JOIN usuarios u ON u.id = t.usuario_id
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
      `SELECT d.traspaso_id, d.variante_id, d.paquetes, d.cantidad,
              pv.sku, pv.tipo_presentacion, prod.nombre AS producto
         FROM traspaso_detalle d
         JOIN producto_variantes pv ON pv.id = d.variante_id
         JOIN productos prod        ON prod.id = pv.producto_id
        WHERE d.traspaso_id IN (:ids)
        ORDER BY d.id`,
      { ids: rows.map((r) => r.id) }
    );
    const porTraspaso = new Map(rows.map((r) => [r.id, []]));
    for (const d of det) porTraspaso.get(d.traspaso_id)?.push(d);
    for (const r of rows) r.lineas = porTraspaso.get(r.id) ?? [];
  }
  return { rows, total };
}

/** Un traspaso con sus líneas, para poder ver qué se mandó desde el kardex. */
async function obtenerTraspaso(id) {
  const [rows] = await pool.query(
    `SELECT t.id, t.folio, t.notas, t.creado_en,
            ao.nombre AS almacen_origen, ad.nombre AS almacen_destino,
            u.nombre AS usuario
       FROM traspasos t
       JOIN almacenes ao    ON ao.id = t.almacen_origen_id
       JOIN almacenes ad    ON ad.id = t.almacen_destino_id
       LEFT JOIN usuarios u ON u.id = t.usuario_id
      WHERE t.id = :id LIMIT 1`,
    { id }
  );
  const traspaso = rows[0];
  if (!traspaso) return null;

  const [lineas] = await pool.query(
    `SELECT d.variante_id, d.paquetes, d.cantidad,
            pv.sku, pv.tipo_presentacion, pv.peso_kg, prod.nombre AS producto
       FROM traspaso_detalle d
       JOIN producto_variantes pv ON pv.id = d.variante_id
       JOIN productos prod        ON prod.id = pv.producto_id
      WHERE d.traspaso_id = :id
      ORDER BY d.id`,
    { id }
  );
  traspaso.lineas = lineas;
  return traspaso;
}

/** Historial de desarmes, para auditar de dónde salieron los conos. */
async function listarConversiones({ variante_id, limit, offset }) {
  const where = variante_id
    ? 'WHERE c.variante_origen_id = :variante_id OR c.variante_destino_id = :variante_id'
    : '';
  const params = { variante_id, limit, offset };

  const [rows] = await pool.query(
    `SELECT c.id, c.paquetes, c.kg_consumidos, c.piezas_generadas, c.motivo, c.creado_en,
            c.variante_origen_id, vo.sku AS paquete_sku,
            c.variante_destino_id, vd.sku AS cono_sku,
            prod.nombre AS producto,
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

module.exports = {
  listarStock,
  resumenPorAlmacen,
  alertas,
  listarMovimientos,
  registrarMovimiento,
  transferir,
  desarmar,
  listarConversiones,
  crearTraspaso,
  listarTraspasos,
  obtenerTraspaso,
  configurar,
};
