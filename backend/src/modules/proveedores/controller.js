'use strict';

const service = require('./service');
const { parseBool } = require('../../utils/query');

async function listar(req, res, next) {
  try {
    res.json({ data: await service.listar({ activo: parseBool(req.query.activo) }), error: null });
  } catch (err) { next(err); }
}

async function crear(req, res, next) {
  try {
    res.status(201).json({ data: await service.crear(req.body), error: null });
  } catch (err) { next(err); }
}

module.exports = { listar, crear };
