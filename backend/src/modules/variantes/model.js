'use strict';

const { pool, withTransaction } = require('../../config/db');
const { porPalabras } = require('../../utils/query');
const { anotarAlmacen, anotarCompartido } = require('../tiempo-real/contexto');

// Acceso a datos de `producto_variantes`. Es el SKU real que se vende e
// inventaría; el inventario/carrito/pedidos SIEMPRE apuntan aquí, no a productos.

// `unidad` es la unidad del producto y `unidad_venta` la de ESTA presentación:
// las tres (paquete, cono y simple) se venden por KILO. El POS y el carrito la
// usan para rotular la cantidad.
// `paquete_*` trae los datos del paquete de origen cuando la variante es cono,
// para poder mostrar de dónde salió su precio calculado.
const SELECT_BASE = `
  SELECT pv.id, pv.producto_id, prod.nombre AS producto,
         pv.sku, pv.codigo_barras, pv.presentacion, pv.lote,
         pv.tipo_presentacion, pv.peso_kg, pv.origen_variante_id,
         pv.piezas_por_origen, pv.modo_precio,
         pv.precio, pv.precio_oferta, pv.costo, pv.activo,
         um.abreviatura AS unidad,
         -- El cono también se vende por KILO: es el mismo hilo, solo enconado.
         -- Las piezas (piezas_por_origen) quedan como dato informativo.
         CASE pv.tipo_presentacion
           WHEN 'paquete' THEN 'kg'
           WHEN 'cono'    THEN 'kg'
           ELSE um.abreviatura
         END AS unidad_venta,
         prod.multipresentacion, prod.por_lotes,
         -- Cómo se identifica el hilo. Va aquí porque el selector de "a qué
         -- presentación entra la remesa" decía solo "AMARILLO · AMARILLO", y con
         -- el mismo color en dos calibres no hay forma de elegir bien: ya se
         -- cargaron tres listas de empaque al producto equivocado.
         prod.grosor_calibre AS calibre, cat.nombre AS material, lin.nombre AS linea,
         org.sku      AS paquete_sku,
         org.precio   AS paquete_precio_kg,
         org.peso_kg  AS paquete_peso_kg,
         pv.creado_en, pv.actualizado_en
    FROM producto_variantes pv
    JOIN productos prod                 ON prod.id = pv.producto_id
    JOIN unidades_medida um             ON um.id = prod.unidad_medida_id
    JOIN categorias cat                 ON cat.id = prod.categoria_id
    LEFT JOIN lineas lin                ON lin.id = prod.linea_id
    LEFT JOIN producto_variantes org    ON org.id = pv.origen_variante_id
`;

