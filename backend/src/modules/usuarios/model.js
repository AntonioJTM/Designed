'use strict';

const { pool, withTransaction } = require('../../config/db');

// Acceso a datos de la tabla `usuarios` (staff) y `roles`.
// Nunca seleccionamos contrasena_hash salvo en el login (para comparar).
//
// Una persona puede tener VARIOS puestos (2026-10-06): `rol_id`/`rol` es el
// PRINCIPAL (el de nómina y el que se ve junto a su nombre) y `otros_roles`
// los demás, que viven en `usuario_roles` y nunca repiten el principal.

// `entra_al_sistema` es el de su puesto PRINCIPAL: 0 = no entra (el cargador),
// y entonces su correo viene en NULL.
const CAMPOS_PUBLICOS = `
  u.id, u.rol_id, r.nombre AS rol, r.entra_al_sistema, u.nombre, u.correo, u.telefono,
  u.activo, u.todas_las_tiendas, u.ultimo_acceso, u.creado_en, u.actualizado_en
`;

/**
 * Le pega a cada usuario sus TIENDAS (2026-10-15): `tiendas: [{ id, nombre }]`,
 * las de `usuario_almacenes`. Con `todas_las_tiendas` la lista no se usa.
 */
async function conTiendas(lista) {
  if (!lista.length) return;
  const [rows] = await pool.query(
    `SELECT ua.usuario_id, a.id, a.nombre
       FROM usuario_almacenes ua JOIN almacenes a ON a.id = ua.almacen_id
      WHERE ua.usuario_id IN (:ids)
      ORDER BY a.nombre`,
    { ids: lista.map((u) => u.id) }
  );
  for (const u of lista) {
    u.todas_las_tiendas = !!Number(u.todas_las_tiendas);
    u.tiendas = rows.filter((r) => Number(r.usuario_id) === Number(u.id)).map((r) => ({ id: Number(r.id), nombre: r.nombre }));
  }
}

/** Le pega a cada usuario sus DEMÁS puestos: `otros_roles: [{ id, nombre }]` (y sus tiendas). */
async function conOtrosRoles(usuarios) {
  const lista = [].concat(usuarios ?? []).filter(Boolean);
  if (!lista.length) return usuarios;
  await conTiendas(lista);
  const [rows] = await pool.query(
    `SELECT ur.usuario_id, r.id, r.nombre
       FROM usuario_roles ur
       JOIN roles r    ON r.id = ur.rol_id
       JOIN usuarios u ON u.id = ur.usuario_id
      WHERE ur.usuario_id IN (:ids) AND ur.rol_id <> u.rol_id
      ORDER BY r.id`,
    { ids: lista.map((u) => u.id) }
  );
  const porUsuario = new Map();
  for (const r of rows) {
    const k = Number(r.usuario_id);
    if (!porUsuario.has(k)) porUsuario.set(k, []);
    porUsuario.get(k).push({ id: Number(r.id), nombre: r.nombre });
  }
  for (const u of lista) u.otros_roles = porUsuario.get(Number(u.id)) ?? [];
  return usuarios;
}

/**
 * Deja a la persona con exactamente esos DEMÁS puestos. El principal se descarta
 * aunque venga en la lista: no se guarda dos veces.
 */
