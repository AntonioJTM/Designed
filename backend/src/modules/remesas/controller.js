'use strict';

const service = require('./service');
const { parsePagination } = require('../../utils/query');
const { AppError } = require('../../middlewares/error');

/**
 * Lee el archivo y devuelve la vista previa sin tocar la base.
 * El cuerpo llega como bytes crudos del .xlsx (ver routes.js).
 */
async function previa(req, res, next) {
  try {
    if (!req.body || !req.body.length) {
      throw new AppError(422, 'ARCHIVO_REQUERIDO', 'Sube el archivo de la lista de empaque');
    }
    const nombre = req.get('X-Nombre-Archivo') || null;
    res.json({ data: await service.previa(req.body, nombre), error: null });
  } catch (err) {
    next(err);
  }
}

async function confirmar(req, res, next) {
  try {
    res.status(201).json({ data: await service.confirmar(req.body, req.auth.sub), error: null });
  } catch (err) {
    next(err);
  }
}

async function listar(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listar({
      variante_id: req.query.variante_id ? Number(req.query.variante_id) : null,
      page,
      limit,
      offset,
    });
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function obtener(req, res, next) {
  try {
    res.json({ data: await service.obtener(Number(req.params.id)), error: null });
  } catch (err) {
    next(err);
  }
}

module.exports = { previa, confirmar, listar, obtener };
