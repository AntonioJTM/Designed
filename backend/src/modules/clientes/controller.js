'use strict';

const service = require('./service');

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

module.exports = { registrar, iniciarSesion, perfil };
