'use strict';

const { pool, withTransaction } = require('../../config/db');

// Acceso a datos de `producto_imagenes`.

async function listar({ producto_id }) {
  const [rows] = await pool.query(
    `SELECT id, producto_id, variante_id, url, es_principal, orden
       FROM producto_imagenes
      WHERE producto_id = :producto_id
      ORDER BY es_principal DESC, orden`,
    { producto_id }
  );
  return rows;
}

async function obtener(id) {
  const [rows] = await pool.query(
    `SELECT id, producto_id, variante_id, url, es_principal, orden
       FROM producto_imagenes WHERE id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

/** Inserta una imagen; si es principal, desmarca las demás del mismo producto. */
async function crear(datos) {
  return withTransaction(async (conn) => {
    if (datos.es_principal) {
      await conn.query(
        'UPDATE producto_imagenes SET es_principal = 0 WHERE producto_id = :producto_id',
        { producto_id: datos.producto_id }
      );
    }
    const [r] = await conn.query(
      `INSERT INTO producto_imagenes (producto_id, variante_id, url, es_principal, orden)
       VALUES (:producto_id, :variante_id, :url, :es_principal, :orden)`,
      datos
    );
    const [rows] = await conn.query('SELECT * FROM producto_imagenes WHERE id = :id', {
      id: r.insertId,
    });
    return rows[0];
  });
}

async function actualizar(id, datos) {
  return withTransaction(async (conn) => {
    if (datos.es_principal) {
      await conn.query(
        'UPDATE producto_imagenes SET es_principal = 0 WHERE producto_id = :producto_id AND id <> :id',
        { producto_id: datos.producto_id, id }
      );
    }
    await conn.query(
      `UPDATE producto_imagenes SET
          variante_id = :variante_id, url = :url,
          es_principal = :es_principal, orden = :orden
        WHERE id = :id`,
      { ...datos, id }
    );
    const [rows] = await conn.query('SELECT * FROM producto_imagenes WHERE id = :id', { id });
    return rows[0];
  });
}

async function eliminar(id) {
  const [r] = await pool.query('DELETE FROM producto_imagenes WHERE id = :id', { id });
  return r.affectedRows > 0;
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
