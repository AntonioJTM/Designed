'use strict';

const service = require('./service');

async function listarCajas(req, res, next) {
  try {
    res.json({ data: await service.listarCajas(), error: null });
  } catch (err) { next(err); }
}

async function crearCaja(req, res, next) {
  try {
    res.status(201).json({ data: await service.crearCaja(req.body), error: null });
  } catch (err) { next(err); }
}

async function abrirSesion(req, res, next) {
  try {
    res.status(201).json({ data: await service.abrirSesion(req.body, req.auth.sub), error: null });
  } catch (err) { next(err); }
}

async function sesionAbierta(req, res, next) {
  try {
    const caja_id = Number(req.query.caja_id);
    const data = await service.sesionAbierta(caja_id);
    res.json({ data, error: null });
  } catch (err) { next(err); }
}

async function obtenerSesion(req, res, next) {
  try {
    res.json({ data: await service.obtenerSesion(Number(req.params.id)), error: null });
  } catch (err) { next(err); }
}

async function registrarMovimiento(req, res, next) {
  try {
    res.status(201).json({
      data: await service.registrarMovimiento(Number(req.params.id), req.body),
      error: null,
    });
  } catch (err) { next(err); }
}

async function cerrarSesion(req, res, next) {
  try {
    res.json({ data: await service.cerrarSesion(Number(req.params.id), req.body), error: null });
  } catch (err) { next(err); }
}

module.exports = {
  listarCajas,
  crearCaja,
  abrirSesion,
  sesionAbierta,
  obtenerSesion,
  registrarMovimiento,
  cerrarSesion,
};