async function listar({ producto_id, q, activo, tipo_presentacion, limit, offset }) {
  const where = [];
  const params = {};
  if (producto_id !== undefined) {
    where.push('pv.producto_id = :producto_id');
    params.producto_id = producto_id;
  }
  // Filtrar del lado del servidor importa donde solo sirve un tipo: la
  // recepción de remesas solo admite paquetes, y traer una página de variantes
  // para descartarlas en el cliente dejaría fuera las que no cupieron.
  if (tipo_presentacion) {
    where.push('pv.tipo_presentacion = :tipo_presentacion');
    params.tipo_presentacion = tipo_presentacion;
  }
  // Busca por SKU, código principal, color, calibre o cualquier código
  // adicional de la variante (sus bultos, en variante_codigos), palabra por
  // palabra: "rojo 2/30" encuentra el rojo de ese calibre.
  const busca = porPalabras(q, [
    'pv.sku', 'pv.codigo_barras', 'prod.nombre',
    { col: 'prod.grosor_calibre', calibre: true },
    // EXISTS y no GROUP_CONCAT: GROUP_CONCAT se corta a 1,024 caracteres y en
    // una remesa de 80 bultos los últimos códigos ya no se encontrarían.
    (p) => `EXISTS (SELECT 1 FROM variante_codigos vc WHERE vc.variante_id = pv.id AND vc.codigo LIKE ${p})`,
  ]);
  if (busca) {
    where.push(busca.sql);
    Object.assign(params, busca.params);
  }
  if (activo !== undefined) {
    where.push('pv.activo = :activo');
    params.activo = activo ? 1 : 0;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `${SELECT_BASE} ${whereSql} ORDER BY pv.id LIMIT :limit OFFSET :offset`,
    { ...params, limit, offset }
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM producto_variantes pv
       JOIN productos prod ON prod.id = pv.producto_id ${whereSql}`,
    params
  );
  return { rows, total };
}

/**
 * Le pega a cada presentación lo que hay de ella en UN almacén (`aqui`): los
 * kilos y, si es paquete, cuántos paquetes cerrados se ubican ahí. Lo usa la
 * caja al buscar: "hay 20 paquetes" o "hay 12.5 kg enconados" en ESA tienda,
 * antes de pesar nada.
 */
async function conExistenciaEn(rows, almacenId) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const [inv] = await pool.query(
    `SELECT variante_id, cantidad FROM inventario WHERE almacen_id = :a AND variante_id IN (:ids)`,
    { a: almacenId, ids }
  );
  const [paq] = await pool.query(
    `SELECT variante_id, COUNT(*) AS n FROM variante_codigos
      WHERE estado = 'disponible' AND almacen_id = :a AND variante_id IN (:ids)
      GROUP BY variante_id`,
    { a: almacenId, ids }
  );
  // Lo vendido sin entregar (notas en espera, apartados) ya tiene dueño: la venta
  // valida contra lo que queda (`_apartadoEnAlmacen`), y la caja decía "hay 8 kg"
  // con 5 de una nota en espera (2026-10-26, auditoría).
  const [ap] = await pool.query(
    `SELECT pd.variante_id, SUM(pd.cantidad) AS kg
       FROM pedido_detalle pd
       JOIN pedidos p ON p.id = pd.pedido_id
      WHERE p.inventario_descontado = 0 AND p.estado NOT IN ('cancelado', 'devuelto')
        AND p.almacen_id = :a AND pd.variante_id IN (:ids)
      GROUP BY pd.variante_id`,
    { a: almacenId, ids }
  );
  const apartado = new Map(ap.map((x) => [x.variante_id, Number(x.kg)]));
  const kg = new Map(inv.map((x) => [
    x.variante_id, Math.max(0, Math.round((Number(x.cantidad) - (apartado.get(x.variante_id) ?? 0)) * 1000) / 1000),
  ]));
  const n = new Map(paq.map((x) => [x.variante_id, Number(x.n)]));
  for (const r of rows) {
    r.aqui = {
      cantidad: kg.get(r.id) ?? 0,
      paquetes: r.tipo_presentacion === 'cono' ? null : n.get(r.id) ?? 0,
    };
  }
  return rows;
}

// `conn`: la de una transacción abierta (la presentación que nace dentro de una
// carga, un desarme o una devolución, 2026-10-26); sin ella, el pool.
async function obtener(id, conn = pool) {
  const [rows] = await conn.query(`${SELECT_BASE} WHERE pv.id = :id LIMIT 1`, { id });
  const variante = rows[0] || null;
  if (variante) {
    variante.codigos = await codigosDe(id, conn);
    variante.precios = await preciosDe(id, conn);
  }
  return variante;
}

// ---- Códigos de barras adicionales por variante ----

async function codigosDe(varianteId, conn = pool) {
  // Cada renglón es un BULTO: trae su peso real, su lote y cuántos conos rinde.
  // Se incluye el folio de la remesa que lo trajo para poder rastrear de dónde
  // salió (los que se capturaron a mano no tienen remesa).
  // El almacén lo pone la carga y lo cambia el traspaso (la venta ya no lo corrige:
  // solo vende los paquetes de esa tienda, 2026-10-07); es lo que permite decir
  // "dónde está" cada bulto en la pantalla de presentaciones. Los capturados a mano llevan el almacén que
  // se eligió (desde el 2026-10-07; antes quedaban en NULL) y `con_entrada`
  // dice si el bulto METIÓ kilos al inventario —llegó en una carga, o se
  // capturó a mano desde el 2026-10-07—: quitarlo los saca.
  const [rows] = await conn.query(
    `SELECT vc.id, vc.variante_id, vc.codigo, vc.peso_kg, vc.lote, vc.conos,
            vc.estado, vc.consumido_en, vc.consumido_tipo, vc.consumido_id,
            COALESCE(ped.numero_pedido, tra.folio) AS consumido_folio,
            vc.remesa_id, r.folio AS remesa_folio, vc.etiqueta, vc.creado_en,
            vc.almacen_id, alm.nombre AS almacen,
            (vc.remesa_id IS NOT NULL OR EXISTS (
               SELECT 1 FROM movimientos_inventario mi
                WHERE mi.referencia_tipo = 'bulto' AND mi.referencia_id = vc.id
                  AND mi.tipo = 'entrada')) AS con_entrada
       FROM variante_codigos vc
       LEFT JOIN remesas r ON r.id = vc.remesa_id
       LEFT JOIN almacenes alm ON alm.id = vc.almacen_id
       LEFT JOIN pedidos ped ON vc.consumido_tipo = 'pedido' AND ped.id = vc.consumido_id
       LEFT JOIN traspasos tra ON vc.consumido_tipo = 'traspaso' AND tra.id = vc.consumido_id
      WHERE vc.variante_id = :id
      ORDER BY vc.estado, vc.lote, vc.id`,
    { id: varianteId }
  );
  return rows;
}

/** Busca una variante por su SKU. Sirve para no repetir SKU al generarlos. */
async function porSku(sku) {
  const [rows] = await pool.query(
    'SELECT id, sku FROM producto_variantes WHERE sku = :sku LIMIT 1',
    { sku }
  );
  return rows[0] || null;
}

/** Devuelve la variante dueña de un código (principal o adicional), o null. */
async function variantePorCodigo(codigo) {
  const [rows] = await pool.query(
    `SELECT id FROM producto_variantes WHERE codigo_barras = :c
     UNION
     SELECT variante_id AS id FROM variante_codigos WHERE codigo = :c
     LIMIT 1`,
    { c: codigo }
  );
  return rows[0] ? rows[0].id : null;
}

/**
 * Resuelve un código escaneado: devuelve el BULTO al que pertenece, si el
 * código es de un bulto registrado. Es lo que permite cobrar por lo que ESE
 * bulto pesa de verdad en vez de por el peso nominal de la presentación —los
 * bultos de una misma remesa varían entre sí (18.65, 18.80, 19.05…).
 *
 * Devuelve null si el código no corresponde a ningún bulto (p.ej. es el código
 * principal de la presentación, sin peso propio).
 */
async function bultoPorCodigo(codigo) {
  const [rows] = await pool.query(
    `SELECT vc.id, vc.variante_id, vc.codigo, vc.peso_kg, vc.lote, vc.conos,
            vc.estado, vc.consumido_en, vc.consumido_tipo, vc.consumido_id,
            COALESCE(ped.numero_pedido, tra.folio) AS consumido_folio,
            r.folio AS remesa_folio,
            -- Dónde lo tiene el sistema (la caja solo vende los de su tienda) y
            -- si viene en camino en un envío todavía sin recibir.
            vc.almacen_id, alm.nombre AS almacen,
            (SELECT t.folio
               FROM traspaso_bultos tb
               JOIN traspaso_detalle td ON td.id = tb.detalle_id
               JOIN traspasos t         ON t.id = td.traspaso_id
              WHERE tb.variante_codigo_id = vc.id AND t.estado = 'en_transito'
              ORDER BY t.id DESC LIMIT 1) AS en_camino_folio
       FROM variante_codigos vc
       LEFT JOIN remesas r ON r.id = vc.remesa_id
       LEFT JOIN almacenes alm ON alm.id = vc.almacen_id
       LEFT JOIN pedidos ped ON vc.consumido_tipo = 'pedido' AND ped.id = vc.consumido_id
       LEFT JOIN traspasos tra ON vc.consumido_tipo = 'traspaso' AND tra.id = vc.consumido_id
      WHERE vc.codigo = :c
      LIMIT 1`,
    { c: codigo }
  );
  return rows[0] || null;
}

/**
 * Da de alta un bulto capturado a mano y da ENTRADA a sus kilos en su almacén
 * (2026-10-07: "sí se suman los kilos de la entrada de ese paquete"): el bulto,
 * el saldo y su movimiento en el kardex (referencia 'bulto'), en una sola
 * transacción. Si la presentación todavía no tenía peso, toma el de este bulto
 * (el desarme lo necesita).
 */
async function agregarBultoConEntrada(varianteId, datos, usuarioId) {
  const { codigo, etiqueta, peso_kg, lote, conos, almacen_id } = datos;
  return withTransaction(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO variante_codigos (variante_id, codigo, peso_kg, lote, conos, etiqueta, almacen_id)
       VALUES (:v, :c, :peso, :lote, :conos, :e, :a)`,
      {
        v: varianteId, c: codigo, peso: peso_kg, lote: lote ?? null, conos: conos ?? null,
        e: etiqueta ?? null, a: almacen_id,
      }
    );
    await conn.query(
      `INSERT INTO inventario (variante_id, almacen_id, cantidad) VALUES (:v, :a, :kg)
       ON DUPLICATE KEY UPDATE cantidad = cantidad + :kg`,
      { v: varianteId, a: almacen_id, kg: peso_kg }
    );
    anotarAlmacen(almacen_id);
    await conn.query(
      `INSERT INTO movimientos_inventario
         (variante_id, almacen_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id, motivo)
       VALUES (:v, :a, 'entrada', :kg, 'bulto', :id, :u, :motivo)`,
      {
        v: varianteId, a: almacen_id, kg: peso_kg, id: r.insertId, u: usuarioId ?? null,
        motivo: `Bulto capturado a mano ${codigo} (${Number(peso_kg)} kg)`,
      }
    );
    await conn.query(
      'UPDATE producto_variantes SET peso_kg = :kg WHERE id = :v AND peso_kg IS NULL',
      { v: varianteId, kg: peso_kg }
    );
    const [rows] = await conn.query(
      `SELECT vc.*, alm.nombre AS almacen, 1 AS con_entrada
         FROM variante_codigos vc LEFT JOIN almacenes alm ON alm.id = vc.almacen_id
        WHERE vc.id = :id`,
      { id: r.insertId }
    );
    return rows[0];
  });
}

