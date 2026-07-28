'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');
const { paginado } = require('../../utils/query');

async function crear(datos, usuarioId) {
  if (!datos.items || datos.items.length === 0) {
    throw new AppError(422, 'SIN_ITEMS', 'El pedido debe tener al menos un artículo');
  }
  return model.crearPedido(datos, usuarioId);
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

module.exports = { crear, obtener, listar, cambiarEstado };
