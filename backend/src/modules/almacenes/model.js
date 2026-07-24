'use strict';

const { pool } = require('../../config/db');

// Acceso a datos de `almacenes`.

async function listar({ activo } = {}) {
  const where = activo !== undefined ? 'WHERE activo = :activo' : '';
  const [rows] = await pool.query(
    `SELECT id, nombre, direccion, es_punto_venta, activo
       FROM almacenes ${where} ORDER BY nombre`,
    { activo: activo ? 1 : 0 }
  );
  return rows;
}

async function obtener(id) {
  const [rows] = await pool.query(
    'SELECT id, nombre, direccion, es_punto_venta, activo FROM almacenes WHERE id = :id LIMIT 1',
    { id }
  );
  return rows[0] || null;
}

async function crear(datos) {
  const [r] = await pool.query(
    `INSERT INTO almacenes (nombre, direccion, es_punto_venta, activo)
     VALUES (:nombre, :direccion, :es_punto_venta, :activo)`,
    datos
  );
  return obtener(r.insertId);
}

async function actualizar(id, datos) {
  await pool.query(
    `UPDATE almacenes SET nombre = :nombre, direccion = :direccion,
        es_punto_venta = :es_punto_venta, activo = :activo
      WHERE id = :id`,
    { ...datos, id }
  );
  return obtener(id);
}

module.exports = { listar, obtener, crear, actualizar };
