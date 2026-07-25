'use strict';

const { pool } = require('../../config/db');

// Acceso a datos de `producto_variantes`. Es el SKU real que se vende e
// inventaría; el inventario/carrito/pedidos SIEMPRE apuntan aquí, no a productos.

// `unidad` es la unidad del producto y `unidad_venta` la de ESTA presentación:
// un paquete se vende por kilo y un cono por pieza, aunque el producto se mida
// en kg. El POS y el carrito la usan para rotular la cantidad.
// `paquete_*` trae los datos del paquete de origen cuando la variante es cono,
// para poder mostrar de dónde salió su precio calculado.
const SELECT_BASE = `
  SELECT pv.id, pv.producto_id, prod.nombre AS producto,
         pv.color_id, col.nombre AS color, col.codigo_hex,
         pv.sku, pv.codigo_barras, pv.presentacion, pv.lote,
         pv.tipo_presentacion, pv.peso_kg, pv.origen_variante_id,
         pv.piezas_por_origen, pv.modo_precio,
         pv.precio, pv.precio_oferta, pv.costo, pv.activo,
         um.abreviatura AS unidad,
         CASE pv.tipo_presentacion
           WHEN 'paquete' THEN 'kg'
           WHEN 'cono'    THEN 'pieza'
           ELSE um.abreviatura
         END AS unidad_venta,
         prod.multipresentacion, prod.por_lotes,
         org.sku      AS paquete_sku,
         org.precio   AS paquete_precio_kg,
         org.peso_kg  AS paquete_peso_kg,
         pv.creado_en, pv.actualizado_en
    FROM producto_variantes pv
    JOIN productos prod                 ON prod.id = pv.producto_id
    JOIN unidades_medida um             ON um.id = prod.unidad_medida_id
    LEFT JOIN colores col               ON col.id = pv.color_id
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
  if (q) {
    // Busca por SKU, código principal, nombre de producto o cualquier código
    // adicional de la variante (agrupados por color en variante_codigos).
    where.push(`(pv.sku LIKE :q OR pv.codigo_barras LIKE :q OR prod.nombre LIKE :q
      OR EXISTS (SELECT 1 FROM variante_codigos vc WHERE vc.variante_id = pv.id AND vc.codigo LIKE :q))`);
    params.q = `%${q}%`;
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

async function obtener(id) {
  const [rows] = await pool.query(`${SELECT_BASE} WHERE pv.id = :id LIMIT 1`, { id });
  const variante = rows[0] || null;
  if (variante) {
    variante.codigos = await codigosDe(id);
    variante.precios = await preciosDe(id);
  }
  return variante;
}

// ---- Códigos de barras adicionales por variante ----

async function codigosDe(varianteId) {
  const [rows] = await pool.query(
    'SELECT id, variante_id, codigo, etiqueta, creado_en FROM variante_codigos WHERE variante_id = :id ORDER BY id',
    { id: varianteId }
  );
  return rows;
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

async function agregarCodigo(varianteId, codigo, etiqueta) {
  const [r] = await pool.query(
    'INSERT INTO variante_codigos (variante_id, codigo, etiqueta) VALUES (:v, :c, :e)',
    { v: varianteId, c: codigo, e: etiqueta ?? null }
  );
  const [rows] = await pool.query('SELECT * FROM variante_codigos WHERE id = :id', { id: r.insertId });
  return rows[0];
}

async function obtenerCodigo(id) {
  const [rows] = await pool.query('SELECT * FROM variante_codigos WHERE id = :id', { id });
  return rows[0] || null;
}

async function eliminarCodigo(id) {
  const [r] = await pool.query('DELETE FROM variante_codigos WHERE id = :id', { id });
  return r.affectedRows > 0;
}

async function crear(datos) {
  const [r] = await pool.query(
    `INSERT INTO producto_variantes
       (producto_id, color_id, sku, codigo_barras, presentacion, lote,
        tipo_presentacion, peso_kg, origen_variante_id, piezas_por_origen, modo_precio,
        precio, precio_oferta, costo, activo)
     VALUES
       (:producto_id, :color_id, :sku, :codigo_barras, :presentacion, :lote,
        :tipo_presentacion, :peso_kg, :origen_variante_id, :piezas_por_origen, :modo_precio,
        :precio, :precio_oferta, :costo, :activo)`,
    datos
  );
  return obtener(r.insertId);
}

async function actualizar(id, datos) {
  await pool.query(
    `UPDATE producto_variantes SET
        color_id = :color_id, sku = :sku, codigo_barras = :codigo_barras,
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

/** Precios por tipo de cliente de una variante (sin incluir el público). */
async function preciosDe(varianteId) {
  const [rows] = await pool.query(
    `SELECT vp.tipo_cliente_id, tc.nombre AS tipo_cliente, vp.precio
       FROM variante_precios vp
       JOIN tipos_cliente tc ON tc.id = vp.tipo_cliente_id
      WHERE vp.variante_id = :id
      ORDER BY tc.orden, tc.nombre`,
    { id: varianteId }
  );
  return rows;
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
  fijarPrecioTipo,
  codigosDe,
  variantePorCodigo,
  agregarCodigo,
  obtenerCodigo,
  eliminarCodigo,
};
