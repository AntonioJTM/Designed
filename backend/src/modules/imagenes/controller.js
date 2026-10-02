'use strict';

const service = require('./service');

async function crear(req, res, next) {
  try {
    const data = await service.crear(req.body);
    return res.status(201).json({ data, error: null });
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

module.exports = { crear, eliminar };
