'use strict';

const service = require('./service');
const { parsePagination, parseBool } = require('../../utils/query');

async function listarStock(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listarStock({
      almacen_id: req.query.almacen_id ? Number(req.query.almacen_id) : undefined,
      variante_id: req.query.variante_id ? Number(req.query.variante_id) : undefined,
      q: req.query.q,
      bajo_stock: parseBool(req.query.bajo_stock),
      page,
      limit,
      offset,
    });
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function resumenPorAlmacen(req, res, next) {
  try {
    res.json({ data: await service.resumenPorAlmacen(), error: null });
  } catch (err) {
    next(err);
  }
}

async function alertas(req, res, next) {
  try {
    const data = await service.alertas();
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function listarMovimientos(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listarMovimientos({
      variante_id: req.query.variante_id ? Number(req.query.variante_id) : undefined,
      almacen_id: req.query.almacen_id ? Number(req.query.almacen_id) : undefined,
      tipo: req.query.tipo,
      // Agrupación en lenguaje de tienda: ventas, traspasos, desarmes…
      concepto: req.query.concepto,
      page,
      limit,
      offset,
    });
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function registrarMovimiento(req, res, next) {
  try {
    const data = await service.registrarMovimiento(req.body, req.auth.sub);
    res.status(201).json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function transferir(req, res, next) {
  try {
    const data = await service.transferir(req.body, req.auth.sub);
    res.status(201).json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function desarmar(req, res, next) {
  try {
    const data = await service.desarmar(req.body, req.auth.sub);
    res.status(201).json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function listarConversiones(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listarConversiones({
      variante_id: req.query.variante_id ? Number(req.query.variante_id) : null,
      page, limit, offset,
    });
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function crearTraspaso(req, res, next) {
  try {
    const data = await service.crearTraspaso(req.body, req.auth.sub);
    res.status(201).json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function listarTraspasos(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listarTraspasos({
      almacen_destino_id: req.query.almacen_destino_id ? Number(req.query.almacen_destino_id) : null,
      page, limit, offset,
    });
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function obtenerTraspaso(req, res, next) {
  try {
    res.json({ data: await service.obtenerTraspaso(Number(req.params.id)), error: null });
  } catch (err) {
    next(err);
  }
}

async function configurar(req, res, next) {
  try {
    const data = await service.configurar(req.body);
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listarStock,
  resumenPorAlmacen,
  alertas,
  listarMovimientos,
  registrarMovimiento,
  transferir,
  desarmar,
  listarConversiones,
  crearTraspaso,
  listarTraspasos,
  obtenerTraspaso,
  configurar,
};
