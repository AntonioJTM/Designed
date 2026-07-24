'use strict';

const service = require('./service');
const { parsePagination, parseBool } = require('../../utils/query');

async function listar(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listar({
      producto_id: req.query.producto_id ? Number(req.query.producto_id) : undefined,
      q: req.query.q,
      activo: parseBool(req.query.activo),
      page,
      limit,
      offset,
    });
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

// ---- Códigos de barras adicionales ----

async function listarCodigos(req, res, next) {
  try {
    const data = await service.listarCodigos(Number(req.params.id));
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function agregarCodigo(req, res, next) {
  try {
    const data = await service.agregarCodigo(Number(req.params.id), req.body);
    return res.status(201).json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function eliminarCodigo(req, res, next) {
  try {
    await service.eliminarCodigo(Number(req.params.codigoId));
    return res.json({ data: { eliminado: true }, error: null });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listar,
  obtener,
  crear,
  actualizar,
  eliminar,
  listarCodigos,
  agregarCodigo,
  eliminarCodigo,
};
