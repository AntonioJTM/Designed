'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');
const { hashPassword, verificarPassword } = require('../../utils/password');
const { firmarToken } = require('../../utils/jwt');

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
async function crearStaff({ rol_id, nombre, correo, telefono, contrasena }) {
  if (!(await model.existeRol(rol_id))) {
    throw new AppError(422, 'ROL_INVALIDO', `No existe el rol con id ${rol_id}`);
  }
  const existente = await model.buscarPorCorreoConHash(correo);
  if (existente) {
    throw new AppError(409, 'CORREO_EN_USO', 'Ya existe un usuario con ese correo');
  }
  const contrasena_hash = await hashPassword(contrasena);
  const usuario = await model.crear({ rol_id, nombre, correo, telefono, contrasena_hash });
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
  if (datos.contrasena) {
    cambios.contrasena_hash = await hashPassword(datos.contrasena);
  }
  return sanitizar(await model.actualizar(id, cambios));
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
