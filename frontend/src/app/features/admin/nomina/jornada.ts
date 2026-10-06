import { DiaHorario } from '../../../core/models/nomina.models';

/**
 * Las cuentas de la jornada, para la VISTA PREVIA mientras se captura (lo que
 * vale su día y su hora, cuántas horas extra van). El que manda es el backend
 * —`modules/nomina/jornada.js`, su gemelo—: si cambia una regla allá, cambia
 * aquí.
 *
 * Reglas del usuario (2026-10-06): el día vale sueldo semanal ÷ días que
 * trabaja; la hora, sueldo semanal ÷ horas de su semana; la hora extra se paga
 * al DOBLE y se cuenta contra su horario de ESE día.
 */

export const FACTOR_HORA_EXTRA = 2;

export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
/** El orden en que se capturan: la semana de trabajo empieza el lunes. */
export const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** 'HH:MM' → minutos desde la medianoche; null si no se entiende. */
export function minutos(hora: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(hora ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Minutos → '9:00', como lo escribe la gente. */
export function hhmm(min: number): string {
  return `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
}

/** "9:00 a 18:00" de un día de su horario. */
export function turno(d: DiaHorario): string {
  return `${hhmm(minutos(d.hora_entrada) ?? 0)} a ${hhmm(minutos(d.hora_salida) ?? 0)}`;
}

export function horasDelDia(d: DiaHorario, comidaMin = 0): number {
  const e = minutos(d.hora_entrada);
  const s = minutos(d.hora_salida);
  if (e === null || s === null || s <= e) return 0;
  return Math.max(0, s - e - (comidaMin || 0)) / 60;
}

export function diasLaborales(horario: DiaHorario[]): number {
  return new Set(horario.map((d) => d.dia_semana)).size;
}

export function horasSemana(horario: DiaHorario[], comidaMin = 0): number {
  return horario.reduce((s, d) => s + horasDelDia(d, comidaMin), 0);
}

export function salarioDiario(sueldo: number, horario: DiaHorario[]): number | null {
  const dias = diasLaborales(horario);
  return dias > 0 ? round2(sueldo / dias) : null;
}

export function valorHora(sueldo: number, horario: DiaHorario[], comidaMin = 0): number | null {
  const horas = horasSemana(horario, comidaMin);
  return horas > 0 ? round2(sueldo / horas) : null;
}

/** 0 = domingo … 6 = sábado, de una fecha 'YYYY-MM-DD'. */
export function diaSemana(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay();
}

/**
 * Minutos extra de un día contra su horario de ese día: lo que salió después de
 * su salida y lo que entró antes de su entrada. En su descanso, todo lo
 * trabajado (pide las dos horas). Devuelve { minutos } o { error }.
 */
export function minutosExtra(
  dia: DiaHorario | null,
  entrada: string | null | undefined,
  salida: string | null | undefined
): { minutos?: number; error?: string } {
  const e = entrada ? minutos(entrada) : null;
  const s = salida ? minutos(salida) : null;
  if (entrada && e === null) return { error: 'La hora de entrada no se entiende.' };
  if (salida && s === null) return { error: 'La hora de salida no se entiende.' };
  if (e === null && s === null) return { error: 'Escribe a qué hora salió (o entró) ese día.' };
  if (!dia) {
    if (e === null || s === null) {
      return { error: 'Es su descanso: escribe a qué hora entró y a qué hora salió.' };
    }
    return s > e ? { minutos: s - e } : { error: 'La salida tiene que ser después de la entrada.' };
  }
  if (e !== null && s !== null && s <= e) return { error: 'La salida tiene que ser después de la entrada.' };
  const despues = s !== null ? Math.max(0, s - (minutos(dia.hora_salida) ?? 0)) : 0;
  const antes = e !== null ? Math.max(0, (minutos(dia.hora_entrada) ?? 0) - e) : 0;
  return { minutos: despues + antes };
}

export function importeExtra(minutosExtra: number, valorHoraNormal: number): number {
  return round2((minutosExtra / 60) * valorHoraNormal * FACTOR_HORA_EXTRA);
}

/** "1.5 h", "2 h": las horas sin ceros de sobra. */
export function horasTexto(min: number): string {
  const h = round2(min / 60);
  return `${h.toLocaleString('es-MX', { maximumFractionDigits: 2 })} h`;
}

/** Días de TRABAJO (según su horario) entre dos fechas 'YYYY-MM-DD', las dos incluidas. */
export function diasHabilesEnRango(horario: DiaHorario[], desde: string, hasta: string): number {
  const dias = new Set(horario.map((d) => d.dia_semana));
  if (!dias.size || !desde || !hasta || desde > hasta) return 0;
  let n = 0;
  const d = new Date(`${desde}T12:00:00Z`);
  const fin = new Date(`${hasta}T12:00:00Z`);
  for (let i = 0; d <= fin && i < 400; i++) {
    if (dias.has(d.getUTCDay())) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}
