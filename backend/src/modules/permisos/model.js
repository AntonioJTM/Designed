'use strict';

const { pool, withTransaction } = require('../../config/db');

// Qué claves tiene cada puesto. Se lee una vez y se guarda en memoria: se
// consulta en CADA petición protegida y cambia muy rara vez. Al guardar desde la
// pantalla de Permisos se tira el caché y la siguiente petición lo vuelve a leer.
// El servidor corre en un solo proceso (pm2 con una instancia); con varios,
// habría que tirar el caché en todos.
let cache = null;
let cargando = null;

async function _cargar() {
  const [rows] = await pool.query(
    `SELECT rp.rol_id, p.clave
       FROM rol_permisos rp JOIN permisos p ON p.id = rp.permiso_id`
  );
  const mapa = new Map();
  for (const r of rows) {
    if (!mapa.has(r.rol_id)) mapa.set(r.rol_id, new Set());
    mapa.get(r.rol_id).add(r.clave);
  }
  return mapa;
}

/** Las claves de un puesto (Set). Vacío si el puesto no tiene ninguna. */
async function clavesDeRol(rolId) {
  if (!cache) {
    cargando = cargando ?? _cargar();
    try {
      cache = await cargando;
    } finally {
      cargando = null;
    }
  }
  return cache.get(Number(rolId)) ?? new Set();
}

function invalidar() {
  cache = null;
}

async function roles() {
  const [rows] = await pool.query(
    `SELECT r.id, r.nombre, r.descripcion,
            (SELECT COUNT(*) FROM usuarios u WHERE u.rol_id = r.id AND u.activo = 1) AS personas
       FROM roles r ORDER BY r.id`
  );
  return rows;
}

async function asignados() {
  const [rows] = await pool.query(
    `SELECT rp.rol_id, p.clave FROM rol_permisos rp JOIN permisos p ON p.id = rp.permiso_id`
  );
  const porRol = {};
  for (const r of rows) (porRol[r.rol_id] ??= []).push(r.clave);
  return porRol;
}

/** Reemplaza lo que tiene un puesto por exactamente `claves`. */
async function guardar(rolId, claves) {
  await withTransaction(async (conn) => {
    await conn.query('DELETE FROM rol_permisos WHERE rol_id = :rol', { rol: rolId });
    if (claves.length) {
      await conn.query(
        `INSERT INTO rol_permisos (rol_id, permiso_id)
         SELECT :rol, id FROM permisos WHERE clave IN (:claves)`,
        { rol: rolId, claves }
      );
    }
  });
  invalidar();
}

async function crearRol(nombre, descripcion) {
  const [r] = await pool.query(
    'INSERT INTO roles (nombre, descripcion) VALUES (:nombre, :descripcion)',
    { nombre, descripcion: descripcion ?? null }
  );
  invalidar();
  return r.insertId;
}

async function obtenerRol(id) {
  const [rows] = await pool.query('SELECT id, nombre FROM roles WHERE id = :id', { id });
  return rows[0] ?? null;
}

async function porNombre(nombre) {
  const [rows] = await pool.query('SELECT id FROM roles WHERE nombre = :nombre', { nombre });
  return rows[0] ?? null;
}

/** Las claves que existen en la base (para avisar si falta la migración). */
async function clavesRegistradas() {
  const [rows] = await pool.query('SELECT clave FROM permisos');
  return new Set(rows.map((r) => r.clave));
}

module.exports = { clavesDeRol, invalidar, roles, asignados, guardar, crearRol, obtenerRol, porNombre, clavesRegistradas };
