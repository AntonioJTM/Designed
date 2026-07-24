'use strict';

const service = require('./service');
const { AppError } = require('../../middlewares/error');

async function listar(req, res, next) {
  try {
    const producto_id = Number(req.query.producto_id);
    if (!producto_id) {
      throw new AppError(422, 'FALTA_PRODUCTO', 'Se requiere el parámetro producto_id');
    }
    const data = await service.listar(producto_id);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function obtener(req, res, next) {
  try {
    const data = await service.obtener(Number(req.params.id));
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function crear(req, res, next) {
  try {
    const data = await service.crear(req.body);
    return res.status(201).json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function actualizar(req, res, next) {
  try {
    const data = await service.actualizar(Number(req.params.id), req.body);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function eliminar(req, res, next) {
  try {
    await service.eliminar(Number(req.params.id));
    return res.json({ data: { eliminado: true }, error: null });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
