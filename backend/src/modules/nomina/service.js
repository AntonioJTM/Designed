'use strict';

const model = require('./model');
const jornada = require('./jornada');
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

/**
 * Lo que sale del horario de cada quien, ya calculado para que la pantalla no
 * haga cuentas: días que trabaja, horas de su semana, lo que vale su día, su
 * hora y su hora extra (al doble), y su saldo de vacaciones de hoy.
 */
function _conJornada(emp, vacaciones = []) {
  const sueldo = Number(emp.sueldo_base_semanal);
  const horario = emp.horario ?? [];
  const hora = jornada.valorHora(sueldo, horario, emp.comida_min);
  return {
    ...emp,
    dias_laborales: jornada.diasLaborales(horario),
    horas_semana: jornada.round2(jornada.horasSemana(horario, emp.comida_min)),
    salario_diario: jornada.salarioDiario(sueldo, horario),
    valor_hora: hora,
    valor_hora_extra_calculado: hora === null ? null : jornada.round2(hora * jornada.FACTOR_HORA_EXTRA),
    vacaciones: jornada.saldoVacaciones(emp.fecha_ingreso, hoyLocal(), vacaciones),
  };
}

async function listarEmpleados(soloNomina) {
  const empleados = await model.listarEmpleados({ soloNomina });
  const vacaciones = await Promise.all(
    empleados.map((e) => (e.fecha_ingreso ? model.listarVacaciones(e.usuario_id) : []))
  );
  return empleados.map((e, i) => _conJornada(e, vacaciones[i]));
}

/** Revisa un horario: un renglón por día, salida después de la entrada y más que la comida. */
function _validarHorario(horario, comidaMin) {
  const vistos = new Set();
  for (const d of horario) {
    const nombre = jornada.DIAS[d.dia_semana];
    if (vistos.has(d.dia_semana)) {
      throw new AppError(422, 'HORARIO_INVALIDO', `El ${nombre} viene dos veces en el horario.`);
    }
    vistos.add(d.dia_semana);
    const e = jornada.minutos(d.hora_entrada);
    const s = jornada.minutos(d.hora_salida);
    if (e === null || s === null) {
      throw new AppError(422, 'HORARIO_INVALIDO', `La hora del ${nombre} no se entiende. Escríbela como 9:00.`);
    }
    if (s <= e) {
      throw new AppError(422, 'HORARIO_INVALIDO', `El ${nombre} la salida tiene que ser después de la entrada.`);
    }
    if (s - e <= Number(comidaMin || 0)) {
      throw new AppError(422, 'HORARIO_INVALIDO', `El ${nombre} la comida dura más que el turno.`);
    }
  }
}

async function guardarEmpleado(usuarioId, datos) {
  const empleado = await model.obtenerEmpleado(usuarioId);
  if (!empleado) throw new AppError(404, 'NO_ENCONTRADO', 'Usuario no encontrado');

  // Lo que no viene se queda como estaba (el botón "Sacar de la nómina" solo
  // manda lo de siempre y no debe borrar el horario ni la fecha de ingreso).
  const comidaMin = datos.comida_min ?? Number(empleado.comida_min ?? 0);
  if (datos.horario) _validarHorario(datos.horario, comidaMin);
  if (datos.fecha_ingreso && datos.fecha_ingreso > hoyLocal()) {
    throw new AppError(422, 'FECHA_INGRESO_FUTURA', 'La fecha de ingreso no puede ser después de hoy.');
  }

  // Sin comisión, el porcentaje se guarda en 0 para que el recibo no mienta.
  const pagaComision = datos.paga_comision ?? false;
  const guardado = await model.guardarEmpleado(usuarioId, {
    sueldo_base_semanal: datos.sueldo_base_semanal ?? 0,
    paga_comision: pagaComision,
    porcentaje_comision: pagaComision ? (datos.porcentaje_comision ?? 0) : 0,
    valor_hora_extra: datos.valor_hora_extra ?? Number(empleado.valor_hora_extra ?? 0),
    fecha_ingreso: datos.fecha_ingreso !== undefined ? datos.fecha_ingreso : (empleado.fecha_ingreso ?? null),
    comida_min: comidaMin,
    activo: datos.activo ?? true,
    ...(datos.horario ? { horario: datos.horario } : {}),
  });
  return _conJornada(guardado, guardado.fecha_ingreso ? await model.listarVacaciones(usuarioId) : []);
}

