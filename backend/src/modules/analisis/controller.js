'use strict';

const service = require('./service');

const responder = (fn) => async (req, res, next) => {
  try {
    res.json({ data: await fn(req.query), error: null });
  } catch (err) { next(err); }
};

module.exports = {
  cobranza: responder(service.cobranza),
  clientesEnfriados: responder(service.clientesEnfriados),
  hiloMuerto: responder(service.hiloMuerto),
  margen: responder(service.margen),
  tablero: responder(service.tablero),
};
