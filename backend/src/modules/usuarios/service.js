'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');
const { hashPassword, verificarPassword } = require('../../utils/password');
const { firmarToken } = require('../../utils/jwt');
const permisosModel = require('../permisos/model');

/** Los DEMÁS puestos sin repetir y sin el principal. */
function _otros(ids, principal) {
  return [...new Set((ids ?? []).map(Number))].filter((id) => id !== Number(principal));
}

async function _exigirOtrosRoles(ids) {
  if (!(await model.existenRoles(ids))) {
    throw new AppError(422, 'ROL_INVALIDO', 'Alguno de los otros puestos no existe');
  }
}

/** Quita cualquier campo sensible antes de responder. */
function sanitizar(usuario) {
  if (!usuario) return usuario;
  const { contrasena_hash, ...publico } = usuario;
  return publico;
}

/** Construye el JWT de un usuario staff. */
function emitirToken(usuario) {
  return firmarToken({
    sub: usuario.id,
    tipo: 'usuario',
    rol_id: usuario.rol_id,
    rol: usuario.rol,
  });
}

/**
 * Da de alta un usuario staff (lo hace un administrador desde el panel).
 * NO emite token: no cambia la sesión de quien lo crea.
 */
async function crearStaff({ rol_id, nombre, correo, telefono, contrasena, otros_roles }) {
  if (!(await model.existeRol(rol_id))) {
    throw new AppError(422, 'ROL_INVALIDO', `No existe el rol con id ${rol_id}`);
  }
  const otros = _otros(otros_roles, rol_id);
  await _exigirOtrosRoles(otros);
  const existente = await model.buscarPorCorreoConHash(correo);
  if (existente) {
    throw new AppError(409, 'CORREO_EN_USO', 'Ya existe un usuario con ese correo');
  }
  const contrasena_hash = await hashPassword(contrasena);
  const usuario = await model.crear({ rol_id, nombre, correo, telefono, contrasena_hash, otros_roles: otros });
  permisosModel.invalidar();
  return sanitizar(usuario);
}

async function listarStaff(filtros) {
  return model.listar(filtros);
}

async function actualizarStaff(id, datos) {
  const actual = await model.buscarPorId(id);
  if (!actual) throw new AppError(404, 'NO_ENCONTRADO', 'Usuario no encontrado');
  if (datos.rol_id !== undefined && !(await model.existeRol(datos.rol_id))) {
    throw new AppError(422, 'ROL_INVALIDO', `No existe el rol con id ${datos.rol_id}`);
  }
  const cambios = {
    rol_id: datos.rol_id,
    nombre: datos.nombre,
    telefono: datos.telefono,
    activo: datos.activo,
  };
  if (datos.otros_roles !== undefined) {
    cambios.otros_roles = _otros(datos.otros_roles, datos.rol_id ?? actual.rol_id);
    await _exigirOtrosRoles(cambios.otros_roles);
  }
  if (datos.contrasena) {
    cambios.contrasena_hash = await hashPassword(datos.contrasena);
  }
  const usuario = await model.actualizar(id, cambios);
  // Sus puestos (o su acceso) pudieron cambiar: lo que puede hacer cambia YA.
  permisosModel.invalidar();
  return sanitizar(usuario);
}

async function roles() {
  return model.listarRoles();
}

/** Autentica a un usuario (staff) por correo y contraseña. */
async function iniciarSesion({ correo, contrasena }) {
  const usuario = await model.buscarPorCorreoConHash(correo);

  // Mensaje genérico para no revelar si el correo existe.
  const credencialesInvalidas = new AppError(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos');
  if (!usuario) throw credencialesInvalidas;

  const ok = await verificarPassword(contrasena, usuario.contrasena_hash);
  if (!ok) throw credencialesInvalidas;

  if (!usuario.activo) {
    throw new AppError(403, 'CUENTA_INACTIVA', 'La cuenta está desactivada');
  }

  await model.registrarAcceso(usuario.id);
  await model.conOtrosRoles(usuario);
  return { usuario: sanitizar(usuario), token: emitirToken(usuario) };
}

/** Devuelve el perfil del usuario autenticado. */
async function perfil(id) {
  const usuario = await model.buscarPorId(id);
  if (!usuario) throw new AppError(404, 'NO_ENCONTRADO', 'Usuario no encontrado');
  return sanitizar(usuario);
}

module.exports = {
  crearStaff,
  iniciarSesion,
  perfil,
  listarStaff,
  actualizarStaff,
  roles,
};
