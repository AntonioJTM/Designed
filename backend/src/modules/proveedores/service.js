'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');

async function listar(filtros) {
  return model.listar(filtros);
}

/**
 * Da de alta un proveedor. Basta el nombre: se crea al vuelo desde la carga.
 * Si ya existe (sin distinguir mayúsculas ni espacios de más), 409 con el que
 * ya está, para que la pantalla lo elija en vez de duplicarlo.
 */
async function crear(datos) {
  const nombre = String(datos.nombre ?? '').replace(/\s+/g, ' ').trim();
  if (!nombre) throw new AppError(422, 'FALTA_NOMBRE', 'Escribe el nombre del proveedor');
  const existe = await model.porNombre(nombre);
  if (existe) {
    throw new AppError(409, 'PROVEEDOR_REPETIDO', `Ya existe el proveedor «${existe.nombre}»: elígelo de la lista.`);
  }
  return model.crear({ ...datos, nombre });
}

module.exports = { listar, crear };
