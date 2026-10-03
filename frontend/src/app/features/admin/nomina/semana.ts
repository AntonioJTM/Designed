/**
 * Cuentas y nombres de la semana de nómina, que va de DOMINGO a SÁBADO y se
 * paga ese mismo sábado. El backend es el que manda (ajusta cualquier fecha a
 * su domingo); esto solo arma las opciones del selector y los textos.
 *
 * Todo se hace sobre 'YYYY-MM-DD' en UTC a mediodía: con la hora local, un
 * cambio de horario o las 18:00 en México (UTC-6) movían el día.
 */

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function aFecha(iso: string): Date {
  return new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
}

function aIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** La fecha `n` días después (o antes, con `n` negativo). */
export function sumarDias(iso: string, n: number): string {
  const d = aFecha(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return aIso(d);
}

/** El domingo con el que arranca la semana de esa fecha. */
export function domingoDe(iso: string): string {
  const d = aFecha(iso);
  return sumarDias(iso, -d.getUTCDay());
}

/** "3 de octubre" (con el año solo si no es el de `hoy`). */
export function diaLargo(iso: string, hoy: string): string {
  const d = aFecha(iso);
  const anio = d.getUTCFullYear() !== aFecha(hoy).getUTCFullYear() ? ` de ${d.getUTCFullYear()}` : '';
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}${anio}`;
}

/** "26 sep": para una etiqueta corta. */
export function diaCorto(iso: string): string {
  const d = aFecha(iso);
  return `${d.getUTCDate()} ${MESES_CORTOS[d.getUTCMonth()]}`;
}

/**
 * "20 al 26 de septiembre" o, si cruza de mes, "27 de septiembre al 3 de
 * octubre". El año solo aparece cuando no es el actual.
 */
export function rangoLargo(inicio: string, fin: string, hoy: string): string {
  const a = aFecha(inicio);
  const b = aFecha(fin);
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${a.getUTCDate()} al ${diaLargo(fin, hoy)}`;
  }
  const anioA = a.getUTCFullYear() !== b.getUTCFullYear() ? ` de ${a.getUTCFullYear()}` : '';
  return `${a.getUTCDate()} de ${MESES[a.getUTCMonth()]}${anioA} al ${diaLargo(fin, hoy)}`;
}

/** "Semana del 27 sep al 3 oct", o "Semana del 13 al 19 sep" dentro del mismo mes. */
export function rangoCorto(inicio: string, fin: string, hoy: string): string {
  const a = aFecha(inicio);
  const b = aFecha(fin);
  const anio = b.getUTCFullYear() !== aFecha(hoy).getUTCFullYear() ? ` ${b.getUTCFullYear()}` : '';
  if (a.getUTCMonth() === b.getUTCMonth()) {
    return `Semana del ${a.getUTCDate()} al ${diaCorto(fin)}${anio}`;
  }
  return `Semana del ${diaCorto(inicio)} al ${diaCorto(fin)}${anio}`;
}