/**
 * Quita un bulto que METIÓ kilos (llegó en una carga del proveedor o se capturó
 * a mano) y SACA esos kilos del almacén donde está hoy (un traspaso pudo
 * moverlo; si no se sabe, el de su carga). Exige que el saldo alcance; deja la
 * salida en el kardex con referencia al bulto.
 */
async function quitarBultoConSalida(bulto, usuarioId) {
  return withTransaction(async (conn) => {
    const [[vc]] = await conn.query(
      `SELECT vc.id, vc.codigo, vc.estado, vc.peso_kg, vc.variante_id, r.folio AS carga,
              COALESCE(vc.almacen_id, r.almacen_id) AS almacen_id, alm.nombre AS almacen
         FROM variante_codigos vc
         LEFT JOIN remesas r     ON r.id = vc.remesa_id
         LEFT JOIN almacenes alm ON alm.id = COALESCE(vc.almacen_id, r.almacen_id)
        WHERE vc.id = :id FOR UPDATE`,
      { id: bulto.id }
    );
    if (!vc) return null;
    // Se vuelve a mirar CON el paquete bloqueado (2026-10-26, auditoría): si la caja
    // lo vendió mientras se confirmaba «Quitar», sus kilos saldrían dos veces.
    if (vc.estado && vc.estado !== 'disponible') return { error: 'NO_DISPONIBLE', estado: vc.estado };
    const kg = Number(vc.peso_kg ?? 0);
    if (!(kg > 0) || !vc.almacen_id) {
      // Sin peso o sin almacén no hay kilos que sacar: solo se borra.
      await conn.query('DELETE FROM variante_codigos WHERE id = :id', { id: vc.id });
      return { kg: 0, almacen: null };
    }
    const [[inv]] = await conn.query(
      'SELECT cantidad FROM inventario WHERE variante_id = :v AND almacen_id = :a FOR UPDATE',
      { v: vc.variante_id, a: vc.almacen_id }
    );
    const hay = inv ? Number(inv.cantidad) : 0;
    if (hay + 0.0005 < kg) {
      return { error: 'STOCK_INSUFICIENTE', hay, kg, almacen: vc.almacen };
    }
    await conn.query(
      'UPDATE inventario SET cantidad = cantidad - :kg WHERE variante_id = :v AND almacen_id = :a',
      { v: vc.variante_id, a: vc.almacen_id, kg }
    );
    anotarAlmacen(vc.almacen_id);
    await conn.query(
      `INSERT INTO movimientos_inventario
         (variante_id, almacen_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id, motivo)
       VALUES (:v, :a, 'salida', :kg, 'bulto', :id, :u, :motivo)`,
      {
        v: vc.variante_id, a: vc.almacen_id, kg: -kg, id: vc.id, u: usuarioId ?? null,
        motivo: vc.carga
          ? `Se quitó el bulto ${vc.codigo} (${kg} kg) de la carga ${vc.carga}`
          : `Se quitó el bulto capturado a mano ${vc.codigo} (${kg} kg)`,
      }
    );
    await conn.query('DELETE FROM variante_codigos WHERE id = :id', { id: vc.id });
    return { kg, almacen: vc.almacen };
  });
}

