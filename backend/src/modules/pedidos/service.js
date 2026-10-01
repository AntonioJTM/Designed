'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');
const { paginado } = require('../../utils/query');

async function crear(datos, usuarioId, opciones) {
  if (!datos.items || datos.items.length === 0) {
    throw new AppError(422, 'SIN_ITEMS', 'El pedido debe tener al menos un artículo');
  }
  return model.crearPedido(datos, usuarioId, opciones);
}

/** El desglose del pedido antes de confirmarlo. No escribe nada. */
async function cotizar(datos, opciones) {
  if (!datos.items || datos.items.length === 0) {
    throw new AppError(422, 'SIN_ITEMS', 'El pedido debe tener al menos un artículo');
  }
  return model.cotizar(datos, opciones);
}

async function obtener(id) {
  const p = await model.obtener(id);
  if (!p) throw new AppError(404, 'NO_ENCONTRADO', 'Pedido no encontrado');
  return p;
}

async function listar(filtros) {
  const { rows, total } = await model.listar(filtros);
  return paginado(rows, total, filtros.page, filtros.limit);
}

async function cambiarEstado(id, estado, usuarioId, devoluciones) {
  return model.cambiarEstado(id, estado, usuarioId, devoluciones);
}

/**
 * Sube la captura del comprobante y da el pedido por pagado. El límite de
 * tamaño lo pone la ruta; aquí solo se comprueba que de verdad venga algo.
 */
async function guardarComprobante(id, buf, nombre, usuarioId) {
  if (!buf || !buf.length) {
    throw new AppError(422, 'ARCHIVO_REQUERIDO', 'Sube la captura del comprobante');
  }
  return model.guardarComprobante(id, buf, nombre, usuarioId);
}

async function leerComprobante(id) {
  const c = await model.leerComprobante(id);
  if (!c) {
    throw new AppError(404, 'SIN_COMPROBANTE',
      'Este pedido no tiene comprobante, o el archivo ya no está.');
  }
  return c;
}

async function borrarComprobante(id) {
  return model.borrarComprobante(id);
}

// ---- Apartados ----

/** Los apartados vigentes, con lo que llevan pagado. */
async function apartados(filtros = {}) {
  return model.listarApartados({
    cliente_id: filtros.cliente_id ? Number(filtros.cliente_id) : undefined,
    orden: filtros.orden,
  });
}

async function abonarApartado(id, datos, usuarioId) {
  if (!datos.metodo_pago_id) {
    throw new AppError(422, 'FALTA_METODO_PAGO', 'Di con qué está pagando el abono');
  }
  return model.abonarApartado(id, datos, usuarioId);
}

/** Entrega la mercancía. Exige que esté liquidado; lo valida el modelo. */
async function entregarApartado(id, usuarioId) {
  return model.entregarApartado(id, usuarioId);
}

module.exports = {
  crear, cotizar, obtener, listar, cambiarEstado,
  guardarComprobante, leerComprobante, borrarComprobante,
  apartados, abonarApartado, entregarApartado,
};
