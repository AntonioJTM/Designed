'use strict';

const service = require('./service');
const tickets = require('./tickets');
const { parsePagination } = require('../../utils/query');
const { AppError } = require('../../middlewares/error');
const permisos = require('../permisos/service');
const { pool } = require('../../config/db');

/**
 * CADA QUIEN, SUS TIENDAS (2026-10-15): una venta de otra tienda no se ve ni se
 * toca (404, como si no existiera). Corre para TODA ruta con `:id` del personal
 * (`router.param` en routes.js): detalle, estado, devolución, abonos, entrega,
 * comprobante, ticket…
 */
async function deSusTiendas(req, res, next, id) {
  try {
    // Corre ANTES que las guardas de la ruta: el token se lee aquí mismo.
    const auth = req.auth ?? permisos.authOpcional(req);
    if (auth?.tipo !== 'usuario' || !(Number(id) > 0)) return next();
    const almacenes = await permisos.almacenesDe(auth);
    if (almacenes === null) return next();
    const [[p]] = await pool.query('SELECT almacen_id FROM pedidos WHERE id = :id', { id: Number(id) });
    if (p) permisos.exigirAlmacen(almacenes, p.almacen_id, 'Esa venta');
    return next();
  } catch (err) { return next(err); }
}

/** La caja con que se cobra tiene que ser de SUS tiendas. */
async function _cajaDeSusTiendas(auth, sesionId) {
  return permisos.exigirTurno(auth, sesionId);
}

/** La caja y el almacén de una venta del personal tienen que ser de SUS tiendas. */
async function _ventaDeSusTiendas(req) {
  if (req.auth?.tipo !== 'usuario') return;
  await _cajaDeSusTiendas(req.auth, req.body.sesion_caja_id);
  if (req.body.almacen_id != null) {
    permisos.exigirAlmacen(await permisos.almacenesDe(req.auth), req.body.almacen_id, 'Ese almacén');
  } else if (req.body.canal === 'tienda_linea' && !req.body.sesion_caja_id) {
    // Sin almacén, la venta en línea descuenta del marcado para la tienda en
    // línea: tiene que ser de SUS tiendas (2026-10-16).
    const id = await require('../almacenes/model').idTiendaLinea();
    if (id != null) permisos.exigirAlmacen(await permisos.almacenesDe(req.auth), id, 'Ese almacén');
  }
}

