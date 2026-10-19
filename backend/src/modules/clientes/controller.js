'use strict';

const service = require('./service');
const analisis = require('./analisis');
const lugares = require('./lugares');
const tickets = require('./tickets');
const { DIAS_SIN_VENIR } = require('../notificaciones/model');
const permisos = require('../permisos/service');
const { pool } = require('../../config/db');

/** El turno con que se cobra tiene que ser de SUS tiendas (2026-10-15). */
const _cajaDeSusTiendas = (auth, sesionId) => permisos.exigirTurno(auth, sesionId);

/**
 * El ticket de un ABONO se ve con la misma regla que el expediente (2026-10-19):
 * es de la tienda de su nota y de la caja que lo cobró; si no es de ninguna de
 * las suyas, no existe para quien pregunta. Sin nota ni caja (transferencia a la
 * cuenta) no es de ninguna tienda y se ve completo (decisión del usuario,
 * 2026-10-16). Antes solo se miraba la caja y una transferencia A UNA NOTA de
 * otra tienda salía completa.
 */
async function _abonoDeSusTiendas(auth, movId) {
  const almacenes = await permisos.almacenesDe(auth);
  if (almacenes === null) return null;
  const [[m]] = await pool.query(
    `SELECT p.almacen_id AS de_nota, cj.almacen_id AS de_caja
       FROM credito_movimientos m
       LEFT JOIN pedidos p       ON p.id = m.pedido_id
       LEFT JOIN sesiones_caja s ON s.id = m.sesion_caja_id
       LEFT JOIN cajas cj        ON cj.id = s.caja_id
      WHERE m.id = :id`,
    { id: Number(movId) }
  );
  const suyas = [m?.de_nota, m?.de_caja].filter((a) => a != null).map(Number);
  if (suyas.length && !suyas.some((a) => almacenes.includes(a))) {
    throw new AppError(404, 'OTRA_TIENDA', 'Ese abono no es de tus tiendas.');
  }
  return almacenes;
}

/** El ticket de un anticipo cobrado en la caja de OTRA tienda no se reimprime aquí. */
async function _movimientoDeSusTiendas(auth, tabla, movId) {
  const [[m]] = await pool.query(`SELECT sesion_caja_id FROM ${tabla} WHERE id = :id`, { id: Number(movId) });
  if (m?.sesion_caja_id) await permisos.exigirTurno(auth, m.sesion_caja_id);
}
const { parsePagination, parseBool } = require('../../utils/query');
const { AppError } = require('../../middlewares/error');

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
      lugar_entrega_id: Number(req.query.lugar_entrega_id) || undefined,
      sin_lugar: parseBool(req.query.sin_lugar),
      orden: req.query.orden,
      page, limit, offset,
      almacenes: await permisos.almacenesDe(req.auth),
    });
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

async function expediente(req, res, next) {
  try {
    // `?pedidos=todos` trae todas sus compras (con tope, por si acaso); sin él,
    // las 20 más recientes.
    const limitePedidos = req.query.pedidos === 'todos' ? 500 : 20;
    const almacenes = await permisos.almacenesDe(req.auth);
    res.json({ data: await service.expediente(Number(req.params.id), { limitePedidos, almacenes }), error: null });
  } catch (err) { next(err); }
}

/**
 * LO QUE SIEMPRE LLEVA (2026-10-16): sus 5 hilos más comprados (por
 * `producto_id`: el mismo color en dos calibres son dos hilos), de SUS tiendas.
 * La caja los pone como botones al elegir al cliente.
 */
async function loQueLleva(req, res, next) {
  try {
    const almacenes = await permisos.almacenesDe(req.auth);
    res.json({ data: await service.loQueLleva(Number(req.params.id), almacenes), error: null });
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
    await _cajaDeSusTiendas(req.auth, req.body?.sesion_caja_id);
    const data = await service.registrarAbono(Number(req.params.id), req.body, req.auth?.sub, {
      almacenes: await permisos.almacenesDe(req.auth),
    });
    res.status(201).json({ data, error: null });
  } catch (err) { next(err); }
}

/** Las notas a crédito que esta persona puede pagar una por una, y lo que debe en total. */
async function notasCredito(req, res, next) {
  try {
    const data = await service.notasCredito(Number(req.params.id), await permisos.almacenesDe(req.auth));
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

/** Los datos del ticket de un abono a su cuenta (al registrarlo o para reimprimirlo). */
async function ticketAbono(req, res, next) {
  try {
    const almacenes = await _abonoDeSusTiendas(req.auth, req.params.movId);
    const data = await tickets.abonoCuenta(Number(req.params.id), Number(req.params.movId), { almacenes });
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

/** Los datos del ticket de un anticipo (al registrarlo o para reimprimirlo). */
async function ticketAnticipo(req, res, next) {
  try {
    await _movimientoDeSusTiendas(req.auth, 'saldo_favor_movimientos', req.params.movId);
    const data = await tickets.anticipo(Number(req.params.id), Number(req.params.movId));
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

/** Descuenta su saldo a favor de lo que debe (notas pendientes y crédito). */
async function aplicarSaldoFavor(req, res, next) {
  try {
    const data = await service.aplicarSaldoFavor(Number(req.params.id), req.body, req.auth?.sub);
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

/** Ajustar a mano su saldo a favor (sumar o quitar, con motivo). */
async function ajustarSaldoFavor(req, res, next) {
  try {
    const data = await service.ajustarSaldoFavor(Number(req.params.id), req.body, req.auth?.sub);
    res.status(201).json({ data, error: null });
  } catch (err) { next(err); }
}

/** Dinero a cuenta, sin nota: le queda a favor. */
async function recibirAnticipo(req, res, next) {
  try {
    await _cajaDeSusTiendas(req.auth, req.body?.sesion_caja_id);
    const data = await service.recibirAnticipo(Number(req.params.id), req.body, req.auth?.sub);
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

// --- Lugares de entrega (2026-10-14) ---

async function lugaresListar(req, res, next) {
  try { res.json({ data: await lugares.listar(), error: null }); } catch (err) { next(err); }
}

async function lugaresCrear(req, res, next) {
  try { res.status(201).json({ data: await lugares.crear(req.body), error: null }); } catch (err) { next(err); }
}

async function lugaresActualizar(req, res, next) {
  try { res.json({ data: await lugares.actualizar(Number(req.params.id), req.body), error: null }); } catch (err) { next(err); }
}

module.exports = {
  notasCredito,
  lugaresListar, lugaresCrear, lugaresActualizar,
  aplicarSaldoFavor,
  recibirAnticipo,
  analisis: analisisVista,
  registrar, iniciarSesion, perfil,
  listar, expediente, buscar, crearDesdeStaff, actualizar,
  abonar, ajustar, ajustarSaldoFavor, loQueLleva,
  ticketAbono, ticketAnticipo,
};
