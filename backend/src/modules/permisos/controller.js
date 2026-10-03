'use strict';

const service = require('./service');

async function matriz(req, res, next) {
  try {
    res.json({ data: await service.matriz(), error: null });
  } catch (err) {
    next(err);
  }
}

async function guardar(req, res, next) {
  try {
    res.json({ data: await service.guardar(Number(req.params.id), req.body.claves), error: null });
  } catch (err) {
    next(err);
  }
}

async function crearRol(req, res, next) {
  try {
    res.status(201).json({ data: await service.crearRol(req.body), error: null });
  } catch (err) {
    next(err);
  }
}

module.exports = { matriz, guardar, crearRol };
