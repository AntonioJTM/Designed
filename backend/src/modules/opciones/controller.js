'use strict';

const model = require('./model');

// Endpoints de solo lectura para poblar selects del panel admin.
// Son tablas de referencia (catálogos auxiliares) del esquema.

const responder = (consulta) => async (req, res, next) => {
  try {
    res.json({ data: await consulta(), error: null });
  } catch (err) {
    next(err);
  }
};

/** Líneas de procedencia del hilo: turco, nacional, chino. */
const lineas = responder(model.lineas);
const unidades = responder(model.unidades);
const impuestos = responder(model.impuestos);
const metodosPago = responder(model.metodosPago);

module.exports = { lineas, unidades, impuestos, metodosPago };
