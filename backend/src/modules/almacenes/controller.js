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

/** Almacén del que descuenta la tienda en línea. */
async function tiendaLinea(req, res, next) {
  try {
    const data = await service.tiendaLinea();
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

/** Almacén que surte a las sucursales. */
async function matriz(req, res, next) {
  try {
    res.json({ data: await service.matriz(), error: null });
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

async function eliminar(req, res, next) {
  try {
    await service.eliminar(Number(req.params.id));
    res.json({ data: { eliminado: true }, error: null });
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, tiendaLinea, matriz, obtener, crear, actualizar, eliminar };