async function _guardarOtrosRoles(conn, id, ids) {
  await conn.query('DELETE FROM usuario_roles WHERE usuario_id = :id', { id });
  if (ids.length) {
    await conn.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id)
       SELECT :id, r.id FROM roles r
        WHERE r.id IN (:ids) AND r.id <> (SELECT rol_id FROM usuarios WHERE id = :id)`,
      { id, ids }
    );
  }
}

/** Deja a la persona con exactamente esas tiendas (las de quien no ve todas). */
async function _guardarTiendas(conn, id, ids) {
  await conn.query('DELETE FROM usuario_almacenes WHERE usuario_id = :id', { id });
  if (ids.length) {
    await conn.query(
      'INSERT INTO usuario_almacenes (usuario_id, almacen_id) SELECT :id, a.id FROM almacenes a WHERE a.id IN (:ids)',
      { id, ids }
    );
  }
}

/** True si existen TODOS esos almacenes. */
async function existenAlmacenes(ids) {
  if (!ids.length) return true;
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM almacenes WHERE id IN (:ids)', { ids });
  return Number(rows[0].n) === new Set(ids).size;
}

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
  const u = rows[0] || null;
  if (u) await conOtrosRoles(u);
  return u;
}

/** Un puesto: `{ id, nombre, entra_al_sistema }` (booleano), o null si no existe. */
async function obtenerRol(rolId) {
  const [rows] = await pool.query(
    'SELECT id, nombre, entra_al_sistema FROM roles WHERE id = :id LIMIT 1',
    { id: rolId }
  );
  const r = rows[0];
  return r ? { id: Number(r.id), nombre: r.nombre, entra_al_sistema: !!Number(r.entra_al_sistema) } : null;
}

/** Esos puestos, con `entra_al_sistema` (booleano). Los que no existen no vienen. */
async function obtenerRoles(ids) {
  if (!ids.length) return [];
  const [rows] = await pool.query(
    'SELECT id, nombre, entra_al_sistema FROM roles WHERE id IN (:ids)',
    { ids }
  );
  return rows.map((r) => ({ id: Number(r.id), nombre: r.nombre, entra_al_sistema: !!Number(r.entra_al_sistema) }));
}

/** ¿Ya lo usa alguien más? (el correo es con lo que se entra: no se repite) */
async function correoEnUso(correo, salvoId = 0) {
  const [rows] = await pool.query(
    'SELECT id FROM usuarios WHERE correo = :correo AND id <> :salvo LIMIT 1',
    { correo, salvo: salvoId }
  );
  return rows.length > 0;
}

/**
 * Inserta un usuario (con sus demás puestos) y devuelve el registro público recién creado.
 * Quien no entra al sistema (el cargador) llega sin correo ni contraseña: quedan en NULL.
 */
async function crear({ rol_id, nombre, correo, telefono, contrasena_hash, otros_roles = [], todas_las_tiendas = true, tiendas = [] }) {
  const id = await withTransaction(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO usuarios (rol_id, nombre, correo, telefono, contrasena_hash, todas_las_tiendas)
       VALUES (:rol_id, :nombre, :correo, :telefono, :contrasena_hash, :todas)`,
      {
        rol_id, nombre, correo: correo ?? null, telefono: telefono ?? null, contrasena_hash: contrasena_hash ?? null,
        todas: todas_las_tiendas ? 1 : 0,
      }
    );
    await _guardarOtrosRoles(conn, result.insertId, otros_roles);
    await _guardarTiendas(conn, result.insertId, todas_las_tiendas ? [] : tiendas);
    return result.insertId;
  });
  return buscarPorId(id);
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
  return conOtrosRoles(rows);
}

/**
 * Actualiza datos del usuario. Solo toca los campos presentes en `datos`;
 * `otros_roles` (si viene) reemplaza sus demás puestos.
 */
async function actualizar(id, datos) {
  const campos = [];
  const params = { id };
  for (const c of ['rol_id', 'nombre', 'telefono', 'activo', 'todas_las_tiendas']) {
    if (datos[c] !== undefined) {
      campos.push(`${c} = :${c}`);
      params[c] = datos[c];
    }
  }
  // `null` en los dos = ya no entra al sistema (pasó a cargador).
  if (datos.correo !== undefined) {
    campos.push('correo = :correo');
    params.correo = datos.correo;
  }
  if (datos.contrasena_hash !== undefined) {
    campos.push('contrasena_hash = :contrasena_hash');
    params.contrasena_hash = datos.contrasena_hash;
  }
  await withTransaction(async (conn) => {
    if (campos.length) {
      await conn.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = :id`, params);
    }
    if (datos.tiendas !== undefined) {
      await _guardarTiendas(conn, id, datos.todas_las_tiendas ? [] : datos.tiendas);
    }
    if (datos.otros_roles !== undefined) {
      await _guardarOtrosRoles(conn, id, datos.otros_roles);
    } else if (datos.rol_id !== undefined) {
      // Su nuevo principal estaba entre los demás: no se guarda dos veces.
      await conn.query(
        'DELETE FROM usuario_roles WHERE usuario_id = :id AND rol_id = :rol',
        { id, rol: datos.rol_id }
      );
    }
  });
  return buscarPorId(id);
}

/** Catálogo de roles para poblar selects; `entra_al_sistema` dice si lleva correo y contraseña. */
async function listarRoles() {
  const [rows] = await pool.query('SELECT id, nombre, descripcion, entra_al_sistema FROM roles ORDER BY id');
  return rows.map((r) => ({ ...r, entra_al_sistema: !!Number(r.entra_al_sistema) }));
}

module.exports = {
  buscarPorCorreoConHash,
  buscarPorId,
  conOtrosRoles,
  obtenerRol,
  obtenerRoles,
  correoEnUso,
  existenAlmacenes,
  crear,
  registrarAcceso,
  listar,
  actualizar,
  listarRoles,
};
