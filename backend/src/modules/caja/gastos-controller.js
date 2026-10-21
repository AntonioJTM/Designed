'use strict';

const express = require('express');
const gastos = require('./gastos');
const permisos = require('../permisos/service');
const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');

/**
 * GASTOS DE LA CAJA (2026-10-20): las rutas. Cada quien, sus tiendas: los
 * gastos de otra tienda no se ven ni se tocan (404, como si no existieran).
 */

async function _turnoDeSusTiendas(auth, sesionId) {
  const almacenes = await permisos.almacenesDe(auth);
  if (almacenes === null) return;
  const [[s]] = await pool.query(
    'SELECT c.almacen_id FROM sesiones_caja s JOIN cajas c ON c.id = s.caja_id WHERE s.id = :id',
    { id: Number(sesionId) }
  );
  if (s) permisos.exigirAlmacen(almacenes, s.almacen_id, 'Ese turno');
}

async function _gastoDeSusTiendas(auth, id) {
  const almacenes = await permisos.almacenesDe(auth);
  if (almacenes === null) return;
  const alm = await gastos.almacenDe(Number(id));
  if (alm != null) permisos.exigirAlmacen(almacenes, alm, 'Ese gasto');
}

const ok = (res, data, status = 200) => res.status(status).json({ data, error: null });

async function listarTipos(req, res, next) {
  try {
    // Los desactivados solo los ve quien los administra.
    const todos = req.query.todos === '1' && (await permisos.puede(req.auth, 'hacer:tipos_gasto'));
    ok(res, await gastos.listarTipos({ todos }));
  } catch (err) { next(err); }
}

/**
 * Dar de alta un tipo (2026-10-20): directo, quien tiene «Tipos de gasto» y ve
 * TODAS las tiendas (los tipos son de todas); el cajero lo PIDE y entra cuando
 * lo aceptan, con el límite que le puso quien autoriza (`tipo_gasto`).
 */
async function crearTipo(req, res, next) {
  try {
    if (!req.autorizado && (await permisos.almacenesDe(req.auth)) !== null) {
      throw new AppError(403, 'SOLO_TODAS_LAS_TIENDAS',
        'Los tipos de gasto son de todas las tiendas: los da de alta quien las ve todas.');
    }
    ok(res, await gastos.crearTipo(req.body), 201);
  } catch (err) { next(err); }
}

async function actualizarTipo(req, res, next) {
  try { ok(res, await gastos.actualizarTipo(Number(req.params.id), req.body)); } catch (err) { next(err); }
}

async function registrar(req, res, next) {
  try {
    await _turnoDeSusTiendas(req.auth, req.params.id);
    ok(res, await gastos.registrar(Number(req.params.id), req.body, {
      usuarioId: req.auth.sub,
      // Si se autorizaba: la autorización con que se hizo (la pidió y se aceptó,
      // o la autorizaron ahí mismo con su clave).
      autorizacionId: req.autorizado?.id ?? null,
      // Lo registra sin pedir quien vino autorizado o quien autoriza.
      puedeSinAutorizar: !!req.autorizado || (await permisos.puede(req.auth, 'hacer:gasto_sobre_limite')),
    }), 201);
  } catch (err) { next(err); }
}

async function listar(req, res, next) {
  try {
    const almacenes = await permisos.almacenesDe(req.auth);
    // Una tienda o un turno de la consulta, de SUS tiendas (404 si no).
    if (req.query.almacen_id) permisos.exigirAlmacen(almacenes, req.query.almacen_id, 'Esa tienda');
    if (req.query.sesion_caja_id) await _turnoDeSusTiendas(req.auth, req.query.sesion_caja_id);
    ok(res, await gastos.listar(req.query, permisos.filtroAlmacen('c.almacen_id', almacenes)));
  } catch (err) { next(err); }
}

/**
 * La FOTO de un gasto: subirla la primera vez, cualquiera que registra gastos en
 * esa tienda; CAMBIARLA o QUITARLA, quien registró el gasto mientras su turno
 * siga abierto, y después solo quien saca efectivo (que no se borre la prueba
 * de un gasto ya cortado o autorizado). A un gasto cancelado no se le sube nada.
 */
async function _exigirPuedeFoto(req, cambia) {
  const g = await gastos.obtener(Number(req.params.id));
  if (!g) throw new AppError(404, 'NO_ENCONTRADO', 'Ese gasto no existe.');
  if (g.estado === 'cancelado') throw new AppError(409, 'GASTO_CANCELADO', 'Ese gasto está cancelado.');
  if (!cambia && !g.con_comprobante) return;
  const suyo = Number(g.usuario_id) === Number(req.auth.sub) && g.turno_estado === 'abierta';
  if (suyo || (await permisos.puede(req.auth, 'hacer:mover_efectivo'))) return;
  throw new AppError(403, 'SOLO_QUIEN_LO_REGISTRO',
    'La foto del ticket la cambia quien registró el gasto mientras su turno siga abierto; después, quien puede sacar efectivo.');
}

async function cancelar(req, res, next) {
  try {
    await _gastoDeSusTiendas(req.auth, req.params.id);
    ok(res, await gastos.cancelar(Number(req.params.id), req.body.motivo, req.auth.sub));
  } catch (err) { next(err); }
}

/** La foto llega en CRUDO (como el comprobante de un pago); el nombre, en una cabecera. */
const fotoEnCrudo = express.raw({ type: () => true, limit: '8mb' });

async function subirComprobante(req, res, next) {
  try {
    await _gastoDeSusTiendas(req.auth, req.params.id);
    await _exigirPuedeFoto(req, false);
    const nombre = decodeURIComponent(req.get('X-Nombre-Archivo') || '') || 'ticket';
    ok(res, await gastos.guardarComprobante(Number(req.params.id), req.body, nombre), 201);
  } catch (err) { next(err); }
}

/** Por endpoint AUTENTICADO, nunca estático: un ticket no se ve con solo adivinar la dirección. */
async function verComprobante(req, res, next) {
  try {
    await _gastoDeSusTiendas(req.auth, req.params.id);
    const c = await gastos.leerComprobante(Number(req.params.id));
    res.setHeader('Content-Type', c.tipo || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(c.nombre || 'ticket')}"`);
    res.send(c.buf);
  } catch (err) { next(err); }
}

async function quitarComprobante(req, res, next) {
  try {
    await _gastoDeSusTiendas(req.auth, req.params.id);
    await _exigirPuedeFoto(req, true);
    ok(res, await gastos.quitarComprobante(Number(req.params.id)));
  } catch (err) { next(err); }
}

module.exports = {
  listarTipos, crearTipo, actualizarTipo, registrar, listar, cancelar,
  fotoEnCrudo, subirComprobante, verComprobante, quitarComprobante,
};
