'use strict';

const { pool } = require('../../config/db');

// Acceso a datos de `categorias`. Categoría jerárquica (padre_id auto-referencia).

async function listar({ q, activo, limit, offset }) {
  const where = [];
  const params = {};
  if (q) {
    where.push('(c.nombre LIKE :q OR c.slug LIKE :q)');
    params.q = `%${q}%`;
  }
  if (activo !== undefined) {
    where.push('c.activo = :activo');
    params.activo = activo ? 1 : 0;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT c.id, c.padre_id, p.nombre AS padre, c.nombre, c.slug,
            c.descripcion, c.imagen_url, c.orden, c.activo
       FROM categorias c
       LEFT JOIN categorias p ON p.id = c.padre_id
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
    `SELECT c.id, c.padre_id, p.nombre AS padre, c.nombre, c.slug,
            c.descripcion, c.imagen_url, c.orden, c.activo
       FROM categorias c
       LEFT JOIN categorias p ON p.id = c.padre_id
      WHERE c.id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

async function crear(datos) {
  const [r] = await pool.query(
    `INSERT INTO categorias (padre_id, nombre, slug, descripcion, imagen_url, orden, activo)
     VALUES (:padre_id, :nombre, :slug, :descripcion, :imagen_url, :orden, :activo)`,
    datos
  );
  return obtener(r.insertId);
}

async function actualizar(id, datos) {
  await pool.query(
    `UPDATE categorias SET
        padre_id = :padre_id, nombre = :nombre, slug = :slug,
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

/** Cuenta las dependencias que impiden (o afectan) el borrado. */
async function contarDependencias(id) {
  const [[row]] = await pool.query(
    `SELECT
        (SELECT COUNT(*) FROM productos  WHERE categoria_id = :id) AS productos,
        (SELECT COUNT(*) FROM categorias WHERE padre_id = :id)     AS hijos`,
    { id }
  );
  return { productos: Number(row.productos), hijos: Number(row.hijos) };
}

module.exports = { listar, obtener, crear, actualizar, eliminar, contarDependencias };
