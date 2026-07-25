'use strict';

const { pool } = require('../../config/db');

// Acceso a datos de `categorias`. Lista plana: no hay jerarquía.

async function listar({ q, activo, limit, offset }) {
  const where = [];
  const params = {};
  if (q) {
    where.push('c.nombre LIKE :q');
    params.q = `%${q}%`;
  }
  if (activo !== undefined) {
    where.push('c.activo = :activo');
    params.activo = activo ? 1 : 0;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT c.id, c.nombre, c.calibres,
            c.descripcion, c.imagen_url, c.orden, c.activo
       FROM categorias c
       ${whereSql}
      ORDER BY c.orden, c.nombre
      LIMIT :limit OFFSET :offset`,
    { ...params, limit, offset }
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM categorias c ${whereSql}`,
    params
  );
  return { rows, total };
}

async function obtener(id) {
  const [rows] = await pool.query(
    `SELECT c.id, c.nombre, c.calibres,
            c.descripcion, c.imagen_url, c.orden, c.activo
       FROM categorias c
      WHERE c.id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

async function crear(datos) {
  const [r] = await pool.query(
    `INSERT INTO categorias (nombre, descripcion, calibres, imagen_url, orden, activo)
     VALUES (:nombre, :descripcion, :calibres, :imagen_url, :orden, :activo)`,
    datos
  );
  return obtener(r.insertId);
}

async function actualizar(id, datos) {
  await pool.query(
    `UPDATE categorias SET
        nombre = :nombre, calibres = :calibres,
        descripcion = :descripcion, imagen_url = :imagen_url,
        orden = :orden, activo = :activo
      WHERE id = :id`,
    { ...datos, id }
  );
  return obtener(id);
}

async function eliminar(id) {
  const [r] = await pool.query('DELETE FROM categorias WHERE id = :id', { id });
  return r.affectedRows > 0;
}

/** Cuenta las dependencias que impiden el borrado. */
async function contarDependencias(id) {
  const [[row]] = await pool.query(
    'SELECT (SELECT COUNT(*) FROM productos WHERE categoria_id = :id) AS productos',
    { id }
  );
  return { productos: Number(row.productos) };
}

module.exports = { listar, obtener, crear, actualizar, eliminar, contarDependencias };
