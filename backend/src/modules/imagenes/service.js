'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');

async function listar(producto_id) {
  return model.listar({ producto_id });
}

async function obtener(id) {
  const img = await model.obtener(id);
  if (!img) throw new AppError(404, 'NO_ENCONTRADO', 'Imagen no encontrada');
  return img;
}

async function crear(datos) {
  const registro = {
    producto_id: datos.producto_id,
    variante_id: datos.variante_id ?? null,
    url: datos.url.trim(),
    es_principal: datos.es_principal ?? false,
    orden: datos.orden ?? 0,
  };
  return model.crear(registro);
}

async function actualizar(id, datos) {
  const actual = await obtener(id);
  const merge = (campo) => (datos[campo] !== undefined ? datos[campo] : actual[campo]);
  const registro = {
    producto_id: actual.producto_id, // no se mueve de producto
    variante_id: merge('variante_id'),
    url: datos.url !== undefined ? datos.url.trim() : actual.url,
    es_principal: merge('es_principal'),
    orden: merge('orden'),
  };
  return model.actualizar(id, registro);
}

async function eliminar(id) {
  await obtener(id);
  await model.eliminar(id);
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
