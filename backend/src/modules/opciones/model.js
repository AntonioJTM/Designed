'use strict';

const { pool } = require('../../config/db');

// Tablas de referencia (catálogos auxiliares) para los selects del panel. El SQL
// vive aquí y no en el controlador (2026-10-26, auditoría).

/** Líneas de procedencia del hilo: turco, nacional, chino. */
async function lineas() {
  const [rows] = await pool.query('SELECT id, nombre FROM lineas WHERE activo = 1 ORDER BY nombre');
  return rows;
}

async function unidades() {
  const [rows] = await pool.query('SELECT id, nombre, abreviatura FROM unidades_medida ORDER BY nombre');
  return rows;
}

async function impuestos() {
  const [rows] = await pool.query('SELECT id, nombre, porcentaje FROM impuestos WHERE activo = 1 ORDER BY nombre');
  return rows;
}

/** "Saldo a favor" es interno: lo asienta el sistema, no se elige al cobrar. */
async function metodosPago() {
  const [rows] = await pool.query('SELECT id, nombre FROM metodos_pago WHERE activo = 1 AND interno = 0 ORDER BY nombre');
  return rows;
}

module.exports = { lineas, unidades, impuestos, metodosPago };
