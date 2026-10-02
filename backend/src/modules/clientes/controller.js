'use strict';

const service = require('./service');
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
    res.json({ data: await service.expediente(Number(req.params.id)), error: null });
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

module.exports = {
  registrar, iniciarSesion, perfil,
  listar, expediente, buscar, crearDesdeStaff, actualizar,
  abonar, ajustar,
};