/** ¿Al capturar este bulto entraron sus kilos? (lo capturado a mano desde el 2026-10-07). */
async function bultoConEntrada(id) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS n FROM movimientos_inventario
      WHERE referencia_tipo = 'bulto' AND referencia_id = :id AND tipo = 'entrada'`,
    { id }
  );
  return Number(r.n) > 0;
}

/** Dónde hay existencias de la presentación: los almacenes con saldo, el mayor primero. */
async function almacenesConExistencia(varianteId) {
  const [rows] = await pool.query(
    `SELECT i.almacen_id, a.nombre AS almacen, i.cantidad
       FROM inventario i JOIN almacenes a ON a.id = i.almacen_id
      WHERE i.variante_id = :v AND i.cantidad > 0
      ORDER BY i.cantidad DESC, a.nombre`,
    { v: varianteId }
  );
  return rows.map((r) => ({ almacen_id: Number(r.almacen_id), almacen: r.almacen, cantidad: Number(r.cantidad) }));
}

async function obtenerCodigo(id) {
  const [rows] = await pool.query('SELECT * FROM variante_codigos WHERE id = :id', { id });
  return rows[0] || null;
}

async function eliminarCodigo(id) {
  const [r] = await pool.query('DELETE FROM variante_codigos WHERE id = :id', { id });
  return r.affectedRows > 0;
}

async function crear(datos, conn = pool) {
  anotarCompartido('catalogo');
  const [r] = await conn.query(
    `INSERT INTO producto_variantes
       (producto_id, sku, codigo_barras, presentacion, lote,
        tipo_presentacion, peso_kg, origen_variante_id, piezas_por_origen, modo_precio,
        precio, precio_oferta, costo, activo)
     VALUES
       (:producto_id, :sku, :codigo_barras, :presentacion, :lote,
        :tipo_presentacion, :peso_kg, :origen_variante_id, :piezas_por_origen, :modo_precio,
        :precio, :precio_oferta, :costo, :activo)`,
    datos
  );
  return obtener(r.insertId, conn);
}

async function actualizar(id, datos) {
  await pool.query(
    `UPDATE producto_variantes SET
        sku = :sku, codigo_barras = :codigo_barras,
        presentacion = :presentacion, lote = :lote, tipo_presentacion = :tipo_presentacion,
        peso_kg = :peso_kg, origen_variante_id = :origen_variante_id,
        piezas_por_origen = :piezas_por_origen, modo_precio = :modo_precio,
        precio = :precio, precio_oferta = :precio_oferta, costo = :costo, activo = :activo
      WHERE id = :id`,
    { ...datos, id }
  );
  return obtener(id);
}

async function eliminar(id) {
  const [r] = await pool.query('DELETE FROM producto_variantes WHERE id = :id', { id });
  return r.affectedRows > 0;
}

// (El borrado de una presentación se quitó el 2026-10-20: ver service.js → eliminar.)

/** Precios por tipo de cliente de una variante (sin incluir el público). */
async function preciosDe(varianteId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT vp.tipo_cliente_id, tc.nombre AS tipo_cliente, vp.precio
       FROM variante_precios vp
       JOIN tipos_cliente tc ON tc.id = vp.tipo_cliente_id
      WHERE vp.variante_id = :id
      ORDER BY tc.orden, tc.nombre`,
    { id: varianteId }
  );
  return rows;
}

