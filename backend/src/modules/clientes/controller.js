'use strict';

const service = require('./service');
const analisis = require('./analisis');
const { DIAS_SIN_VENIR } = require('../notificaciones/model');
const { parsePagination, parseBool } = require('../../utils/query');

// Controladores del dominio clientes. Responden con la forma { data, error }.

async function registrar(req, res, next) {
  try {
    const resultado = await service.registrar(req.body);
    return res.status(201).json({ data: resultado, error: null });
  } catch (err) {
    return next(err);
  }
}

async function iniciarSesion(req, res, next) {
  try {
    const resultado = await service.iniciarSesion(req.body);
    return res.status(200).json({ data: resultado, error: null });
  } catch (err) {
    return next(err);
  }
}

async function perfil(req, res, next) {
  try {
    const cliente = await service.perfil(req.auth.sub);
    return res.status(200).json({ data: cliente, error: null });
  } catch (err) {
    return next(err);
  }
}

// --- El expediente: solo personal ---

async function listar(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listarClientes({
      q: req.query.q,
      con_saldo: parseBool(req.query.con_saldo),
      activo: parseBool(req.query.activo),
      orden: req.query.orden,
      page, limit, offset,
    });
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

async function expediente(req, res, next) {
  try {
    // `?pedidos=todos` trae todas sus compras (con tope, por si acaso); sin él,
    // las 20 más recientes.
    const limitePedidos = req.query.pedidos === 'todos' ? 500 : 20;
    res.json({ data: await service.expediente(Number(req.params.id), { limitePedidos }), error: null });
  } catch (err) { next(err); }
}

/** Búsqueda rápida para el mostrador. */
async function buscar(req, res, next) {
  try {
    res.json({ data: await service.buscarParaVenta(req.query.q), error: null });
  } catch (err) { next(err); }
}

async function crearDesdeStaff(req, res, next) {
  try {
    res.status(201).json({ data: await service.crearDesdeStaff(req.body), error: null });
  } catch (err) { next(err); }
}

async function actualizar(req, res, next) {
  try {
    const data = await service.actualizarCliente(Number(req.params.id), req.body);
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

// --- Crédito ---

async function abonar(req, res, next) {
  try {
    const data = await service.registrarAbono(Number(req.params.id), req.body, req.auth?.sub);
    res.status(201).json({ data, error: null });
  } catch (err) { next(err); }
}

async function ajustar(req, res, next) {
  try {
    const data = await service.ajustarCredito(Number(req.params.id), req.body, req.auth?.sub);
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

/** Una pestaña de Clientes. `dias`: 30, 90 (por omisión), 365 o 3650 ("desde siempre"). */
async function analisisVista(req, res, next) {
  try {
    // Dejaron de venir no va por periodo sino por "días sin venir" (por
    // omisión, los del aviso de la campana).
    if (req.params.vista === 'dejaron') {
      const pedido = Number(req.query.sin_venir);
      const sinVenir = [30, 60, 90, 180].includes(pedido) ? pedido : DIAS_SIN_VENIR;
      return res.json({ data: await analisis.dejaron({ sinVenir }), error: null });
    }
    const VISTAS = { frecuencia: analisis.frecuencia, deuda: analisis.deuda, 'que-compra': analisis.queCompra, cuando: analisis.cuando, gasto: analisis.gasto };
    const fn = VISTAS[req.params.vista];
    if (!fn) return res.status(404).json({ data: null, error: { code: 'NO_ENCONTRADO', message: 'Esa vista no existe' } });
    const dias = [30, 90, 365, 3650].includes(Number(req.query.dias)) ? Number(req.query.dias) : 90;
    return res.json({ data: await fn({ dias }), error: null });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  analisis: analisisVista,
  registrar, iniciarSesion, perfil,
  listar, expediente, buscar, crearDesdeStaff, actualizar,
  abonar, ajustar,
};
