'use strict';

const service = require('./service');

async function publica(req, res, next) {
  try {
    res.json({ data: await service.publica(), error: null });
  } catch (err) { next(err); }
}

async function completa(req, res, next) {
  try {
    res.json({ data: await service.completa(), error: null });
  } catch (err) { next(err); }
}

async function guardar(req, res, next) {
  try {
    res.json({ data: await service.guardar(req.body), error: null });
  } catch (err) { next(err); }
}

module.exports = { publica, completa, guardar };
