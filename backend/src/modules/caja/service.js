'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');

async function listarCajas() {
  return model.listarCajas();
}

async function crearCaja(datos) {
  return model.crearCaja({
    almacen_id: datos.almacen_id,
    nombre: datos.nombre,
    activo: datos.activo ?? true,
  });
}

async function actualizarCaja(id, datos) {
  const actual = await model.obtenerCaja(id);
  if (!actual) throw new AppError(404, 'NO_ENCONTRADO', 'Caja no encontrada');
  return model.actualizarCaja(id, {
    almacen_id: datos.almacen_id ?? actual.almacen_id,
    nombre: datos.nombre ?? actual.nombre,
    activo: datos.activo !== undefined ? datos.activo : actual.activo,
  });
}

/**
 * Solo se puede borrar una caja que nunca abrió turno. Si ya operó, su
 * historial de cortes depende de ella: se desactiva en vez de borrarse.
 */
async function eliminarCaja(id) {
  const actual = await model.obtenerCaja(id);
  if (!actual) throw new AppError(404, 'NO_ENCONTRADO', 'Caja no encontrada');
  if (await model.tieneSesiones(id)) {
    throw new AppError(409, 'CAJA_CON_HISTORIAL',
      'Esta caja ya tuvo turnos y sus cortes dependen de ella. Desactívala en vez de borrarla.');
  }
  await model.eliminarCaja(id);
}

async function abrirSesion(datos, usuarioId) {
  return model.abrirSesion({
    caja_id: datos.caja_id,
    usuario_id: usuarioId,
    monto_inicial: datos.monto_inicial ?? 0,
  });
}

async function sesionAbierta(caja_id) {
  return model.sesionAbiertaDeCaja(caja_id);
}

async function obtenerSesion(id) {
  const s = await model.obtenerSesion(id);
  if (!s) throw new AppError(404, 'NO_ENCONTRADO', 'Sesión de caja no encontrada');
  return s;
}

async function registrarMovimiento(sesionId, datos) {
  return model.registrarMovimientoManual(sesionId, datos);
}

async function cerrarSesion(id, datos) {
  return model.cerrarSesion(id, datos.monto_final);
}

module.exports = {
  listarCajas,
  crearCaja,
  actualizarCaja,
  eliminarCaja,
  abrirSesion,
  sesionAbierta,
  obtenerSesion,
  registrarMovimiento,
  cerrarSesion,
};
