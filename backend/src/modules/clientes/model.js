'use strict';

const { pool } = require('../../config/db');

// Acceso a datos de la tabla `clientes`.
// Nota: en el esquema, correo y contrasena_hash son NULL-ables (permite
// clientes "invitados" sin cuenta). El registro aquí sí exige ambos.

const CAMPOS_PUBLICOS = `
  id, nombre, correo, telefono, acepta_marketing, activo, creado_en, actualizado_en
`;

/** Busca un cliente por correo incluyendo el hash (solo para login). */
async function buscarPorCorreoConHash(correo) {
  const [rows] = await pool.query(
    `SELECT id, nombre, correo, telefono, contrasena_hash, acepta_marketing,
            activo, creado_en, actualizado_en
       FROM clientes
      WHERE correo = :correo
      LIMIT 1`,
    { correo }
  );
  return rows[0] || null;
}

/** Devuelve un cliente por id sin datos sensibles. */
async function buscarPorId(id) {
  const [rows] = await pool.query(
    `SELECT ${CAMPOS_PUBLICOS} FROM clientes WHERE id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

/** Inserta un cliente y devuelve el registro público recién creado. */
async function crear({ nombre, correo, telefono, contrasena_hash, acepta_marketing }) {
  const [result] = await pool.query(
    `INSERT INTO clientes (nombre, correo, telefono, contrasena_hash, acepta_marketing)
     VALUES (:nombre, :correo, :telefono, :contrasena_hash, :acepta_marketing)`,
    {
      nombre,
      correo,
      telefono: telefono ?? null,
      contrasena_hash,
      acepta_marketing: acepta_marketing ? 1 : 0,
    }
  );
  return buscarPorId(result.insertId);
}

module.exports = { buscarPorCorreoConHash, buscarPorId, crear };
