'use strict';

const { pool } = require('../../config/db');

// Tipos de cliente (listas de precio). El tipo marcado `es_publico` cobra
// `producto_variantes.precio`; los demás llevan su precio en `variante_precios`.

const CAMPOS = 'id, nombre, es_publico, orden, activo, creado_en';

/**
 * El listado trae además, de SOLO LECTURA, cuántos clientes la usan y en
 * cuántas presentaciones tiene precio propio: es lo que la pantalla de Listas
 * de precio necesita para saber si una lista se usa antes de apagarla o
 * borrarla. Un cliente sin lista (`tipo_cliente_id` NULL) paga el público —así
 * lo aplica el punto de venta—, por eso cuenta en la del público. Solo se
 * cuentan clientes activos y presentaciones activas.
 */
async function listar({ activo } = {}) {
  const where = activo !== undefined ? 'WHERE t.activo = :activo' : '';
  const [rows] = await pool.query(
    `SELECT t.id, t.nombre, t.es_publico, t.orden, t.activo, t.creado_en,
            (SELECT COUNT(*) FROM clientes c
              WHERE c.activo = 1
                AND (c.tipo_cliente_id = t.id OR (t.es_publico = 1 AND c.tipo_cliente_id IS NULL))
            ) AS num_clientes,
            (SELECT COUNT(*) FROM variante_precios vp
               JOIN producto_variantes pv ON pv.id = vp.variante_id
              WHERE vp.tipo_cliente_id = t.id AND pv.activo = 1
            ) AS num_precios
       FROM tipos_cliente t ${where}
      ORDER BY t.orden, t.nombre`,
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

module.exports = {
  listar,
  obtener,
  publico,
  crear,
  actualizar,
  dependencias,
  eliminar,
};
