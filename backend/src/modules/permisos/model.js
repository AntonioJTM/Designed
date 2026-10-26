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
 * `{ activo, puestos: [{ id, nombre, entra_al_sistema }] }` de una persona, el
 * principal primero. Sin la persona (o sin la fila), `activo: false` y sin
 * puestos: no puede nada.
 */
async function puestosDeUsuario(usuarioId) {
  const id = Number(usuarioId);
  if (puestosCache.has(id)) return puestosCache.get(id);
  const [rows] = await pool.query(
    `SELECT r.id, r.nombre, r.entra_al_sistema, u.activo, 0 AS orden
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.id = :id
     UNION ALL
     SELECT r.id, r.nombre, r.entra_al_sistema, u.activo, 1 AS orden
       FROM usuario_roles ur
       JOIN usuarios u ON u.id = ur.usuario_id
       JOIN roles r    ON r.id = ur.rol_id
      WHERE ur.usuario_id = :id AND ur.rol_id <> u.rol_id
      ORDER BY orden, id`,
    { id }
  );
  const res = {
    activo: rows.length > 0 && !!Number(rows[0].activo),
    puestos: rows.map((r) => ({ id: Number(r.id), nombre: r.nombre, entra_al_sistema: !!Number(r.entra_al_sistema) })),
  };
  puestosCache.set(id, res);
  return res;
}

// De qué TIENDAS es cada persona (2026-10-15): `todas` o las de `usuario_almacenes`.
// También se consulta en cada petición que toca ventas, caja o inventario: en
// memoria, y se tira al guardar a alguien en Personal (vale en el acto).
const tiendasCache = new Map();

/** `{ todas, ids }` de una persona. Sin la persona: ninguna tienda. */
async function tiendasDeUsuario(usuarioId) {
  const id = Number(usuarioId);
  if (tiendasCache.has(id)) return tiendasCache.get(id);
  const [[u]] = await pool.query('SELECT todas_las_tiendas FROM usuarios WHERE id = :id', { id });
  const [rows] = await pool.query(
    'SELECT almacen_id FROM usuario_almacenes WHERE usuario_id = :id ORDER BY almacen_id',
    { id }
  );
  const res = { todas: !!u && !!Number(u.todas_las_tiendas), ids: rows.map((r) => Number(r.almacen_id)) };
  tiendasCache.set(id, res);
  return res;
}

/** El almacén de la caja de un turno, o null si el turno no existe. */
async function almacenDeTurno(sesionId) {
  const [[s]] = await pool.query(
    'SELECT c.almacen_id FROM sesiones_caja s JOIN cajas c ON c.id = s.caja_id WHERE s.id = :id',
    { id: Number(sesionId) }
  );
  return s ? Number(s.almacen_id) : null;
}

function invalidar() {
  cache = null;
  puestosCache.clear();
  tiendasCache.clear();
}

async function roles() {
  const [rows] = await pool.query(
    `SELECT r.id, r.nombre, r.descripcion, r.entra_al_sistema,
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

/**
 * Quien trabaja en UNA o varias tiendas (no en «Todas»), activo y con un puesto que
 * entra al sistema: sus puestos (el principal y los demás) y sus tiendas.
 */
async function personasSinTodas() {
  const [rows] = await pool.query(
    `SELECT u.id, u.nombre, u.rol_id,
            (SELECT GROUP_CONCAT(ur.rol_id) FROM usuario_roles ur WHERE ur.usuario_id = u.id) AS otros,
            (SELECT GROUP_CONCAT(a.nombre ORDER BY a.nombre SEPARATOR ', ')
               FROM usuario_almacenes ua JOIN almacenes a ON a.id = ua.almacen_id
              WHERE ua.usuario_id = u.id AND a.activo = 1) AS tiendas
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.activo = 1 AND u.todas_las_tiendas = 0 AND r.entra_al_sistema = 1
      ORDER BY u.nombre`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    nombre: r.nombre,
    puestos: [Number(r.rol_id), ...String(r.otros ?? '').split(',').filter(Boolean).map(Number)],
    tiendas: r.tiendas ?? '',
  }));
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
  const [rows] = await pool.query('SELECT id, nombre, entra_al_sistema FROM roles WHERE id = :id', { id });
  const r = rows[0];
  return r ? { id: r.id, nombre: r.nombre, entra_al_sistema: !!Number(r.entra_al_sistema) } : null;
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

module.exports = { clavesDeRol, puestosDeUsuario, tiendasDeUsuario, almacenDeTurno, invalidar, roles, asignados, guardar, crearRol, obtenerRol, porNombre, clavesRegistradas,
  personasSinTodas,
};
