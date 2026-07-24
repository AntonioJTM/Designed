'use strict';

const service = require('./service');
const { parseBool } = require('../../utils/query');

// Login y perfil (sesión propia).
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
    const usuario = await service.perfil(req.auth.sub);
    return res.status(200).json({ data: usuario, error: null });
  } catch (err) {
    return next(err);
  }
}

// Gestión de staff (solo administradores).
async function listar(req, res, next) {
  try {
    const data = await service.listarStaff({ q: req.query.q, activo: parseBool(req.query.activo) });
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function crear(req, res, next) {
  try {
    const data = await service.crearStaff(req.body);
    return res.status(201).json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function actualizar(req, res, next) {
  try {
    const data = await service.actualizarStaff(Number(req.params.id), req.body);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function roles(req, res, next) {
  try {
    return res.json({ data: await service.roles(), error: null });
  } catch (err) {
    return next(err);
  }
}

module.exports = { iniciarSesion, perfil, listar, crear, actualizar, roles };
