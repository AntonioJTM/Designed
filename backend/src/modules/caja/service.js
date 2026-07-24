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
  abrirSesion,
  sesionAbierta,
  obtenerSesion,
  registrarMovimiento,
  cerrarSesion,
};
