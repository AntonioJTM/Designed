'use strict';

const service = require('./service');
const reporte = require('./reporte');
const pdf = require('../../utils/pdf');
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

// ---- Vacaciones ----

async function vacacionesDe(req, res, next) {
  try {
    const data = await service.vacacionesDe(Number(req.params.usuarioId));
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function registrarVacaciones(req, res, next) {
  try {
    const data = await service.registrarVacaciones(Number(req.params.usuarioId), req.body, req.auth.sub);
    return res.status(201).json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function eliminarVacaciones(req, res, next) {
  try {
    const data = await service.eliminarVacaciones(Number(req.params.id));
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

async function comisiones(req, res, next) {
  try {
    const data = await service.comisionesDelPeriodo(
      Number(req.params.id),
      req.query.usuario_id ? Number(req.query.usuario_id) : null
    );
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

/** La nómina de la semana en PDF (o solo el recibo de una persona). */
async function pdfNomina(req, res, next) {
  try {
    const { buffer, nombre } = await reporte.pdfNomina(Number(req.params.id), {
      usuarioId: req.query.usuario_id ? Number(req.query.usuario_id) : null,
    });
    pdf.enviar(res, buffer, nombre);
  } catch (err) {
    next(err);
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

async function fijarDiasTrabajados(req, res, next) {
  try {
    const data = await service.fijarDiasTrabajados(Number(req.params.id), Number(req.body.dias_trabajados));
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function agregarHorasExtra(req, res, next) {
  try {
    const data = await service.agregarHorasExtra(Number(req.params.id), req.body);
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
  vacacionesDe,
  registrarVacaciones,
  eliminarVacaciones,
  fijarDiasTrabajados,
  agregarHorasExtra,
  periodoActual,
  crearPeriodo,
  listarPeriodos,
  calcular,
  cambiarEstado,
  comisiones,
  pdf: pdfNomina,
  agregarConcepto,
  eliminarConcepto,
};
