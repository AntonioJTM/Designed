'use strict';

const service = require('./service');
const permisos = require('../permisos/service');
const { pool } = require('../../config/db');

/**
 * CADA QUIEN, SUS TIENDAS (2026-10-15): solo las cajas de sus tiendas, y un
 * turno de otra tienda no se ve ni se toca (404, como si no existiera).
 */
async function _cajaDeSusTiendas(auth, cajaId) {
  const almacenes = await permisos.almacenesDe(auth);
  if (almacenes === null) return;
  const [[c]] = await pool.query('SELECT almacen_id FROM cajas WHERE id = :id', { id: Number(cajaId) });
  if (c) permisos.exigirAlmacen(almacenes, c.almacen_id, 'Esa caja');
}

async function _turnoDeSusTiendas(auth, sesionId) {
  const almacenes = await permisos.almacenesDe(auth);
  if (almacenes === null) return;
  const [[s]] = await pool.query(
    'SELECT c.almacen_id FROM sesiones_caja s JOIN cajas c ON c.id = s.caja_id WHERE s.id = :id',
    { id: Number(sesionId) }
  );
  if (s) permisos.exigirAlmacen(almacenes, s.almacen_id, 'Ese turno');
}

async function listarCajas(req, res, next) {
  try {
    const almacenes = await permisos.almacenesDe(req.auth);
    const cajas = (await service.listarCajas()).filter((c) => permisos.puedeAlmacen(almacenes, c.almacen_id));
    res.json({ data: cajas, error: null });
  } catch (err) { next(err); }
}

async function crearCaja(req, res, next) {
  try {
    res.status(201).json({ data: await service.crearCaja(req.body), error: null });
  } catch (err) { next(err); }
}

async function actualizarCaja(req, res, next) {
  try {
    res.json({ data: await service.actualizarCaja(Number(req.params.id), req.body), error: null });
  } catch (err) { next(err); }
}

async function eliminarCaja(req, res, next) {
  try {
    await service.eliminarCaja(Number(req.params.id));
    res.json({ data: { eliminado: true }, error: null });
  } catch (err) { next(err); }
}

async function abrirSesion(req, res, next) {
  try {
    await _cajaDeSusTiendas(req.auth, req.body.caja_id);
    res.status(201).json({ data: await service.abrirSesion(req.body, req.auth.sub), error: null });
  } catch (err) { next(err); }
}

async function sesionAbierta(req, res, next) {
  try {
    const caja_id = Number(req.query.caja_id);
    await _cajaDeSusTiendas(req.auth, caja_id);
    const data = await service.sesionAbierta(caja_id);
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

async function obtenerSesion(req, res, next) {
  try {
    await _turnoDeSusTiendas(req.auth, req.params.id);
    res.json({ data: await service.obtenerSesion(Number(req.params.id)), error: null });
  } catch (err) { next(err); }
}

async function registrarMovimiento(req, res, next) {
  try {
    await _turnoDeSusTiendas(req.auth, req.params.id);
    res.status(201).json({
      data: await service.registrarMovimiento(Number(req.params.id), req.body),
      error: null,
    });
  } catch (err) { next(err); }
}

async function cerrarSesion(req, res, next) {
  try {
    await _turnoDeSusTiendas(req.auth, req.params.id);
    res.json({ data: await service.cerrarSesion(Number(req.params.id), req.body), error: null });
  } catch (err) { next(err); }
}

module.exports = {
  listarCajas,
  crearCaja,
  actualizarCaja,
  eliminarCaja,
  abrirSesion,
  sesionAbierta,
  obtenerSesion,
  registrarMovimiento,
  cerrarSesion,
};
