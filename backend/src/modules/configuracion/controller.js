'use strict';

const service = require('./service');

async function publica(req, res, next) {
  try {
    res.json({ data: await service.publica(), error: null });
  } catch (err) { next(err); }
}

async function completa(req, res, next) {
  try {
    res.json({ data: await service.completa(), error: null });
  } catch (err) { next(err); }
}

async function guardar(req, res, next) {
  try {
    res.json({ data: await service.guardar(req.body), error: null });
  } catch (err) { next(err); }
}

// ---- Cuentas de banco ----

async function listarCuentas(req, res, next) {
  try {
    res.json({ data: await service.listarCuentas(), error: null });
  } catch (err) { next(err); }
}

async function crearCuenta(req, res, next) {
  try {
    res.status(201).json({ data: await service.crearCuenta(req.body), error: null });
  } catch (err) { next(err); }
}

async function actualizarCuenta(req, res, next) {
  try {
    res.json({ data: await service.actualizarCuenta(Number(req.params.id), req.body), error: null });
  } catch (err) { next(err); }
}

async function eliminarCuenta(req, res, next) {
  try {
    res.json({ data: await service.eliminarCuenta(Number(req.params.id)), error: null });
  } catch (err) { next(err); }
}

module.exports = {
  publica, completa, guardar,
  listarCuentas, crearCuenta, actualizarCuenta, eliminarCuenta,
};
