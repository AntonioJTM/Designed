'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');
const { paginado } = require('../../utils/query');
const { hoyLocal } = require('../../utils/fechas');

// Reglas de negocio de la nómina semanal.
// La semana de nómina va de DOMINGO a SÁBADO y se paga ese mismo sábado.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** El tipo (percepción/deducción) se deduce de la clave del concepto. */
const TIPO_POR_CLAVE = {
  horas_extra: 'percepcion',
  falta: 'deduccion',
  descuento: 'deduccion',
};

/**
 * Devuelve la semana de nómina que contiene `fechaStr` (por defecto, hoy):
 * domingo de inicio, sábado de fin y fecha de pago (el mismo sábado).
 */
function semanaDe(fechaStr) {
  const base = (fechaStr || hoyLocal()).slice(0, 10);
  const d = new Date(`${base}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(422, 'FECHA_INVALIDA', `Fecha inválida: ${fechaStr}`);
  }
  // getUTCDay(): 0 = domingo. Retrocede al domingo de esa semana.
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  const inicio = d.toISOString().slice(0, 10);

  const f = new Date(d);
  f.setUTCDate(f.getUTCDate() + 6);
  const fin = f.toISOString().slice(0, 10);

  return { fecha_inicio: inicio, fecha_fin: fin, fecha_pago: fin };
}

// ---- Configuración del personal ----

async function listarEmpleados(soloNomina) {
  return model.listarEmpleados({ soloNomina });
}

async function guardarEmpleado(usuarioId, datos) {
  const empleado = await model.obtenerEmpleado(usuarioId);
  if (!empleado) throw new AppError(404, 'NO_ENCONTRADO', 'Usuario no encontrado');

  // Sin comisión, el porcentaje se guarda en 0 para que el recibo no mienta.
  const pagaComision = datos.paga_comision ?? false;
  return model.guardarEmpleado(usuarioId, {
    sueldo_base_semanal: datos.sueldo_base_semanal ?? 0,
    paga_comision: pagaComision,
    porcentaje_comision: pagaComision ? (datos.porcentaje_comision ?? 0) : 0,
    valor_hora_extra: datos.valor_hora_extra ?? 0,
    activo: datos.activo ?? true,
  });
}

// ---- Periodos ----

/**
 * Periodo de la semana que contiene `fecha`. Si aún no existe devuelve
 * `periodo: null` junto con el rango, para que el panel ofrezca crearlo.
 */
async function periodoDeLaSemana(fecha) {
  const semana = semanaDe(fecha);
  const periodo = await model.obtenerPeriodoPorInicio(semana.fecha_inicio);
  return { semana, periodo: periodo ? await _conRecibos(periodo) : null };
}

async function crearPeriodo(fecha, notas, usuarioId) {
  const semana = semanaDe(fecha);
  const existente = await model.obtenerPeriodoPorInicio(semana.fecha_inicio);
  if (existente) {
    throw new AppError(409, 'PERIODO_DUPLICADO',
      `Ya existe la nómina de la semana del ${semana.fecha_inicio} al ${semana.fecha_fin}`);
  }
  const periodo = await model.crearPeriodo({ ...semana, notas }, usuarioId);
  return _conRecibos(periodo);
}

async function listarPeriodos(filtros) {
  const { rows, total } = await model.listarPeriodos(filtros);
  return paginado(rows, total, filtros.page, filtros.limit);
}

async function obtenerPeriodo(id) {
  const periodo = await model.obtenerPeriodo(id);
  if (!periodo) throw new AppError(404, 'NO_ENCONTRADO', 'Periodo de nómina no encontrado');
  return _conRecibos(periodo);
}

async function calcular(id) {
  await model.calcularPeriodo(id);
  return obtenerPeriodo(id);
}

async function cambiarEstado(id, estado) {
  const periodo = await model.obtenerPeriodo(id);
  if (!periodo) throw new AppError(404, 'NO_ENCONTRADO', 'Periodo de nómina no encontrado');
  if (periodo.estado === estado) return _conRecibos(periodo);

  // Un periodo pagado es definitivo: solo puede cancelarse, nunca reabrirse.
  if (periodo.estado === 'pagado' && estado === 'borrador') {
    throw new AppError(409, 'PERIODO_PAGADO',
      'Un periodo ya pagado no se puede regresar a borrador');
  }
  if (estado === 'pagado') {
    const recibos = await model.listarRecibos(id);
    if (recibos.length === 0) {
      throw new AppError(422, 'SIN_RECIBOS',
        'Calcula la nómina antes de marcarla como pagada');
    }
  }
  return _conRecibos(await model.cambiarEstadoPeriodo(id, estado));
}

async function ventasDelPeriodo(id, usuarioId) {
  const pedidos = await model.ventasDelPeriodo(id, usuarioId);
  const venta_neta = round2(pedidos.reduce((s, p) => s + Number(p.venta_neta), 0));
  return { pedidos, venta_neta, num_pedidos: pedidos.length };
}

// ---- Conceptos manuales ----

async function agregarConcepto(reciboId, datos) {
  const recibo = await model.obtenerRecibo(reciboId);
  if (!recibo) throw new AppError(404, 'NO_ENCONTRADO', 'Recibo de nómina no encontrado');

  const tipo = TIPO_POR_CLAVE[datos.clave] ?? datos.tipo;
  if (!tipo) {
    throw new AppError(422, 'TIPO_REQUERIDO',
      "Indica si el concepto 'otro' es 'percepcion' o 'deduccion'");
  }

  // Horas extra: si no se envía el importe, se calcula con el valor de hora
  // configurado para ese empleado.
  let importe = datos.importe;
  if (importe === undefined && datos.clave === 'horas_extra') {
    const empleado = await model.obtenerEmpleado(recibo.usuario_id);
    const valorHora = Number(empleado?.valor_hora_extra ?? 0);
    if (!valorHora) {
      throw new AppError(422, 'SIN_VALOR_HORA',
        'Este empleado no tiene valor de hora extra configurado; captura el importe a mano');
    }
    importe = round2(valorHora * Number(datos.cantidad ?? 0));
  }
  if (importe === undefined) {
    throw new AppError(422, 'IMPORTE_REQUERIDO', 'Falta el importe del concepto');
  }
  if (importe <= 0) {
    throw new AppError(422, 'IMPORTE_INVALIDO', 'El importe debe ser mayor a cero');
  }

  await model.agregarConcepto(reciboId, {
    tipo,
    clave: datos.clave,
    descripcion: datos.descripcion,
    cantidad: datos.cantidad,
    importe: round2(importe),
  });
  return obtenerPeriodo(recibo.periodo_id);
}

async function eliminarConcepto(conceptoId) {
  const reciboId = await model.eliminarConcepto(conceptoId);
  const recibo = await model.obtenerRecibo(reciboId);
  return obtenerPeriodo(recibo.periodo_id);
}

// ---- Helpers ----

/** Adjunta los recibos (con sus conceptos) y el total de la nómina. */
async function _conRecibos(periodo) {
  const recibos = await model.listarRecibos(periodo.id);
  const total_nomina = round2(recibos.reduce((s, r) => s + Number(r.total_pagar), 0));
  return { ...periodo, recibos, total_nomina };
}

module.exports = {
  semanaDe,
  listarEmpleados,
  guardarEmpleado,
  periodoDeLaSemana,
  crearPeriodo,
  listarPeriodos,
  obtenerPeriodo,
  calcular,
  cambiarEstado,
  ventasDelPeriodo,
  agregarConcepto,
  eliminarConcepto,
};
