'use strict';

const service = require('./service');
const { parsePagination } = require('../../utils/query');
const { AppError } = require('../../middlewares/error');

async function crear(req, res, next) {
  try {
    // Una venta POS solo la registra el personal (staff).
    if (req.body.canal === 'punto_venta' && req.auth?.tipo !== 'usuario') {
      throw new AppError(403, 'PROHIBIDO', 'Solo el personal puede registrar ventas de punto de venta');
    }
    // Un cliente autenticado solo puede crear pedidos a su propio nombre.
    if (req.auth?.tipo === 'cliente') {
      req.body.cliente_id = req.auth.sub;
    }
    // usuario_id solo si el que crea es staff (POS/admin); en online el cliente no lo lleva.
    const usuarioId = req.auth?.tipo === 'usuario' ? req.auth.sub : null;
    const data = await service.crear(req.body, usuarioId);
    res.status(201).json({ data, error: null });
  } catch (err) { next(err); }
}

async function obtener(req, res, next) {
  try {
    res.json({ data: await service.obtener(Number(req.params.id)), error: null });
  } catch (err) { next(err); }
}

async function listar(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listar({
      canal: req.query.canal,
      estado: req.query.estado,
      cliente_id: req.query.cliente_id ? Number(req.query.cliente_id) : undefined,
      page, limit, offset,
    });
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

// Pedidos del cliente autenticado (tienda en línea).
async function misPedidos(req, res, next) {
  try {
    if (req.auth?.tipo !== 'cliente') {
      throw new AppError(403, 'PROHIBIDO', 'Solo clientes pueden consultar sus pedidos');
    }
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listar({ cliente_id: req.auth.sub, page, limit, offset });
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

async function cambiarEstado(req, res, next) {
  try {
    res.json({ data: await service.cambiarEstado(Number(req.params.id), req.body.estado), error: null });
  } catch (err) { next(err); }
}

module.exports = { crear, obtener, listar, misPedidos, cambiarEstado };
