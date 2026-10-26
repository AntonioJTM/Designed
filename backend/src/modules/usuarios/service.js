'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');
const { hashPassword, verificarPassword } = require('../../utils/password');
const { firmarToken } = require('../../utils/jwt');
const permisosModel = require('../permisos/model');
const { CLAVES: TODAS_LAS_CLAVES, soloConTodas } = require('../permisos/catalogo');

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

/**
 * DE QUÉ TIENDAS ES (2026-10-15). Quien no ve todas lleva al menos una; el
 * administrador las ve todas siempre. Y nadie da más de lo que tiene: quien
 * edita a otra persona desde una sola tienda no le puede dar "todas" ni una
 * tienda que no es suya (`alcance` = las de quien edita; null = todas).
 * Devuelve `{ todas, tiendas }` listo para guardar, o undefined si no cambia.
 */
async function _tiendas(datos, rol, alcance, actual = null) {
  if (datos.todas_las_tiendas === undefined && datos.tiendas === undefined) {
    if (actual) return undefined;
    // Un alta sin decir nada: las mismas que quien la hace.
    return alcance === null ? { todas: true, tiendas: [] } : { todas: false, tiendas: alcance };
  }
  const todas = rol.nombre === 'administrador'
    ? true
    : datos.todas_las_tiendas ?? (actual ? !!actual.todas_las_tiendas : false);
  const tiendas = todas ? [] : [...new Set((datos.tiendas ?? actual?.tiendas?.map((t) => t.id) ?? []).map(Number))];
  if (!todas && !tiendas.length) {
    throw new AppError(422, 'FALTA_TIENDA', 'Elige de qué tienda es, o marca «Todas las tiendas».');
  }
  if (!(await model.existenAlmacenes(tiendas))) {
    throw new AppError(422, 'TIENDA_INVALIDA', 'Alguna de esas tiendas no existe.');
  }
  if (alcance !== null && (todas || tiendas.some((t) => !alcance.includes(t)))) {
    throw new AppError(403, 'SOLO_SUS_TIENDAS', 'Solo puedes dar las tiendas que tú ves.');
  }
  return { todas, tiendas };
}

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
async function crearStaff({ rol_id, nombre, correo, telefono, contrasena, otros_roles, todas_las_tiendas, tiendas }, alcance = null) {
  const rol = await _rolPrincipal(rol_id);
  const otros = _otros(otros_roles, rol_id);
  await _exigirOtrosRoles(otros, rol);
  const t = await _tiendas({ todas_las_tiendas, tiendas }, rol, alcance);
  if (!rol.entra_al_sistema) {
    if (correo || contrasena) throw _sinCorreoNiContrasena(rol);
    const usuario = await model.crear({ rol_id, nombre, telefono, otros_roles: [], todas_las_tiendas: t.todas, tiendas: t.tiendas });
    permisosModel.invalidar();
    return sanitizar(usuario);
  }
  if (!correo) throw new AppError(422, 'FALTA_CORREO', 'Falta el correo: es con lo que entra al sistema.');
  if (!contrasena) throw new AppError(422, 'FALTA_CONTRASENA', 'Falta la contraseña para entrar al sistema.');
  await _exigirCorreoLibre(correo);
  const contrasena_hash = await hashPassword(contrasena);
  const usuario = await model.crear({
    rol_id, nombre, correo, telefono, contrasena_hash, otros_roles: otros, todas_las_tiendas: t.todas, tiendas: t.tiendas,
  });
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
async function actualizarStaff(id, datos, alcance = null) {
  const actual = await model.buscarPorId(id);
  if (!actual) throw new AppError(404, 'NO_ENCONTRADO', 'Usuario no encontrado');
  const rol = await _rolPrincipal(datos.rol_id ?? actual.rol_id);
  const t = await _tiendas(datos, rol, alcance, actual);
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
  if (t) {
    cambios.todas_las_tiendas = t.todas;
    cambios.tiendas = t.tiendas;
  }
  const usuario = await model.actualizar(id, cambios);
  // Sus puestos (o su acceso) pudieron cambiar: lo que puede hacer cambia YA.
  permisosModel.invalidar();
  return sanitizar(usuario);
}

/**
 * Los puestos para el formulario de Personal, cada uno con las pantallas que
 * suman TODAS las tiendas que tiene (`solo_todas`): con una sola tienda no las
 * vería, y el formulario lo dice (2026-10-22).
 */
async function roles() {
  const [lista, asignados] = await Promise.all([model.listarRoles(), permisosModel.asignados()]);
  return lista.map((r) => {
    const { pantallas, acciones } = soloConTodas(r.nombre === 'administrador' ? [...TODAS_LAS_CLAVES] : asignados[r.id] ?? []);
    return { ...r, solo_todas: pantallas, acciones_todas: acciones };
  });
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

/**
 * ¿Es la CLAVE DE AUTORIZACIÓN de esta persona? (2026-10-19) Para autorizar en el
 * momento: quien autoriza la escribe en la pantalla de quien pide. Es un número
 * APARTE de su contraseña (si alguien la ve en la caja, no entra al sistema con
 * ella). Activa y que entra al sistema. Devuelve `{ id, nombre }` o null; los
 * hashes no salen de este módulo.
 */
// Equivocadas SEGUIDAS contra la misma persona (de quien sea) para que su clave
// se apague: con 4 números hay 10,000 y así no se adivina a la fuerza.
const LIMITE_CLAVE = 10;

/**
 * ¿Es la clave de autorización de esta persona? Equivocada, cuenta (y a las
 * `LIMITE_CLAVE` seguidas se apaga: `{ apagada: true }`); buena, vuelve a cero.
 */
async function claveDe(usuarioId, clave, { porId = null } = {}) {
  const u = await model.buscarParaClave(Number(usuarioId) || 0);
  if (!u || !u.clave_autorizacion_hash) return null;
  if (!(await verificarPassword(String(clave ?? ''), u.clave_autorizacion_hash))) {
    const apagada = await model.claveEquivocada(Number(u.id), porId, LIMITE_CLAVE);
    if (apagada) {
      console.warn(`[autorizaciones] la clave de ${u.id} se apagó: ${LIMITE_CLAVE} equivocadas seguidas (la última, de ${porId})`);
    }
    return { equivocada: true, apagada };
  }
  await model.claveBuena(Number(u.id));
  return { id: Number(u.id), nombre: u.nombre };
}

/** Para la campana de quien la tenía: su clave se apagó por equivocadas. */
async function claveApagada(usuarioId) {
  return model.claveApagada(Number(usuarioId) || 0);
}

/**
 * "MI CLAVE PARA AUTORIZAR": cada quien pone (o cambia) la suya, confirmando con
 * su contraseña de entrar. De 4 a 6 números, y no puede ser su contraseña.
 */
async function fijarClaveAutorizacion(usuarioId, { contrasena, clave }) {
  if (!/^\d{4,6}$/.test(String(clave ?? ''))) {
    throw new AppError(422, 'CLAVE_INVALIDA', 'La clave para autorizar son de 4 a 6 números.');
  }
  const u = await model.buscarParaClave(Number(usuarioId) || 0);
  if (!u || !(await verificarPassword(String(contrasena ?? ''), u.contrasena_hash))) {
    throw new AppError(403, 'CONTRASENA_INCORRECTA', 'Tu contraseña no es correcta.');
  }
  await model.fijarClaveAutorizacion(u.id, await hashPassword(String(clave)));
  return { tiene_clave_autorizacion: true };
}

/** De estas personas, las que ya pusieron su clave de autorización. */
async function conClaveAutorizacion(ids) {
  return model.conClaveAutorizacion(ids.map(Number));
}

module.exports = {
  claveDe,
  claveApagada,
  LIMITE_CLAVE,
  fijarClaveAutorizacion,
  conClaveAutorizacion,
  crearStaff,
  iniciarSesion,
  perfil,
  listarStaff,
  actualizarStaff,
  roles,
};
