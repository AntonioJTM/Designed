'use strict';

const service = require('./service');
const { parsePagination, parseBool } = require('../../utils/query');
const permisos = require('../permisos/service');

async function listar(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listar({
      q: req.query.q,
      categoria_id: req.query.categoria_id ? Number(req.query.categoria_id) : undefined,
      activo: parseBool(req.query.activo),
      destacado: parseBool(req.query.destacado),
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
    // La ruta es pública (la usaba la tienda en línea): el precio de compra no.
    await permisos.sinCostosSiNoVe(req, data.variantes);
    // Los precios por lista, solo al personal: un visitante no ve a cuánto se
    // le vende a mayoreo. La pantalla de presentaciones los necesita.
    if (permisos.authOpcional(req)?.tipo === 'usuario') await service.conPreciosLista(data.variantes);
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

/** ¿Se puede borrar? y, si no, por qué. */
async function eliminacion(req, res, next) {
  try {
    return res.json({ data: await service.eliminacion(Number(req.params.id)), error: null });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listar, obtener, crear, actualizar, eliminar, eliminacion };
