'use strict';

const { pool } = require('../../config/db');

// Proveedores: de quién llega la mercancía. Se eligen de una LISTA al surtir
// inventario (no se escribe el nombre cada vez: tres formas de escribir el
// mismo proveedor no se pueden juntar después). El nombre no se repite (índice
// único, sin distinguir mayúsculas).

const CAMPOS = 'id, nombre, contacto, correo, telefono, rfc_id_fiscal, activo, creado_en';

/** Los proveedores, por nombre, con cuántas cargas tiene cada uno. */
async function listar({ activo } = {}) {
  const where = activo !== undefined ? 'WHERE p.activo = :activo' : '';
  const [rows] = await pool.query(
    `SELECT p.id, p.nombre, p.contacto, p.correo, p.telefono, p.rfc_id_fiscal, p.activo, p.creado_en,
            (SELECT COUNT(*) FROM remesas r WHERE r.proveedor_id = p.id) AS num_cargas
       FROM proveedores p ${where}
      ORDER BY p.nombre`,
    { activo: activo ? 1 : 0 }
  );
  return rows;
}

async function obtener(id) {
  const [rows] = await pool.query(`SELECT ${CAMPOS} FROM proveedores WHERE id = :id LIMIT 1`, { id });
  return rows[0] || null;
}

async function porNombre(nombre) {
  const [rows] = await pool.query(`SELECT ${CAMPOS} FROM proveedores WHERE nombre = :nombre LIMIT 1`, { nombre });
  return rows[0] || null;
}

async function crear({ nombre, contacto, telefono, correo, rfc_id_fiscal }) {
  const [r] = await pool.query(
    `INSERT INTO proveedores (nombre, contacto, telefono, correo, rfc_id_fiscal)
     VALUES (:nombre, :contacto, :telefono, :correo, :rfc)`,
    {
      nombre,
      contacto: contacto ?? null,
      telefono: telefono ?? null,
      correo: correo ?? null,
      rfc: rfc_id_fiscal ?? null,
    }
  );
  return obtener(r.insertId);
}

module.exports = { listar, obtener, porNombre, crear };
