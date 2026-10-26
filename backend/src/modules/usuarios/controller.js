'use strict';

const service = require('./service');
const permisos = require('../permisos/service');
const { parseBool } = require('../../utils/query');
const { AppError } = require('../../middlewares/error');
const permisosModel = require('../permisos/model');
const usuariosModel = require('./model');
const almacenesModel = require('../almacenes/model');

/**
 * El puesto de ADMINISTRADOR solo lo da —o lo toca— otro administrador.
 * Personal se puede abrir a otros puestos desde Permisos (`ver:personal`), y sin
 * esto quien lo tuviera podría darse el puesto que lo puede todo, o quitárselo
 * al dueño. El administrador es el único que no se configura en Permisos: tiene
 * que seguir siendo de quien el dueño diga.
 */
async function cuidarAdministrador(req, { rolNuevo, otrosNuevos, usuarioId }) {
  if (await permisos.esAdmin(req.auth)) return;
  const admin = await permisosModel.porNombre('administrador');
  if (!admin) return;
  const esElDeAdmin = (id) => Number(id) === Number(admin.id);
  const noPuede = () =>
    new AppError(403, 'SOLO_ADMINISTRADOR', 'Solo un administrador puede dar o cambiar el puesto de administrador.');
  // Tampoco como puesto EXTRA: daría lo mismo que dárselo de principal.
  if (rolNuevo !== undefined && esElDeAdmin(rolNuevo)) throw noPuede();
  if ((otrosNuevos ?? []).some(esElDeAdmin)) throw noPuede();
  if (usuarioId) {
    const actual = await usuariosModel.buscarPorId(usuarioId);
    if (actual && (esElDeAdmin(actual.rol_id) || (actual.otros_roles ?? []).some((r) => esElDeAdmin(r.id)))) {
      throw noPuede();
    }
  }
}

/**
 * De qué tiendas es quien entra (2026-10-15), para que el panel solo le ofrezca
 * lo suyo: `{ todas: true }` o `{ todas: false, almacenes: [{ id, nombre }] }`.
 */
async function tiendasDeSesion(usuarioId) {
  const ids = await permisos.almacenesDe({ tipo: 'usuario', sub: usuarioId });
  if (ids === null) return { todas: true, almacenes: [] };
  if (!ids.length) return { todas: false, almacenes: [] };
  return { todas: false, almacenes: await almacenesModel.nombresDe(ids) };
}

/** Quien NO ve todas las tiendas solo ve y edita al personal de las suyas. */
function esDeSusTiendas(u, alcance) {
  if (alcance === null) return true;
  if (u.todas_las_tiendas && u.rol !== 'cargador') return false;
  return (u.tiendas ?? []).some((t) => alcance.includes(Number(t.id)));
}

// Login y perfil (sesión propia).
async function iniciarSesion(req, res, next) {
  try {
    const resultado = await service.iniciarSesion(req.body);
    // Lo que puede ver y hacer, para que el panel arme su menú sin otra consulta.
    resultado.usuario.permisos = [...(await permisos.clavesDe({ tipo: 'usuario', sub: resultado.usuario.id }))];
    resultado.usuario.alcance = await tiendasDeSesion(resultado.usuario.id);
    return res.status(200).json({ data: resultado, error: null });
  } catch (err) {
    return next(err);
  }
}

async function perfil(req, res, next) {
  try {
    const usuario = await service.perfil(req.auth.sub);
    usuario.permisos = [...(await permisos.clavesDe({ tipo: 'usuario', sub: usuario.id }))];
    usuario.alcance = await tiendasDeSesion(usuario.id);
    return res.status(200).json({ data: usuario, error: null });
  } catch (err) {
    return next(err);
  }
}

// Gestión de staff (solo administradores).
async function listar(req, res, next) {
  try {
    const alcance = await permisos.almacenesDe(req.auth);
    const data = (await service.listarStaff({ q: req.query.q, activo: parseBool(req.query.activo) }))
      .filter((u) => esDeSusTiendas(u, alcance));
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function crear(req, res, next) {
  try {
    await cuidarAdministrador(req, { rolNuevo: req.body.rol_id, otrosNuevos: req.body.otros_roles });
    const data = await service.crearStaff(req.body, await permisos.almacenesDe(req.auth));
    return res.status(201).json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function actualizar(req, res, next) {
  try {
    await cuidarAdministrador(req, {
      rolNuevo: req.body.rol_id, otrosNuevos: req.body.otros_roles, usuarioId: Number(req.params.id),
    });
    const alcance = await permisos.almacenesDe(req.auth);
    const actual = await usuariosModel.buscarPorId(Number(req.params.id));
    if (actual && !esDeSusTiendas(actual, alcance)) {
      throw new AppError(404, 'OTRA_TIENDA', 'Esa persona es de otra tienda.');
    }
    const data = await service.actualizarStaff(Number(req.params.id), req.body, alcance);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function roles(req, res, next) {
  try {
    return res.json({ data: await service.roles(), error: null });
  } catch (err) {
    return next(err);
  }
}

/** "Mi clave para autorizar" (2026-10-19): la de quien tiene la sesión. */
async function fijarClaveAutorizacion(req, res, next) {
  try {
    res.json({ data: await service.fijarClaveAutorizacion(req.auth.sub, req.body), error: null });
  } catch (err) {
    next(err);
  }
}

module.exports = { iniciarSesion, perfil, listar, crear, actualizar, roles, fijarClaveAutorizacion };
