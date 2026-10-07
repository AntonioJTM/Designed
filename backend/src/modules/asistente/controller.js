'use strict';

const service = require('./service');
const permisos = require('../permisos/service');

/**
 * El "rol" que ve el asistente sale de Permisos: quien tiene «Ver costos y
 * márgenes» usa las herramientas de costos (las que antes eran solo de
 * administrador y gerente). Sale del TOKEN, nunca del body: si viniera del
 * cliente, cualquiera podría pedir el margen diciendo que es administrador.
 */
async function rolParaAsistente(auth) {
  if (await permisos.esAdmin(auth)) return 'administrador';
  return (await permisos.puede(auth, 'hacer:ver_costos')) ? 'gerente' : 'cajero';
}

async function preguntar(req, res, next) {
  try {
    const data = await service.preguntar({
      pregunta: req.body.pregunta,
      historial: req.body.historial,
      rol: await rolParaAsistente(req.auth),
    });
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

async function capacidades(req, res, next) {
  try {
    res.json({ data: service.capacidades(await rolParaAsistente(req.auth)), error: null });
  } catch (err) { next(err); }
}

module.exports = { preguntar, capacidades };
