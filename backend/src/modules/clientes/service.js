'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');
const { hashPassword, verificarPassword } = require('../../utils/password');
const { firmarToken } = require('../../utils/jwt');

/** Quita cualquier campo sensible antes de responder. */
function sanitizar(cliente) {
  if (!cliente) return cliente;
  const { contrasena_hash, ...publico } = cliente;
  return publico;
}

/** Construye el JWT de un cliente. */
function emitirToken(cliente) {
  return firmarToken({ sub: cliente.id, tipo: 'cliente' });
}

/** Registra una nueva cuenta de cliente. */
async function registrar({ nombre, correo, telefono, contrasena, acepta_marketing }) {
  const existente = await model.buscarPorCorreoConHash(correo);
  if (existente) {
    throw new AppError(409, 'CORREO_EN_USO', 'Ya existe una cuenta con ese correo');
  }

  const contrasena_hash = await hashPassword(contrasena);
  const cliente = await model.crear({ nombre, correo, telefono, contrasena_hash, acepta_marketing });

  return { cliente: sanitizar(cliente), token: emitirToken(cliente) };
}

/** Autentica a un cliente por correo y contraseña. */
async function iniciarSesion({ correo, contrasena }) {
  const cliente = await model.buscarPorCorreoConHash(correo);

  const credencialesInvalidas = new AppError(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos');
  if (!cliente) throw credencialesInvalidas;

  // Cliente invitado sin contraseña definida: no puede iniciar sesión.
  const ok = await verificarPassword(contrasena, cliente.contrasena_hash);
  if (!ok) throw credencialesInvalidas;

  if (!cliente.activo) {
    throw new AppError(403, 'CUENTA_INACTIVA', 'La cuenta está desactivada');
  }

  return { cliente: sanitizar(cliente), token: emitirToken(cliente) };
}

/** Devuelve el perfil del cliente autenticado. */
async function perfil(id) {
  const cliente = await model.buscarPorId(id);
  if (!cliente) throw new AppError(404, 'NO_ENCONTRADO', 'Cliente no encontrado');
  return sanitizar(cliente);
}

module.exports = { registrar, iniciarSesion, perfil };