/** Los precios por lista de varias variantes de una vez: Map variante_id → [...]. */
async function preciosDeVarias(ids) {
  const mapa = new Map();
  if (!ids.length) return mapa;
  const [rows] = await pool.query(
    `SELECT vp.variante_id, vp.tipo_cliente_id, tc.nombre AS tipo_cliente, vp.precio
       FROM variante_precios vp
       JOIN tipos_cliente tc ON tc.id = vp.tipo_cliente_id
      WHERE vp.variante_id IN (:ids)
      ORDER BY tc.orden, tc.nombre`,
    { ids }
  );
  for (const r of rows) {
    const { variante_id, ...precio } = r;
    if (!mapa.has(variante_id)) mapa.set(variante_id, []);
    mapa.get(variante_id).push(precio);
  }
  return mapa;
}

/**
 * Fija el precio de una variante para un tipo de cliente. Un precio null borra
 * la fila, con lo que ese tipo vuelve a pagar el precio público.
 */
async function fijarPrecioTipo(varianteId, tipoClienteId, precio) {
  if (precio === null) {
    await pool.query(
      'DELETE FROM variante_precios WHERE variante_id = :v AND tipo_cliente_id = :t',
      { v: varianteId, t: tipoClienteId }
    );
    return;
  }
  await pool.query(
    `INSERT INTO variante_precios (variante_id, tipo_cliente_id, precio)
     VALUES (:v, :t, :precio)
     ON DUPLICATE KEY UPDATE precio = :precio`,
    { v: varianteId, t: tipoClienteId, precio }
  );
}

/** Conos con precio calculado que dependen de este paquete. */
async function derivadasDe(paqueteId) {
  const [rows] = await pool.query(
    `SELECT id, piezas_por_origen FROM producto_variantes
      WHERE origen_variante_id = :id AND modo_precio = 'calculado'`,
    { id: paqueteId }
  );
  return rows;
}

/** Fija el precio de una variante sin tocar el resto de sus campos. */
async function fijarPrecio(id, precio) {
  await pool.query('UPDATE producto_variantes SET precio = :precio WHERE id = :id', { id, precio });
}

module.exports = {
  listar,
  obtener,
  crear,
  actualizar,
  eliminar,
  derivadasDe,
  fijarPrecio,
  preciosDe,
  preciosDeVarias,
  conExistenciaEn,
  fijarPrecioTipo,
  codigosDe,
  porSku,
  variantePorCodigo,
  bultoPorCodigo,
  agregarBultoConEntrada,
  quitarBultoConSalida,
  bultoConEntrada,
  almacenesConExistencia,
  obtenerCodigo,
  eliminarCodigo,
};
