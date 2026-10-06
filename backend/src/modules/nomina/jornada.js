'use strict';

// Cuentas de la jornada de un empleado: días que trabaja, lo que vale su día y
// su hora, sus horas extra y sus vacaciones. Son funciones puras —sin base—
// para poder probarlas solas (jornada.test.js). El frontend tiene su gemela
// en features/admin/nomina/jornada.ts para la vista previa: si cambia una
// regla aquí, cambia allá.
//
// Decisiones del usuario (2026-10-06):
//  · El día vale SUELDO SEMANAL ÷ DÍAS QUE TRABAJA según su horario.
//  · La hora vale SUELDO SEMANAL ÷ HORAS DE SU SEMANA (cada día con su horario,
//    menos la comida).
//  · La hora extra se paga al DOBLE, siempre.
//  · Las horas extra se cuentan contra su horario DE ESE DÍA: lo que salió
//    después de su salida y lo que entró antes de su entrada. En su día de
//    descanso, todo lo trabajado es extra.
//  · Vacaciones por ley (art. 76 LFT, reforma 2023), sin prima vacacional,
//    pagadas como días normales.

const FACTOR_HORA_EXTRA = 2;

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** 'HH:MM' o 'HH:MM:SS' → minutos desde la medianoche. `null` si no se entiende. */
function minutos(hora) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(hora ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Minutos → 'H:MM' (como lo escribe la gente: 9:00, 18:30). */
function hhmm(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Horas de trabajo de un día de su horario, ya sin la comida. */
function horasDelDia(dia, comidaMin = 0) {
  const e = minutos(dia.hora_entrada);
  const s = minutos(dia.hora_salida);
  if (e === null || s === null || s <= e) return 0;
  return Math.max(0, s - e - Number(comidaMin || 0)) / 60;
}

/** Días que trabaja a la semana: los que tienen horario. */
function diasLaborales(horario) {
  return new Set((horario ?? []).map((d) => Number(d.dia_semana))).size;
}

/** Horas de su semana, sumando cada día con su horario. */
function horasSemana(horario, comidaMin = 0) {
  return (horario ?? []).reduce((s, d) => s + horasDelDia(d, comidaMin), 0);
}

/** Lo que vale un día: sueldo semanal ÷ días que trabaja. `null` sin horario. */
function salarioDiario(sueldoSemanal, horario) {
  const dias = diasLaborales(horario);
  return dias > 0 ? round2(Number(sueldoSemanal) / dias) : null;
}

/** Lo que vale una hora normal: sueldo semanal ÷ horas de su semana. */
function valorHora(sueldoSemanal, horario, comidaMin = 0) {
  const horas = horasSemana(horario, comidaMin);
  return horas > 0 ? round2(Number(sueldoSemanal) / horas) : null;
}

/**
 * Lo que se paga por `dias` días. Se calcula sobre el sueldo y no sobre el
 * salario diario ya redondeado, para que 6 de 6 días den el sueldo EXACTO.
 */
function pagoPorDias(sueldoSemanal, horario, dias) {
  const laborales = diasLaborales(horario);
  if (!laborales) return 0;
  return round2((Number(sueldoSemanal) * Number(dias)) / laborales);
}

/**
 * Minutos extra de un día contra su horario de ese día.
 *  · Día que trabaja: lo que salió DESPUÉS de su salida + lo que entró ANTES
 *    de su entrada (llegar tarde o irse temprano no resta: eso es otra cosa).
 *  · Día de descanso (`diaHorario` null): todo lo trabajado; pide las dos horas.
 * Devuelve { minutos } o { error } con el motivo en palabras.
 */
function minutosExtra(diaHorario, entradaReal, salidaReal) {
  const e = entradaReal ? minutos(entradaReal) : null;
  const s = salidaReal ? minutos(salidaReal) : null;
  if (entradaReal && e === null) return { error: 'La hora de entrada no se entiende. Escríbela como 8:30.' };
  if (salidaReal && s === null) return { error: 'La hora de salida no se entiende. Escríbela como 20:00.' };
  if (e === null && s === null) return { error: 'Escribe a qué hora salió (o entró) ese día.' };

  if (!diaHorario) {
    if (e === null || s === null) {
      return { error: 'Ese día es su descanso: escribe a qué hora entró y a qué hora salió. Todo cuenta como extra.' };
    }
    if (s <= e) return { error: 'La salida tiene que ser después de la entrada.' };
    return { minutos: s - e };
  }

  const eh = minutos(diaHorario.hora_entrada);
  const sh = minutos(diaHorario.hora_salida);
  if (e !== null && s !== null && s <= e) return { error: 'La salida tiene que ser después de la entrada.' };
  const despues = s !== null ? Math.max(0, s - sh) : 0;
  const antes = e !== null ? Math.max(0, eh - e) : 0;
  return { minutos: despues + antes };
}

/** Lo que se paga por esos minutos extra: al doble de su hora. */
function importeExtra(minutosExtra, valorHoraNormal) {
  return round2((Number(minutosExtra) / 60) * Number(valorHoraNormal) * FACTOR_HORA_EXTRA);
}

// ---------------------------------------------------------------------------
// Fechas (siempre 'YYYY-MM-DD', en UTC para no pelear con el huso horario)
// ---------------------------------------------------------------------------

function _fecha(iso) {
  return new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
}
function _iso(d) {
  return d.toISOString().slice(0, 10);
}
function sumarDias(iso, n) {
  const d = _fecha(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return _iso(d);
}
/** 0 = domingo … 6 = sábado. */
function diaSemana(iso) {
  return _fecha(iso).getUTCDay();
}

/** Días de TRABAJO (según su horario) entre dos fechas, las dos incluidas. */
function diasHabilesEnRango(horario, desde, hasta) {
  const dias = new Set((horario ?? []).map((d) => Number(d.dia_semana)));
  if (!dias.size || desde > hasta) return 0;
  let n = 0;
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    if (dias.has(diaSemana(f))) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Vacaciones
// ---------------------------------------------------------------------------

/**
 * Días de vacaciones por año de servicio (art. 76 LFT desde 2023):
 * 12 el primer año y 2 más por año hasta 20 el quinto; del sexto en adelante,
 * 2 más cada 5 años (22, 24, 26…). Antes del primer año no hay.
 */
function diasVacacionesPorLey(anios) {
  const a = Math.floor(Number(anios));
  if (a < 1) return 0;
  if (a <= 5) return 10 + 2 * a;
  return 22 + 2 * Math.floor((a - 6) / 5);
}

/** El aniversario número `n` de la fecha de ingreso. */
function aniversario(ingreso, n) {
  const d = _fecha(ingreso);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return _iso(d);
}

/** Años cumplidos a la fecha `al`. */
function aniosCumplidos(ingreso, al) {
  if (!ingreso || al < ingreso) return 0;
  let n = 0;
  while (aniversario(ingreso, n + 1) <= al) n++;
  return n;
}

/**
 * El año de vacaciones que contiene la fecha `al`: del último aniversario al
 * siguiente (exclusivo). Los días que se ganan al cumplir el año se toman
 * dentro de ese mismo año.
 */
function periodoVacacional(ingreso, al) {
  const anios = aniosCumplidos(ingreso, al);
  return {
    anios,
    desde: aniversario(ingreso, anios),
    hasta: aniversario(ingreso, anios + 1),
    corresponden: diasVacacionesPorLey(anios),
  };
}

/**
 * Saldo de vacaciones a la fecha `al`: cuántos días le tocan en su año
 * vigente, cuántos lleva y cuántos le quedan. `registros` son sus vacaciones
 * ({ fecha_inicio, dias }); cuentan las que empiezan dentro del año vigente.
 */
function saldoVacaciones(ingreso, al, registros) {
  if (!ingreso) return null;
  const p = periodoVacacional(ingreso, al);
  const tomados = (registros ?? [])
    .filter((r) => String(r.fecha_inicio).slice(0, 10) >= p.desde && String(r.fecha_inicio).slice(0, 10) < p.hasta)
    .reduce((s, r) => s + Number(r.dias), 0);
  return {
    anios: p.anios,
    desde: p.desde,
    hasta: p.hasta,
    corresponden: p.corresponden,
    tomados,
    restan: Math.max(0, p.corresponden - tomados),
    proximo_aniversario: p.hasta,
    dias_proximo_anio: diasVacacionesPorLey(p.anios + 1),
  };
}

module.exports = {
  FACTOR_HORA_EXTRA,
  DIAS,
  round2,
  minutos,
  hhmm,
  horasDelDia,
  diasLaborales,
  horasSemana,
  salarioDiario,
  valorHora,
  pagoPorDias,
  minutosExtra,
  importeExtra,
  sumarDias,
  diaSemana,
  diasHabilesEnRango,
  diasVacacionesPorLey,
  aniversario,
  aniosCumplidos,
  periodoVacacional,
  saldoVacaciones,
};
