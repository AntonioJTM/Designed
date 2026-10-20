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
    const { esAdmin } = require('../permisos/service');
    service.exigirQueNoSeanSuyas(Number(req.params.usuarioId), req.auth.sub, await esAdmin(req.auth));
    const data = await service.registrarVacaciones(Number(req.params.usuarioId), req.body, req.auth.sub);
    return res.status(201).json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

// MIS VACACIONES (2026-10-19): las de quien tiene la sesión.
async function misVacaciones(req, res, next) {
  try {
    return res.json({ data: await require('./service').misVacaciones(req.auth.sub), error: null });
  } catch (err) {
    return next(err);
  }
}

/** Ya pasó por su candado: o se las autorizaron (al aceptarlas) o es el administrador. */
async function registrarMisVacaciones(req, res, next) {
  try {
    const data = await service.registrarVacaciones(req.auth.sub, req.body, req.auth.sub, { propias: true });
    return res.status(201).json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function eliminarVacaciones(req, res, next) {
  try {
    const { esAdmin } = require('../permisos/service');
    const data = await service.eliminarVacaciones(Number(req.params.id), { yo: req.auth.sub, esAdmin: await esAdmin(req.auth) });
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
    const id = Number(req.params.id);
    const { puede } = require('../permisos/service');
    const { AppError } = require('../../middlewares/error');
    // Cancelar una nómina YA PAGADA o sacar una de cancelada suelta o vuelve a
    // contar sus comisiones (se pagarían dos veces): solo quien paga la nómina
    // (fase 3, 2026-10-19). La pantalla solo cancela las de borrador.
    const actual = await require('./model').obtenerPeriodo(id);
    if (actual && (actual.estado === 'cancelado' || (actual.estado === 'pagado' && req.body.estado === 'cancelado'))
        && actual.estado !== req.body.estado && !(await puede(req.auth, 'hacer:pagar_nomina'))) {
      throw new AppError(403, 'SOLO_QUIEN_PAGA',
        'Cancelar una nómina ya pagada, o reabrir una cancelada, lo hace solo quien paga la nómina.');
    }
    // Pagarla con autorización: se paga lo que se autorizó. Se revisa otra vez
    // justo antes (pudo cambiar entre que se aceptó y que se hace).
    if (req.autorizado?.id && req.body.estado === 'pagado') {
      const ctx = await require('../autorizaciones/model').contextoDe(req.autorizado.id);
      const ahora = await require('../autorizaciones/operaciones').resumenNomina(id);
      if (ctx?.firma && ahora.firma !== ctx.firma) {
        throw new AppError(409, 'NOMINA_CAMBIO', 'La nómina cambió desde que se pidió: que se vuelva a pedir.');
      }
    }
    const data = await service.cambiarEstado(id, req.body.estado);
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
  misVacaciones,
  registrarMisVacaciones,
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
