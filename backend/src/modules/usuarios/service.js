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

async function _rolPrincipal(rolId) {
  const rol = await model.obtenerRol(rolId);
  if (!rol) throw new AppError(422, 'ROL_INVALIDO', `No existe el rol con id ${rolId}`);
  return rol;
}

/**
 * Un puesto que NO entra al sistema (el cargador, 2026-10-14) va SOLO: no se da
 * como "también trabaja como" —no daría nada— y quien lo tiene de principal no
 * lleva otros, porque cualquier otro le daría entrada y entonces no es cargador.
 */
async function _exigirOtrosRoles(ids, principal) {
  const roles = await model.obtenerRoles(ids);
  if (roles.length !== ids.length) {
    throw new AppError(422, 'ROL_INVALIDO', 'Alguno de los otros puestos no existe');
  }
  if (ids.length && !principal.entra_al_sistema) {
    throw new AppError(422, 'PUESTO_SIN_ACCESO',
      `El puesto ${principal.nombre} no entra al sistema: no se combina con otros puestos.`);
  }
  const sinAcceso = roles.find((r) => !r.entra_al_sistema);
  if (sinAcceso) {
    throw new AppError(422, 'PUESTO_SIN_ACCESO',
      `El puesto ${sinAcceso.nombre} no entra al sistema: va como puesto principal, no como otro puesto.`);
  }
}

const _sinCorreoNiContrasena = (rol) =>
  new AppError(422, 'PUESTO_SIN_ACCESO',
    `El puesto ${rol.nombre} no entra al sistema: no lleva correo ni contraseña.`);

async function _exigirCorreoLibre(correo, salvoId) {
  if (await model.correoEnUso(correo, salvoId)) {
    throw new AppError(409, 'CORREO_EN_USO', 'Ya existe un usuario con ese correo');
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
 *
 * Quien entra al sistema lleva correo y contraseña; el puesto que no entra (el
 * cargador) no lleva ninguno de los dos, y sigue saliendo en Nómina.
 */
async function crearStaff({ rol_id, nombre, correo, telefono, contrasena, otros_roles }) {
  const rol = await _rolPrincipal(rol_id);
  const otros = _otros(otros_roles, rol_id);
  await _exigirOtrosRoles(otros, rol);
  if (!rol.entra_al_sistema) {
    if (correo || contrasena) throw _sinCorreoNiContrasena(rol);
    const usuario = await model.crear({ rol_id, nombre, telefono, otros_roles: [] });
    permisosModel.invalidar();
    return sanitizar(usuario);
  }
  if (!correo) throw new AppError(422, 'FALTA_CORREO', 'Falta el correo: es con lo que entra al sistema.');
  if (!contrasena) throw new AppError(422, 'FALTA_CONTRASENA', 'Falta la contraseña para entrar al sistema.');
  await _exigirCorreoLibre(correo);
  const contrasena_hash = await hashPassword(contrasena);
  const usuario = await model.crear({ rol_id, nombre, correo, telefono, contrasena_hash, otros_roles: otros });
  permisosModel.invalidar();
  return sanitizar(usuario);
}

async function listarStaff(filtros) {
  return model.listar(filtros);
}

/**
 * Cambia a alguien. Al pasar a un puesto que NO entra al sistema (el cargador)
 * se le quitan el correo y la contraseña —ya no entra— y sus otros puestos. Al
 * revés, el cargador que pasa a un puesto que sí entra necesita correo y
 * contraseña. El correo de quien ya entra no se cambia: es con lo que entra.
 */
async function actualizarStaff(id, datos) {
  const actual = await model.buscarPorId(id);
  if (!actual) throw new AppError(404, 'NO_ENCONTRADO', 'Usuario no encontrado');
  const rol = await _rolPrincipal(datos.rol_id ?? actual.rol_id);
  const cambios = {
    rol_id: datos.rol_id,
    nombre: datos.nombre,
    telefono: datos.telefono,
    activo: datos.activo,
  };
  const otros = datos.otros_roles !== undefined
    ? _otros(datos.otros_roles, rol.id)
    : rol.entra_al_sistema ? undefined : [];
  if (otros !== undefined) {
    await _exigirOtrosRoles(otros, rol);
    cambios.otros_roles = otros;
  }
  if (!rol.entra_al_sistema) {
    if (datos.correo || datos.contrasena) throw _sinCorreoNiContrasena(rol);
    cambios.correo = null;
    cambios.contrasena_hash = null;
  } else if (!actual.correo) {
    // No entraba (era cargador) y ahora sí: necesita con qué entrar.
    if (!datos.correo) throw new AppError(422, 'FALTA_CORREO', 'Falta el correo: es con lo que va a entrar al sistema.');
    if (!datos.contrasena) throw new AppError(422, 'FALTA_CONTRASENA', 'Falta la contraseña para entrar al sistema.');
    await _exigirCorreoLibre(datos.correo, id);
    cambios.correo = datos.correo;
  } else if (datos.correo && datos.correo !== actual.correo) {
    throw new AppError(422, 'CORREO_NO_SE_CAMBIA', 'El correo no se puede cambiar: es con lo que entra.');
  }
  if (rol.entra_al_sistema && datos.contrasena) {
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
  // Sin contraseña no entra nadie (el cargador no tiene, ni correo).
  if (!usuario || !usuario.contrasena_hash) throw credencialesInvalidas;

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
