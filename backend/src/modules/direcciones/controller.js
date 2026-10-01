'use strict';

const service = require('./service');

// El cliente sale del token, nunca del body: nadie edita direcciones ajenas.
const quien = (req) => req.auth.sub;

async function listar(req, res, next) {
  try {
    res.json({ data: await service.listar(quien(req)), error: null });
  } catch (err) { next(err); }
}

async function obtener(req, res, next) {
  try {
    res.json({ data: await service.obtener(Number(req.params.id), quien(req)), error: null });
  } catch (err) { next(err); }
}

async function crear(req, res, next) {
  try {
    res.status(201).json({ data: await service.crear(quien(req), req.body), error: null });
  } catch (err) { next(err); }
}

async function actualizar(req, res, next) {
  try {
    const d = await service.actualizar(Number(req.params.id), quien(req), req.body);
    res.json({ data: d, error: null });
  } catch (err) { next(err); }
}

async function eliminar(req, res, next) {
  try {
    await service.eliminar(Number(req.params.id), quien(req));
    res.json({ data: { eliminado: true }, error: null });
  } catch (err) { next(err); }
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
