'use strict';

const model = require('./model');
const jornada = require('./jornada');
const comisiones = require('./comisiones');
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

  // Sin comisión, el porcentaje se guarda en 0 para que el recibo no mienta. Lo que
  // no viene se queda como estaba (2026-10-26: `{activo:false}` dejaba el sueldo en $0).
  const pagaComision = datos.paga_comision ?? !!Number(empleado.paga_comision ?? 0);
  const yaEstaba = !!Number(empleado.en_nomina);
  const guardado = await model.guardarEmpleado(usuarioId, {
    sueldo_base_semanal: datos.sueldo_base_semanal ?? Number(empleado.sueldo_base_semanal ?? 0),
    paga_comision: pagaComision,
    porcentaje_comision: pagaComision ? (datos.porcentaje_comision ?? Number(empleado.porcentaje_comision ?? 0)) : 0,
    valor_hora_extra: datos.valor_hora_extra ?? Number(empleado.valor_hora_extra ?? 0),
    fecha_ingreso: datos.fecha_ingreso !== undefined ? datos.fecha_ingreso : (empleado.fecha_ingreso ?? null),
    comida_min: comidaMin,
    activo: datos.activo ?? (yaEstaba ? !!Number(empleado.activo) : true),
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

/**
 * Las REGLAS de unas vacaciones (2026-10-06; separadas el 2026-10-19 para
 * revisarlas también al PEDIRLAS en "Mis vacaciones"): en la nómina, con fecha de
 * ingreso y horario, fechas en orden, días de trabajo, el primer año cumplido,
 * los días que le quedan del año donde EMPIEZAN y ninguna semana ya pagada.
 * `propias`: los mensajes le hablan a quien las pide ("te quedan…").
 */
async function revisarVacaciones(usuarioId, datos, { propias = false } = {}) {
  const t = (deOtro, suyas) => (propias ? suyas : deOtro);
  const emp = await model.obtenerEmpleado(usuarioId);
  if (!emp) throw new AppError(404, 'NO_ENCONTRADO', 'Usuario no encontrado');
  if (!emp.en_nomina) {
    throw new AppError(422, 'NO_EN_NOMINA',
      t('Primero dalo de alta en la nómina.', 'Todavía no estás en la nómina: pídele al administrador que te dé de alta.'));
  }
  if (!emp.fecha_ingreso) {
    throw new AppError(422, 'SIN_FECHA_INGRESO', t(
      'Captura primero su fecha de ingreso: con ella se cuentan los días que le tocan.',
      'Falta tu fecha de ingreso en la nómina (con ella se cuentan tus días): pídesela al administrador.'));
  }
  if (!emp.horario.length) {
    throw new AppError(422, 'SIN_HORARIO', t(
      'Captura primero su horario: con él se cuentan los días de vacaciones (sus descansos no cuentan).',
      'Falta tu horario en la nómina (con él se cuentan tus días; tus descansos no cuentan): pídeselo al administrador.'));
  }
  const { fecha_inicio: desde, fecha_fin: hasta } = datos;
  if (hasta < desde) {
    throw new AppError(422, 'RANGO_INVALIDO', 'La fecha final va después de la inicial.');
  }
  if (desde < emp.fecha_ingreso) {
    throw new AppError(422, 'ANTES_DE_INGRESO', t('Esas fechas son de antes de que entrara a trabajar.', 'Esas fechas son de antes de que entraras a trabajar.'));
  }
  const dias = jornada.diasHabilesEnRango(emp.horario, desde, hasta);
  if (dias <= 0) {
    throw new AppError(422, 'SIN_DIAS_HABILES', t(
      'En esas fechas no le toca trabajar: no gastan días de vacaciones.',
      'En esas fechas no te toca trabajar: no gastan días de vacaciones.'));
  }

  // El saldo es del año de vacaciones donde EMPIEZAN.
  const registros = await model.listarVacaciones(usuarioId);
  const saldo = jornada.saldoVacaciones(emp.fecha_ingreso, desde, registros);
  if (saldo.anios < 1) {
    throw new AppError(422, 'SIN_ANTIGUEDAD', t(
      `Todavía no cumple su primer año: lo cumple el ${_dma(saldo.proximo_aniversario)} y desde entonces le tocan ${saldo.dias_proximo_anio} días.`,
      `Todavía no cumples tu primer año: lo cumples el ${_dma(saldo.proximo_aniversario)} y desde entonces te tocan ${saldo.dias_proximo_anio} días.`));
  }
  if (dias > saldo.restan) {
    const anio = `del ${_dma(saldo.desde)} al ${_dma(jornada.sumarDias(saldo.hasta, -1))}`;
    throw new AppError(422, 'VACACIONES_INSUFICIENTES', t(
      `En su año ${anio} le tocan ${saldo.corresponden} días y ya tomó ${saldo.tomados}: le quedan ${saldo.restan}, y estas fechas son ${dias} días de trabajo.`,
      `En tu año ${anio} te tocan ${saldo.corresponden} días y ya tomaste ${saldo.tomados}: te quedan ${saldo.restan}, y estas fechas son ${dias} días de trabajo.`));
  }

  // Una semana ya pagada no se mueve: esos días ya se pagaron como trabajados.
  const pagadas = (await model.periodosEnRango(desde, hasta)).filter((p) => p.estado === 'pagado');
  if (pagadas.length) {
    throw new AppError(409, 'SEMANA_PAGADA',
      `La nómina de la semana del ${_dma(pagadas[0].fecha_inicio)} al ${_dma(pagadas[0].fecha_fin)} ya se pagó: ` +
      'no se le pueden agregar vacaciones.');
  }
  // Encimadas con unas ya registradas (al registrarlas se vuelve a revisar, con candado).
  const encimada = registros.find((r) => r.fecha_inicio <= hasta && r.fecha_fin >= desde);
  if (encimada) {
    throw new AppError(409, 'VACACIONES_ENCIMADAS', t(
      `Esas fechas se enciman con sus vacaciones del ${_dma(encimada.fecha_inicio)} al ${_dma(encimada.fecha_fin)}.`,
      `Esas fechas se enciman con tus vacaciones del ${_dma(encimada.fecha_inicio)} al ${_dma(encimada.fecha_fin)}.`));
  }
  return { emp, dias, saldo };
}

/**
 * NADIE se registra (ni se quita) sus propias vacaciones desde la nómina: se
 * piden en "Mis vacaciones" y las autoriza otro (2026-10-19). El administrador
 * sí: es el dueño.
 */
function exigirQueNoSeanSuyas(usuarioId, yo, esAdmin) {
  if (!esAdmin && yo != null && Number(usuarioId) === Number(yo)) {
    throw new AppError(403, 'SON_TUS_VACACIONES', 'Tus vacaciones se piden en «Mis vacaciones»: las autoriza alguien más.');
  }
}

async function registrarVacaciones(usuarioId, datos, creadoPor, opciones = {}) {
  const { dias, emp } = await revisarVacaciones(usuarioId, datos, opciones);
  await model.crearVacaciones({
    usuario_id: usuarioId,
    fecha_inicio: datos.fecha_inicio,
    fecha_fin: datos.fecha_fin,
    dias,
    notas: datos.notas || null,
    creado_por: creadoPor,
  }, async (conn) => {
    const saldo = jornada.saldoVacaciones(emp.fecha_ingreso, datos.fecha_inicio, await model.listarVacaciones(usuarioId, conn));
    if (dias > saldo.restan) {
      throw new AppError(422, 'VACACIONES_INSUFICIENTES',
        `Le quedan ${saldo.restan} días de vacaciones de ese año y estas fechas son ${dias}: mientras tanto se registraron otras.`);
    }
  });
  return vacacionesDe(usuarioId);
}

/** Para decirlo en palabras: su nombre, cuántos días de trabajo son y cuántos le quedan de su año. */
async function resumenVacaciones(usuarioId, datos) {
  const emp = await model.obtenerEmpleado(usuarioId);
  if (!emp) return { nombre: 'el empleado', dias: 0, restan: 0 };
  const dias = jornada.diasHabilesEnRango(emp.horario, datos.fecha_inicio, datos.fecha_fin);
  const saldo = emp.fecha_ingreso
    ? jornada.saldoVacaciones(emp.fecha_ingreso, datos.fecha_inicio, await model.listarVacaciones(usuarioId))
    : null;
  return { nombre: emp.nombre, dias, restan: saldo?.restan ?? 0 };
}

/**
 * "MIS VACACIONES" (2026-10-19): lo de esta persona —cuántas le tocan por ley,
 * cuántas tomó, las que le quedan, su horario— y lo que ha pedido (esperando,
 * aprobadas o no). Quien no está en la nómina solo ve eso.
 */
async function misVacaciones(usuarioId) {
  const emp = await model.obtenerEmpleado(usuarioId);
  if (!emp) throw new AppError(404, 'NO_ENCONTRADO', 'Usuario no encontrado');
  const pedidas = await require('../autorizaciones/model').vacacionesPedidas(usuarioId);
  if (!emp.en_nomina) return { en_nomina: false, nombre: emp.nombre, pedidas };
  return { en_nomina: true, ...(await vacacionesDe(usuarioId)), hoy: hoyLocal(), pedidas };
}

async function eliminarVacaciones(id, { yo = null, esAdmin = true } = {}) {
  const v = await model.obtenerVacaciones(id);
  if (!v) throw new AppError(404, 'NO_ENCONTRADO', 'Vacaciones no encontradas');
  exigirQueNoSeanSuyas(v.usuario_id, yo, esAdmin);
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
  // Una CANCELADA no se paga directo (2026-10-20, auditoría): mientras estuvo
  // cancelada, sus ventas pudieron entrar en otra semana y pagarse dos veces.
  // Primero vuelve a borrador, donde se recalcula sola.
  if (periodo.estado === 'cancelado' && estado === 'pagado') {
    throw new AppError(409, 'NOMINA_CANCELADA',
      'Esa nómina está cancelada: primero regrésala a borrador (se vuelve a calcular) y revísala antes de pagarla.');
  }
  if (estado === 'pagado') {
    const recibos = await model.listarRecibos(id);
    if (recibos.length === 0) {
      throw new AppError(422, 'SIN_RECIBOS',
        'Calcula la nómina antes de marcarla como pagada');
    }
    // Con ventas o personal que cambiaron desde que se calculó, no se paga (2026-10-26).
    await exigirAlDia(id);
  }
  let cambiado = await model.cambiarEstadoPeriodo(id, estado);
  // De cancelada a borrador se RECALCULA: sus ventas se vuelven a repartir sin
  // tomar las que ya entraron en otra semana (2026-10-20).
  if (periodo.estado === 'cancelado' && estado === 'borrador') {
    try {
      await model.calcularPeriodo(id);
      cambiado = await model.obtenerPeriodo(id);
    } catch {
      /* sin personal en la nómina: queda en borrador y se calcula a mano */
    }
  }
  // Si alguien había pedido que se pague y ya se pagó o se canceló, esa
  // solicitud ya no tiene caso (fase 3).
  if (estado !== 'borrador') {
    await require('../autorizaciones/model').cerrarPendientesDeRuta('pagar_nomina', `/nomina/periodos/${id}/estado`,
      estado === 'pagado' ? 'La nómina ya se pagó.' : 'La nómina se canceló.').catch(() => {});
  }
  return _conRecibos(cambiado);
}

/**
 * El reporte de comisiones de la semana: qué venta paga cada quien en esta
 * nómina y qué tiene todavía por liquidar (comisiones.js → reporte).
 */
async function comisionesDelPeriodo(id, usuarioId = null) {
  const periodo = await model.obtenerPeriodo(id);
  if (!periodo) throw new AppError(404, 'NO_ENCONTRADO', 'Periodo de nómina no encontrado');
  return { periodo, ...(await comisiones.reporte(periodo, { usuarioId })) };
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

  // Las HORAS EXTRA van por día, con su hora real y al doble (`/horas-extra`):
  // este camino viejo las pagaba sin el doble y sin revisar el día (2026-10-26, auditoría).
  if (datos.clave === 'horas_extra') {
    throw new AppError(422, 'HORAS_EXTRA_POR_DIA',
      'Las horas extra se capturan por día, con la hora real de salida o de entrada: se pagan al doble.');
  }
  const importe = datos.importe;
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
  // Si alguien ya pidió que se pague y espera autorización (fase 3, 2026-10-19).
  let pago_pedido = periodo.estado === 'borrador'
    ? await require('../autorizaciones/model').esperandoDe('pagar_nomina', `/nomina/periodos/${periodo.id}/estado`).catch(() => null)
    : null;
  // Si la nómina CAMBIÓ desde que se pidió (se recalculó, una falta, unas horas
  // extra), esa solicitud ya no sirve: se cierra con el porqué y se puede volver
  // a pedir (2026-10-20, auditoría: se quedaba "Ya se pidió" para siempre).
  if (pago_pedido?.estado === 'pendiente') {
    try {
      const autModel = require('../autorizaciones/model');
      const { OPERACIONES } = require('../autorizaciones/operaciones');
      const porque = await OPERACIONES.pagar_nomina.revisarAntes(null, await autModel.contextoDe(pago_pedido.id));
      if (porque) {
        await autModel.cerrarPorCambio(pago_pedido.id, porque);
        pago_pedido = null;
      }
    } catch {
      /* si no se puede revisar, se enseña como estaba */
    }
  }
  // Ventas que cambiaron desde que se calculó: la pantalla pide recalcularla (2026-10-26).
  const por_recalcular = periodo.estado === 'borrador' ? await model.porRecalcular(periodo.id).catch(() => null) : null;
  return { ...periodo, recibos, total_nomina, pago_pedido, por_recalcular };
}

/**
 * NO SE PAGA UNA NÓMINA QUE YA NO CUADRA (2026-10-26, decisión del usuario: "no dejar
 * pagarla hasta recalcular"): si desde que se calculó entraron o salieron ventas de su
 * comisión, o cambió su personal, 409 `NOMINA_POR_RECALCULAR`. Lo usan el pago y la
 * solicitud de pago (así se autoriza lo que de verdad se va a pagar).
 */
async function exigirAlDia(periodoId) {
  const r = await model.porRecalcular(periodoId);
  if (!r) return;
  const partes = [];
  const grupo = (que, uno, varios) => {
    const l = r.nuevas.filter((v) => (v.que ?? 'entra') === que);
    if (l.length) {
      partes.push(`${l.length} ${l.length === 1 ? uno : varios} ` +
        `(${l.slice(0, 3).map((v) => v.numero_pedido).join(', ')}${l.length > 3 ? '…' : ''})`);
    }
  };
  grupo('entra', 'venta entra', 'ventas entran');
  grupo('cambia', 'venta cambió', 'ventas cambiaron');
  grupo('descuento', 'descuento entra', 'descuentos entran');
  if (r.quitadas.length) {
    partes.push(`${r.quitadas.length} ${r.quitadas.length === 1 ? 'venta sale' : 'ventas salen'} ` +
      `(${r.quitadas.slice(0, 3).map((v) => v.numero_pedido).join(', ')}${r.quitadas.length > 3 ? '…' : ''})`);
  }
  if (r.personal) partes.push('cambió el personal de la nómina');
  throw new AppError(409, 'NOMINA_POR_RECALCULAR',
    `Desde que se calculó, ${partes.join(' y ')}. Vuelve a calcularla («Volver a calcular») antes de pagarla.`, r);
}

module.exports = {
  exigirAlDia,
  semanaDe,
  listarEmpleados,
  guardarEmpleado,
  vacacionesDe,
  registrarVacaciones,
  exigirQueNoSeanSuyas,
  revisarVacaciones,
  resumenVacaciones,
  misVacaciones,
  eliminarVacaciones,
  fijarDiasTrabajados,
  agregarHorasExtra,
  periodoDeLaSemana,
  crearPeriodo,
  listarPeriodos,
  obtenerPeriodo,
  calcular,
  cambiarEstado,
  comisionesDelPeriodo,
  agregarConcepto,
  eliminarConcepto,
};
