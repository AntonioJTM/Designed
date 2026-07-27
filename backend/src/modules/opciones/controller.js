'use strict';

const { pool } = require('../../config/db');

// Endpoints de solo lectura para poblar selects del panel admin.
// Son tablas de referencia (catálogos auxiliares) del esquema.

/** Líneas de procedencia del hilo: turco, nacional, chino. */
async function lineas(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT id, nombre FROM lineas WHERE activo = 1 ORDER BY nombre');
    res.json({ data: rows, error: null });
  } catch (err) {
    next(err);
  }
}

async function unidades(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT id, nombre, abreviatura FROM unidades_medida ORDER BY nombre'
    );
    res.json({ data: rows, error: null });
  } catch (err) {
    next(err);
  }
}

async function impuestos(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT id, nombre, porcentaje FROM impuestos WHERE activo = 1 ORDER BY nombre'
    );
    res.json({ data: rows, error: null });
  } catch (err) {
    next(err);
  }
}

async function metodosPago(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT id, nombre FROM metodos_pago WHERE activo = 1 ORDER BY nombre'
    );
    res.json({ data: rows, error: null });
  } catch (err) {
    next(err);
  }
}

module.exports = { lineas, unidades, impuestos, metodosPago };