async function cotizar(req, res, next) {
  try {
    if (req.auth?.tipo === 'cliente') req.body.cliente_id = req.auth.sub;
    await _ventaDeSusTiendas(req);
    const data = await service.cotizar(req.body, { esCliente: req.auth?.tipo === 'cliente' });
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

async function crear(req, res, next) {
  try {
    // Fiar es un permiso del puesto: el botón se esconde, pero quien no lo tiene
    // tampoco puede mandarlo a mano.
    if (req.auth?.tipo === 'usuario' && Number(req.body.a_credito ?? 0) > 0
        && !(await permisos.puede(req.auth, 'hacer:fiar'))) {
      throw new AppError(403, 'SIN_PERMISO', 'Tu puesto no tiene permiso para «Fiar». Pídeselo al administrador.');
    }
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
    await _ventaDeSusTiendas(req);
    // El cliente no fija el costo de envío ni se declara pagado; lo resuelve
    // el backend. Ver `_cotizar` en el modelo.
    const esCliente = req.auth?.tipo === 'cliente';
    const data = await service.crear(req.body, usuarioId, { esCliente });
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
    // Las fechas llegan tecleadas en un <input type="date">: lo que no tenga
    // forma de fecha se ignora en vez de llegar a la consulta.
    const fecha = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    const data = await service.listar({
      canal: req.query.canal,
      estado: req.query.estado,
      cliente_id: req.query.cliente_id ? Number(req.query.cliente_id) : undefined,
      q: q || undefined,
      caja_id: Number(req.query.caja_id) > 0 ? Number(req.query.caja_id) : undefined,
      desde: fecha(req.query.desde),
      hasta: fecha(req.query.hasta),
      page, limit, offset,
      almacenes: await permisos.almacenesDe(req.auth),
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
    if (['cancelado', 'devuelto'].includes(req.body.estado)
        && !(await permisos.puede(req.auth, 'hacer:cancelar_venta'))) {
      throw new AppError(403, 'SIN_PERMISO',
        'Tu puesto no tiene permiso para «Cancelar o devolver una venta». Pídeselo al administrador.');
    }
    // El usuario queda en el kardex del movimiento que repone o vuelve a
    // descontar la mercancía.
    const data = await service.cambiarEstado(
      Number(req.params.id),
      req.body.estado,
      req.auth?.sub,
      req.body.devoluciones
    );
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

/**
 * Sube la captura. El cuerpo llega en CRUDO (express.raw), igual que la lista
 * de empaque de las remesas: el navegador manda el File tal cual y el nombre
 * viaja en una cabecera. Así no hace falta multipart ni una dependencia nueva.
 */
async function subirComprobante(req, res, next) {
  try {
    const nombre = decodeURIComponent(req.get('X-Nombre-Archivo') || '') || 'comprobante';
    const data = await service.guardarComprobante(
      Number(req.params.id), req.body, nombre, req.auth?.sub
    );
    res.status(201).json({ data, error: null });
  } catch (err) { next(err); }
}

/**
 * Devuelve el archivo. Va por endpoint AUTENTICADO y no por express.static a
 * propósito: un comprobante bancario no puede quedar accesible con solo
 * adivinar la URL.
 */
async function verComprobante(req, res, next) {
  try {
    const c = await service.leerComprobante(Number(req.params.id));
    res.setHeader('Content-Type', c.tipo || 'application/octet-stream');
    // `inline`: se ve en la pantalla. El nombre es el que traía cuando lo mandó
    // el cliente, por si lo guardan.
    res.setHeader('Content-Disposition',
      `inline; filename="${encodeURIComponent(c.nombre || 'comprobante')}"`);
    res.send(c.buf);
  } catch (err) { next(err); }
}

async function eliminarComprobante(req, res, next) {
  try {
    const data = await service.borrarComprobante(Number(req.params.id));
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

// --- Apartados ---

async function apartados(req, res, next) {
  try {
    res.json({ data: await service.apartados(req.query, await permisos.almacenesDe(req.auth)), error: null });
  } catch (err) { next(err); }
}

async function abonarApartado(req, res, next) {
  try {
    await _cajaDeSusTiendas(req.auth, req.body?.sesion_caja_id);
    const data = await service.abonarApartado(Number(req.params.id), req.body, req.auth?.sub);
    res.status(201).json({ data, error: null });
  } catch (err) { next(err); }
}

/** Los datos del ticket de un abono a una nota (al registrarlo o para reimprimirlo). */
async function ticketPago(req, res, next) {
  try {
    const data = await tickets.pagoDeNota(Number(req.params.id), Number(req.params.pagoId));
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

async function entregarApartado(req, res, next) {
  try {
    // Fiar lo que falta de un pedido al entregarlo es fiar: pide su permiso.
    if (Number(req.body?.a_credito ?? 0) > 0 && !(await permisos.puede(req.auth, 'hacer:fiar'))) {
      throw new AppError(403, 'SIN_PERMISO', 'Tu puesto no tiene permiso para «Fiar». Pídeselo al administrador.');
    }
    await _cajaDeSusTiendas(req.auth, req.body?.sesion_caja_id);
    const data = await service.entregarApartado(Number(req.params.id), req.auth?.sub, req.body ?? {});
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

async function modificarEncargo(req, res, next) {
  try {
    const data = await service.modificarEncargo(Number(req.params.id), req.body ?? {});
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

async function encargos(req, res, next) {
  try {
    res.json({ data: await service.encargos(req.query, await permisos.almacenesDe(req.auth)), error: null });
  } catch (err) { next(err); }
}

async function notasPendientes(req, res, next) {
  try {
    res.json({ data: await service.notasPendientes(req.query, await permisos.almacenesDe(req.auth)), error: null });
  } catch (err) { next(err); }
}

async function pasarACredito(req, res, next) {
  try {
    res.json({ data: await service.pasarACredito(Number(req.params.id), req.auth?.sub), error: null });
  } catch (err) { next(err); }
}

async function previaDevolucion(req, res, next) {
  try {
    const clienteId = Number(req.query.cliente_id) > 0 ? Number(req.query.cliente_id) : null;
    res.json({ data: await service.previaDevolucion(Number(req.params.id), clienteId), error: null });
  } catch (err) { next(err); }
}

async function devolver(req, res, next) {
  try {
    res.status(201).json({ data: await service.devolver(Number(req.params.id), req.body, req.auth?.sub), error: null });
  } catch (err) { next(err); }
}

async function resumen(req, res, next) {
  try {
    res.json({ data: await service.resumen(await permisos.almacenesDe(req.auth)), error: null });
  } catch (err) { next(err); }
}

module.exports = {
  deSusTiendas,
  resumen,
  crear, obtener, listar, misPedidos, cambiarEstado, cotizar,
  subirComprobante, verComprobante, eliminarComprobante,
  apartados, abonarApartado, entregarApartado, modificarEncargo, encargos, ticketPago,
  notasPendientes, pasarACredito, previaDevolucion, devolver,
};
