'use strict';

const { pool } = require('../../config/db');

// Acceso a datos de la tabla `usuarios` (staff) y `roles`.
// Nunca seleccionamos contrasena_hash salvo en el login (para comparar).

const CAMPOS_PUBLICOS = `
  u.id, u.rol_id, r.nombre AS rol, u.nombre, u.correo, u.telefono,
  u.activo, u.ultimo_acceso, u.creado_en, u.actualizado_en
`;

/** Busca un usuario por correo incluyendo el hash (solo para login). */
async function buscarPorCorreoConHash(correo) {
  const [rows] = await pool.query(
    `SELECT u.id, u.rol_id, r.nombre AS rol, u.nombre, u.correo, u.telefono,
            u.contrasena_hash, u.activo, u.ultimo_acceso, u.creado_en, u.actualizado_en
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
      WHERE u.correo = :correo
      LIMIT 1`,
    { correo }
  );
  return rows[0] || null;
}

/** Devuelve un usuario por id sin datos sensibles. */
async function buscarPorId(id) {
  const [rows] = await pool.query(
    `SELECT ${CAMPOS_PUBLICOS}
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
      WHERE u.id = :id
      LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

/** Verifica que exista un rol activo con ese id. */
async function existeRol(rolId) {
  const [rows] = await pool.query('SELECT id FROM roles WHERE id = :id LIMIT 1', { id: rolId });
  return rows.length > 0;
}

/** Inserta un usuario y devuelve el registro público recién creado. */
async function crear({ rol_id, nombre, correo, telefono, contrasena_hash }) {
  const [result] = await pool.query(
    `INSERT INTO usuarios (rol_id, nombre, correo, telefono, contrasena_hash)
     VALUES (:rol_id, :nombre, :correo, :telefono, :contrasena_hash)`,
    { rol_id, nombre, correo, telefono: telefono ?? null, contrasena_hash }
  );
  return buscarPorId(result.insertId);
}

/** Marca la marca de tiempo del último acceso tras un login exitoso. */
async function registrarAcceso(id) {
  await pool.query('UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id = :id', { id });
}

/** Lista el personal (staff), opcionalmente filtrado por texto/estado. */
async function listar({ q, activo } = {}) {
  const where = [];
  const params = {};
  if (q) {
    where.push('(u.nombre LIKE :q OR u.correo LIKE :q)');
    params.q = `%${q}%`;
  }
  if (activo !== undefined) {
    where.push('u.activo = :activo');
    params.activo = activo ? 1 : 0;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT ${CAMPOS_PUBLICOS}
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
       ${whereSql}
      ORDER BY u.nombre`,
    params
  );
  return rows;
}

/** Actualiza datos del usuario. Solo toca los campos presentes en `datos`. */
async function actualizar(id, datos) {
  const campos = [];
  const params = { id };
  for (const c of ['rol_id', 'nombre', 'telefono', 'activo']) {
    if (datos[c] !== undefined) {
      campos.push(`${c} = :${c}`);
      params[c] = datos[c];
    }
  }
  if (datos.contrasena_hash !== undefined) {
    campos.push('contrasena_hash = :contrasena_hash');
    params.contrasena_hash = datos.contrasena_hash;
  }
  if (campos.length) {
    await pool.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = :id`, params);
  }
  return buscarPorId(id);
}

/** Catálogo de roles para poblar selects. */
async function listarRoles() {
  const [rows] = await pool.query('SELECT id, nombre, descripcion FROM roles ORDER BY id');
  return rows;
}

module.exports = {
  buscarPorCorreoConHash,
  buscarPorId,
  existeRol,
  crear,
  registrarAcceso,
  listar,
  actualizar,
  listarRoles,
};
