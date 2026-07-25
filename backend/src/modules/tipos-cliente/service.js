'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');

async function listar(filtros) {
  return model.listar(filtros);
}

async function obtener(id) {
  const t = await model.obtener(id);
  if (!t) throw new AppError(404, 'NO_ENCONTRADO', 'Tipo de cliente no encontrado');
  return t;
}

async function crear(datos) {
  return model.crear({
    nombre: datos.nombre.trim(),
    orden: datos.orden ?? 0,
    activo: datos.activo ?? true,
  });
}

async function actualizar(id, datos) {
  const actual = await obtener(id);
  return model.actualizar(id, {
    nombre: datos.nombre !== undefined ? datos.nombre.trim() : actual.nombre,
    orden: datos.orden !== undefined ? datos.orden : actual.orden,
    activo: datos.activo !== undefined ? datos.activo : actual.activo,
  });
}

async function eliminar(id) {
  const actual = await obtener(id);
  if (actual.es_publico) {
    throw new AppError(409, 'TIPO_PUBLICO',
      'El tipo público no se puede eliminar: es la lista de precios base.');
  }
  const dep = await model.dependencias(id);
  const enUso = [];
  if (Number(dep.precios) > 0) enUso.push(`${dep.precios} precio(s) capturados`);
  if (Number(dep.pedidos) > 0) enUso.push(`${dep.pedidos} pedido(s) vendidos con él`);
  if (enUso.length) {
    throw new AppError(409, 'TIPO_EN_USO',
      `No se puede eliminar "${actual.nombre}": tiene ${enUso.join(' y ')}. ` +
      'Desactívalo en vez de borrarlo para conservar el historial.');
  }
  await model.eliminar(id);
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
