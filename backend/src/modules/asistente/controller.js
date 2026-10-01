'use strict';

const service = require('./service');

async function preguntar(req, res, next) {
  try {
    const data = await service.preguntar({
      pregunta: req.body.pregunta,
      historial: req.body.historial,
      // El rol sale del TOKEN, nunca del body: si viniera del cliente,
      // cualquiera podría pedir el margen diciendo que es administrador.
      rol: req.auth?.rol ?? 'cajero',
    });
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

async function capacidades(req, res, next) {
  try {
    res.json({ data: service.capacidades(req.auth?.rol ?? 'cajero'), error: null });
  } catch (err) { next(err); }
}

module.exports = { preguntar, capacidades };