// ---- Vacaciones ----

/** Sus vacaciones: el saldo de su año vigente y cada registro. */
async function vacacionesDe(usuarioId) {
  const emp = await model.obtenerEmpleado(usuarioId);
  if (!emp) throw new AppError(404, 'NO_ENCONTRADO', 'Usuario no encontrado');
  const registros = await model.listarVacaciones(usuarioId);
  return {
    usuario_id: emp.usuario_id,
    nombre: emp.nombre,
    fecha_ingreso: emp.fecha_ingreso,
    horario: emp.horario,
    saldo: jornada.saldoVacaciones(emp.fecha_ingreso, hoyLocal(), registros),
    registros,
  };
}

const _dma = (iso) => iso.split('-').reverse().join('/');

async function registrarVacaciones(usuarioId, datos, creadoPor) {
  const emp = await model.obtenerEmpleado(usuarioId);
  if (!emp) throw new AppError(404, 'NO_ENCONTRADO', 'Usuario no encontrado');
  if (!emp.en_nomina) {
    throw new AppError(422, 'NO_EN_NOMINA', 'Primero dalo de alta en la nómina.');
  }
  if (!emp.fecha_ingreso) {
    throw new AppError(422, 'SIN_FECHA_INGRESO',
      'Captura primero su fecha de ingreso: con ella se cuentan los días que le tocan.');
  }
  if (!emp.horario.length) {
    throw new AppError(422, 'SIN_HORARIO',
      'Captura primero su horario: con él se cuentan los días de vacaciones (sus descansos no cuentan).');
  }
  const { fecha_inicio: desde, fecha_fin: hasta } = datos;
  if (hasta < desde) {
    throw new AppError(422, 'RANGO_INVALIDO', 'La fecha final va después de la inicial.');
  }
  if (desde < emp.fecha_ingreso) {
    throw new AppError(422, 'ANTES_DE_INGRESO', 'Esas fechas son de antes de que entrara a trabajar.');
  }
  const dias = jornada.diasHabilesEnRango(emp.horario, desde, hasta);
  if (dias <= 0) {
    throw new AppError(422, 'SIN_DIAS_HABILES', 'En esas fechas no le toca trabajar: no gastan días de vacaciones.');
  }

  // El saldo es del año de vacaciones donde EMPIEZAN.
  const registros = await model.listarVacaciones(usuarioId);
  const saldo = jornada.saldoVacaciones(emp.fecha_ingreso, desde, registros);
  if (saldo.anios < 1) {
    throw new AppError(422, 'SIN_ANTIGUEDAD',
      `Todavía no cumple su primer año: lo cumple el ${_dma(saldo.proximo_aniversario)} y desde entonces le tocan ${saldo.dias_proximo_anio} días.`);
  }
  if (dias > saldo.restan) {
    throw new AppError(422, 'VACACIONES_INSUFICIENTES',
      `En su año del ${_dma(saldo.desde)} al ${_dma(jornada.sumarDias(saldo.hasta, -1))} le tocan ${saldo.corresponden} días ` +
      `y ya tomó ${saldo.tomados}: le quedan ${saldo.restan}, y estas fechas son ${dias} días de trabajo.`);
  }

  // Una semana ya pagada no se mueve: esos días ya se pagaron como trabajados.
  const pagadas = (await model.periodosEnRango(desde, hasta)).filter((p) => p.estado === 'pagado');
  if (pagadas.length) {
    throw new AppError(409, 'SEMANA_PAGADA',
      `La nómina de la semana del ${_dma(pagadas[0].fecha_inicio)} al ${_dma(pagadas[0].fecha_fin)} ya se pagó: ` +
      'no se le pueden agregar vacaciones.');
  }

  await model.crearVacaciones({
    usuario_id: usuarioId,
    fecha_inicio: desde,
    fecha_fin: hasta,
    dias,
    notas: datos.notas || null,
    creado_por: creadoPor,
  });
  return vacacionesDe(usuarioId);
}

