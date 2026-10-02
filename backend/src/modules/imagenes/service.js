'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');

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

async function eliminar(id) {
  await obtener(id);
  await model.eliminar(id);
}

module.exports = { obtener, crear, eliminar };
