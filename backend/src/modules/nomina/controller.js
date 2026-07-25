'use strict';

const service = require('./service');
const { parsePagination, parseBool } = require('../../utils/query');

// ---- Configuración del personal ----

async function listarEmpleados(req, res, next) {
  try {
    const data = await service.listarEmpleados(parseBool(req.query.solo_nomina) === true);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function guardarEmpleado(req, res, next) {
  try {
    const data = await service.guardarEmpleado(Number(req.params.usuarioId), req.body);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

// ---- Periodos ----

async function periodoActual(req, res, next) {
  try {
    const data = await service.periodoDeLaSemana(req.query.fecha);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function crearPeriodo(req, res, next) {
  try {
    const data = await service.crearPeriodo(req.body.fecha, req.body.notas, req.auth.sub);
    return res.status(201).json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function listarPeriodos(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listarPeriodos({ estado: req.query.estado, page, limit, offset });
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function obtenerPeriodo(req, res, next) {
  try {
    const data = await service.obtenerPeriodo(Number(req.params.id));
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function calcular(req, res, next) {
  try {
    const data = await service.calcular(Number(req.params.id));
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function cambiarEstado(req, res, next) {
  try {
    const data = await service.cambiarEstado(Number(req.params.id), req.body.estado);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function ventasDelPeriodo(req, res, next) {
  try {
    const data = await service.ventasDelPeriodo(
      Number(req.params.id),
      Number(req.query.usuario_id)
    );
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

// ---- Conceptos manuales ----

async function agregarConcepto(req, res, next) {
  try {
    const data = await service.agregarConcepto(Number(req.params.id), req.body);
    return res.status(201).json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function eliminarConcepto(req, res, next) {
  try {
    const data = await service.eliminarConcepto(Number(req.params.conceptoId));
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listarEmpleados,
  guardarEmpleado,
  periodoActual,
  crearPeriodo,
  listarPeriodos,
  obtenerPeriodo,
  calcular,
  cambiarEstado,
  ventasDelPeriodo,
  agregarConcepto,
  eliminarConcepto,
};