async function eliminarVacaciones(id) {
  const v = await model.obtenerVacaciones(id);
  if (!v) throw new AppError(404, 'NO_ENCONTRADO', 'Vacaciones no encontradas');
  const pagadas = (await model.periodosEnRango(v.fecha_inicio, v.fecha_fin)).filter((p) => p.estado === 'pagado');
  if (pagadas.length) {
    throw new AppError(409, 'SEMANA_PAGADA',
      `La nómina de la semana del ${_dma(pagadas[0].fecha_inicio)} al ${_dma(pagadas[0].fecha_fin)} ya se pagó con estas vacaciones: ya no se quitan.`);
  }
  await model.eliminarVacaciones(id);
  return vacacionesDe(v.usuario_id);
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

/** Días que trabajó de verdad en la semana; lo demás de su horario son faltas. */
async function fijarDiasTrabajados(reciboId, dias) {
  const periodoId = await model.fijarDiasTrabajados(reciboId, dias);
  return obtenerPeriodo(periodoId);
}

/**
 * Horas extra de un día, calculadas contra su horario de ESE día y pagadas al
 * doble de su hora (sueldo semanal ÷ horas de su semana).
 */
async function agregarHorasExtra(reciboId, datos) {
  const recibo = await model.obtenerRecibo(reciboId);
  if (!recibo) throw new AppError(404, 'NO_ENCONTRADO', 'Recibo de nómina no encontrado');
  const periodo = await model.obtenerPeriodo(recibo.periodo_id);
  if (datos.fecha < periodo.fecha_inicio || datos.fecha > periodo.fecha_fin) {
    throw new AppError(422, 'FECHA_FUERA_DE_SEMANA',
      `Ese día no es de esta semana (del ${_dma(periodo.fecha_inicio)} al ${_dma(periodo.fecha_fin)}).`);
  }
  const emp = await model.obtenerEmpleado(recibo.usuario_id);
  const valor = recibo.valor_hora !== null
    ? Number(recibo.valor_hora)
    : jornada.valorHora(emp.sueldo_base_semanal, emp.horario, emp.comida_min);
  if (!valor) {
    throw new AppError(422, 'SIN_HORARIO',
      'Este empleado no tiene horario: captúralo en Sueldos y comisiones para calcular sus horas extra.');
  }

  const dia = jornada.diaSemana(datos.fecha);
  const delDia = emp.horario.find((d) => d.dia_semana === dia) ?? null;
  const r = jornada.minutosExtra(delDia, datos.hora_entrada, datos.hora_salida);
  if (r.error) throw new AppError(422, 'HORA_INVALIDA', r.error);
  if (r.minutos <= 0) {
    throw new AppError(422, 'SIN_HORAS_EXTRA',
      `Su horario del ${jornada.DIAS[dia]} es de ${jornada.hhmm(jornada.minutos(delDia.hora_entrada))} a ` +
      `${jornada.hhmm(jornada.minutos(delDia.hora_salida))}: con esas horas no hay tiempo extra.`);
  }

  // Lo que se lee después en el recibo: qué día, qué hizo y contra qué horario.
  const partes = [];
  if (!delDia) {
    partes.push(`su descanso, de ${datos.hora_entrada} a ${datos.hora_salida}`);
  } else {
    if (datos.hora_entrada) partes.push(`entró ${datos.hora_entrada} (su entrada: ${delDia.hora_entrada})`);
    if (datos.hora_salida) partes.push(`salió ${datos.hora_salida} (su salida: ${delDia.hora_salida})`);
  }
  const nombreDia = jornada.DIAS[dia].charAt(0).toUpperCase() + jornada.DIAS[dia].slice(1);
  const descripcion = [`${nombreDia} ${_dma(datos.fecha).slice(0, 5)} · ${partes.join(', ')}`, datos.descripcion]
    .filter(Boolean).join(' · ');

  await model.agregarConcepto(reciboId, {
    tipo: 'percepcion',
    clave: 'horas_extra',
    descripcion: descripcion.slice(0, 200),
    cantidad: jornada.round2(r.minutos / 60),
    fecha: datos.fecha,
    hora_entrada: datos.hora_entrada || null,
    hora_salida: datos.hora_salida || null,
    importe: jornada.importeExtra(r.minutos, valor),
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
  vacacionesDe,
  registrarVacaciones,
  eliminarVacaciones,
  fijarDiasTrabajados,
  agregarHorasExtra,
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
