'use strict';

const { pool } = require('../../config/db');

// Tipos de cliente (listas de precio). El tipo marcado `es_publico` cobra
// `producto_variantes.precio`; los demás llevan su precio en `variante_precios`.

const CAMPOS = 'id, nombre, es_publico, orden, activo, creado_en';

async function listar({ activo } = {}) {
  const where = activo !== undefined ? 'WHERE activo = :activo' : '';
  const [rows] = await pool.query(
    `SELECT ${CAMPOS} FROM tipos_cliente ${where} ORDER BY orden, nombre`,
    { activo: activo ? 1 : 0 }
  );
  return rows;
}

async function obtener(id) {
  const [rows] = await pool.query(`SELECT ${CAMPOS} FROM tipos_cliente WHERE id = :id LIMIT 1`, { id });
  return rows[0] || null;
}

/** El tipo que cobra el precio público. */
async function publico() {
  const [rows] = await pool.query(
    `SELECT ${CAMPOS} FROM tipos_cliente WHERE es_publico = 1 LIMIT 1`
  );
  return rows[0] || null;
}

async function crear({ nombre, orden, activo }) {
  const [r] = await pool.query(
    'INSERT INTO tipos_cliente (nombre, orden, activo) VALUES (:nombre, :orden, :activo)',
    { nombre, orden, activo }
  );
  return obtener(r.insertId);
}

async function actualizar(id, { nombre, orden, activo }) {
  await pool.query(
    'UPDATE tipos_cliente SET nombre = :nombre, orden = :orden, activo = :activo WHERE id = :id',
    { id, nombre, orden, activo }
  );
  return obtener(id);
}

/** Cuántos precios y pedidos cuelgan del tipo; impiden borrarlo. */
async function dependencias(id) {
  const [[r]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM variante_precios WHERE tipo_cliente_id = :id) AS precios,
       (SELECT COUNT(*) FROM pedidos          WHERE tipo_cliente_id = :id) AS pedidos`,
    { id }
  );
  return r;
}

async function eliminar(id) {
  const [r] = await pool.query('DELETE FROM tipos_cliente WHERE id = :id', { id });
  return r.affectedRows > 0;
}

/**
 * Precio que paga un tipo de cliente por una variante.
 * Sin precio propio capturado, paga el público (`producto_variantes.precio`).
 * Devuelve null si la variante no existe.
 */
async function precioDeVariante(varianteId, tipoClienteId, ejecutor = pool) {
  const [rows] = await ejecutor.query(
    `SELECT pv.precio AS publico, pv.precio_oferta,
            (SELECT vp.precio FROM variante_precios vp
              WHERE vp.variante_id = pv.id AND vp.tipo_cliente_id = :tipo) AS propio
       FROM producto_variantes pv WHERE pv.id = :v LIMIT 1`,
    { v: varianteId, tipo: tipoClienteId ?? 0 }
  );
  return rows[0] || null;
}

module.exports = {
  listar,
  obtener,
  publico,
  crear,
  actualizar,
  dependencias,
  eliminar,
  precioDeVariante,
};
