'use strict';

const { pool } = require('../../config/db');

// Acceso a datos de `producto_variantes`. Es el SKU real que se vende e
// inventaría; el inventario/carrito/pedidos SIEMPRE apuntan aquí, no a productos.

const SELECT_BASE = `
  SELECT pv.id, pv.producto_id, prod.nombre AS producto,
         pv.color_id, col.nombre AS color, col.codigo_hex,
         pv.sku, pv.codigo_barras, pv.presentacion,
         pv.precio, pv.precio_oferta, pv.costo, pv.activo,
         pv.creado_en, pv.actualizado_en
    FROM producto_variantes pv
    JOIN productos prod   ON prod.id = pv.producto_id
    LEFT JOIN colores col ON col.id = pv.color_id
`;

async function listar({ producto_id, q, activo, limit, offset }) {
  const where = [];
  const params = {};
  if (producto_id !== undefined) {
    where.push('pv.producto_id = :producto_id');
    params.producto_id = producto_id;
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
  if (variante) variante.codigos = await codigosDe(id);
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
       (producto_id, color_id, sku, codigo_barras, presentacion,
        precio, precio_oferta, costo, activo)
     VALUES
       (:producto_id, :color_id, :sku, :codigo_barras, :presentacion,
        :precio, :precio_oferta, :costo, :activo)`,
    datos
  );
  return obtener(r.insertId);
}

async function actualizar(id, datos) {
  await pool.query(
    `UPDATE producto_variantes SET
        color_id = :color_id, sku = :sku, codigo_barras = :codigo_barras,
        presentacion = :presentacion, precio = :precio,
        precio_oferta = :precio_oferta, costo = :costo, activo = :activo
      WHERE id = :id`,
    { ...datos, id }
  );
  return obtener(id);
}

async function eliminar(id) {
  const [r] = await pool.query('DELETE FROM producto_variantes WHERE id = :id', { id });
  return r.affectedRows > 0;
}

module.exports = {
  listar,
  obtener,
  crear,
  actualizar,
  eliminar,
  codigosDe,
  variantePorCodigo,
  agregarCodigo,
  obtenerCodigo,
  eliminarCodigo,
};
