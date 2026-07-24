'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');

async function listar(filtros) {
  return model.listar(filtros);
}

async function obtener(id) {
  const a = await model.obtener(id);
  if (!a) throw new AppError(404, 'NO_ENCONTRADO', 'Almacén no encontrado');
  return a;
}

async function crear(datos) {
  return model.crear({
    nombre: datos.nombre,
    direccion: datos.direccion ?? null,
    es_punto_venta: datos.es_punto_venta ?? false,
    activo: datos.activo ?? true,
  });
}

async function actualizar(id, datos) {
  const actual = await obtener(id);
  return model.actualizar(id, {
    nombre: datos.nombre ?? actual.nombre,
    direccion: datos.direccion !== undefined ? datos.direccion : actual.direccion,
    es_punto_venta: datos.es_punto_venta !== undefined ? datos.es_punto_venta : actual.es_punto_venta,
    activo: datos.activo !== undefined ? datos.activo : actual.activo,
  });
}

module.exports = { listar, obtener, crear, actualizar };
