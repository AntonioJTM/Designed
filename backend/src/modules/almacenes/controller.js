'use strict';

const service = require('./service');
const { parseBool } = require('../../utils/query');

async function listar(req, res, next) {
  try {
    const data = await service.listar({ activo: parseBool(req.query.activo) });
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function obtener(req, res, next) {
  try {
    const data = await service.obtener(Number(req.params.id));
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function crear(req, res, next) {
  try {
    const data = await service.crear(req.body);
    res.status(201).json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function actualizar(req, res, next) {
  try {
    const data = await service.actualizar(Number(req.params.id), req.body);
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, obtener, crear, actualizar };
