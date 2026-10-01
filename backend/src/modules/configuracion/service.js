'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');

/** Lo que ve la tienda pública: solo las claves marcadas `publica`. */
async function publica() {
  return model.mapa({ soloPublicas: true });
}

/** Lo que ve el panel: todas las claves con su descripción, para dibujar el formulario. */
async function completa() {
  return model.listar();
}

async function guardar(cambios) {
  const validas = new Set(await model.clavesValidas());
  const desconocidas = Object.keys(cambios).filter((c) => !validas.has(c));
  if (desconocidas.length) {
    throw new AppError(422, 'CLAVE_DESCONOCIDA',
      `Estas opciones no existen: ${desconocidas.join(', ')}`);
  }

  // El costo de envío alimenta el total del pedido: no puede ser texto ni negativo.
  if (cambios.envio_costo_fijo !== undefined && cambios.envio_costo_fijo !== null) {
    const n = Number(cambios.envio_costo_fijo);
    if (!Number.isFinite(n) || n < 0) {
      throw new AppError(422, 'ENVIO_COSTO_INVALIDO',
        'El costo de envío debe ser un número mayor o igual a cero.');
    }
    cambios.envio_costo_fijo = n.toFixed(2);
  }

  await model.guardar(cambios);
  return completa();
}

module.exports = { publica, completa, guardar };
