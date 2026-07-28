'use strict';

const service = require('./service');
const { parseBool } = require('../../utils/query');

async function listar(req, res, next) {
  try {
    res.json({ data: await service.listar({ activo: parseBool(req.query.activo) }), error: null });
  } catch (err) { next(err); }
}

async function obtener(req, res, next) {
  try {
    res.json({ data: await service.obtener(Number(req.params.id)), error: null });
  } catch (err) { next(err); }
}

async function crear(req, res, next) {
  try {
    res.status(201).json({ data: await service.crear(req.body), error: null });
  } catch (err) { next(err); }
}

async function actualizar(req, res, next) {
  try {
    res.json({ data: await service.actualizar(Number(req.params.id), req.body), error: null });
  } catch (err) { next(err); }
}

async function eliminar(req, res, next) {
  try {
    await service.eliminar(Number(req.params.id));
    res.json({ data: { eliminado: true }, error: null });
  } catch (err) { next(err); }
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
