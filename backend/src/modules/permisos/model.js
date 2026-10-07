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

// Qué puestos tiene cada persona: el PRINCIPAL (`usuarios.rol_id`) y los DEMÁS
// (`usuario_roles`, 2026-10-06). También se consulta en cada petición protegida,
// así que va en memoria; se tira al guardar a alguien en Personal, y por eso un
// puesto que se da o se quita vale en el acto, sin volver a entrar.
const puestosCache = new Map();

/**
 * `{ activo, puestos: [{ id, nombre }] }` de una persona, el principal primero.
 * Sin la persona (o sin la fila), `activo: false` y sin puestos: no puede nada.
 */
async function puestosDeUsuario(usuarioId) {
  const id = Number(usuarioId);
  if (puestosCache.has(id)) return puestosCache.get(id);
  const [rows] = await pool.query(
    `SELECT r.id, r.nombre, u.activo, 0 AS orden
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.id = :id
     UNION ALL
     SELECT r.id, r.nombre, u.activo, 1 AS orden
       FROM usuario_roles ur
       JOIN usuarios u ON u.id = ur.usuario_id
       JOIN roles r    ON r.id = ur.rol_id
      WHERE ur.usuario_id = :id AND ur.rol_id <> u.rol_id
      ORDER BY orden, id`,
    { id }
  );
  const res = {
    activo: rows.length > 0 && !!Number(rows[0].activo),
    puestos: rows.map((r) => ({ id: Number(r.id), nombre: r.nombre })),
  };
  puestosCache.set(id, res);
  return res;
}

function invalidar() {
  cache = null;
  puestosCache.clear();
}

async function roles() {
  const [rows] = await pool.query(
    `SELECT r.id, r.nombre, r.descripcion,
            -- Cuenta a quien lo tiene de principal Y a quien lo tiene además de otro.
            (SELECT COUNT(*) FROM usuarios u
              WHERE u.activo = 1
                AND (u.rol_id = r.id
                     OR EXISTS (SELECT 1 FROM usuario_roles ur
                                 WHERE ur.usuario_id = u.id AND ur.rol_id = r.id))) AS personas
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

module.exports = { clavesDeRol, puestosDeUsuario, invalidar, roles, asignados, guardar, crearRol, obtenerRol, porNombre, clavesRegistradas };
