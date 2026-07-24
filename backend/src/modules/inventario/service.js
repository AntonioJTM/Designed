'use strict';

const model = require('./model');
const { paginado } = require('../../utils/query');

async function listarStock(filtros) {
  const { rows, total } = await model.listarStock(filtros);
  return paginado(rows, total, filtros.page, filtros.limit);
}

async function alertas() {
  return model.alertas();
}

async function listarMovimientos(filtros) {
  const { rows, total } = await model.listarMovimientos(filtros);
  return paginado(rows, total, filtros.page, filtros.limit);
}

async function registrarMovimiento(datos, usuarioId) {
  return model.registrarMovimiento(datos, usuarioId);
}

async function transferir(datos, usuarioId) {
  return model.transferir(datos, usuarioId);
}

async function configurar(datos) {
  return model.configurar({
    variante_id: datos.variante_id,
    almacen_id: datos.almacen_id,
    stock_minimo: datos.stock_minimo ?? 0,
    stock_maximo: datos.stock_maximo ?? null,
    ubicacion_fisica: datos.ubicacion_fisica ?? null,
  });
}

module.exports = {
  listarStock,
  alertas,
  listarMovimientos,
  registrarMovimiento,
  transferir,
  configurar,
};
