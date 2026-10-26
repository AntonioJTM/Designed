import { EstadoPedido, NivelHistoria, SeMueve } from '../../../core/models/rotacion.models';

/**
 * ROTACIÓN DE INVENTARIO: lo que comparten sus pestañas. Solo kilos y toneladas
 * (de 1,000 kg para arriba, en las cifras grandes y los totales). Las fechas,
 * en palabras ("14 de enero").
 */

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "1,720 kg". */
export function kilos(kg: number | null | undefined, decimales = 0): string {
  if (kg == null) return '—';
  return `${Number(kg).toLocaleString('es-MX', { maximumFractionDigits: decimales })} kg`;
}

/** "31.3 t" de 1,000 kg para arriba (hasta 2 decimales, sin ceros de relleno); si no, "744 kg". */
export function toneladas(kg: number | null | undefined): string {
  if (kg == null) return '—';
  const n = Number(kg);
  if (Math.abs(n) >= 1000) return `${(Math.round((n / 1000) * 100) / 100).toLocaleString('es-MX', { maximumFractionDigits: 2 })} t`;
  return kilos(n);
}

/** "≈ 96 paquetes". */
export function paquetesAprox(n: number | null | undefined): string {
  if (n == null) return '';
  return `≈ ${Number(n).toLocaleString('es-MX')} ${n === 1 ? 'paquete' : 'paquetes'}`;
}

const aNum = (dia: string): number => {
  const [a, m, d] = dia.slice(0, 10).split('-').map(Number);
  return Date.UTC(a, m - 1, d) / 86400000;
};
export const diasEntre = (a: string, b: string): number => aNum(b) - aNum(a);

/**
 * "14 de enero", o "11 de julio de 2027": el año solo cuando cae en otro año y a
 * más de seis meses de hoy (lo cercano se entiende sin año).
 */
export function fechaLarga(dia: string | null | undefined, hoy: string): string {
  if (!dia) return '—';
  const [a, m, d] = dia.slice(0, 10).split('-').map(Number);
  const lejos = Math.abs(diasEntre(hoy, dia)) > 183;
  return `${d} de ${MESES[m - 1]}${a !== Number(hoy.slice(0, 4)) && lejos ? ` de ${a}` : ''}`;
}

/** «Le alcanza hasta»: la fecha, "Febrero de 2030" si es muy lejos, o "Más de 5 años". */
export function alcanzaHasta(dia: string | null | undefined, hoy: string): string {
  if (!dia) return 'Más de 5 años';
  if (diasEntre(hoy, dia) > 730) {
    const [a, m] = dia.split('-').map(Number);
    return `${cap(MESES[m - 1])} de ${a}`;
  }
  return fechaLarga(dia, hoy);
}

/** Lo que va junto a «Pedir a más tardar»: "ya pasó", "hoy", "mañana", "en 7 días". */
export function cuandoPedir(pedir: string | null, hoy: string): string {
  if (!pedir) return '';
  const d = diasEntre(hoy, pedir);
  if (d < 0) return 'ya pasó';
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  if (d <= 7) return `en ${d} días`;
  return '';
}

/** "↑ 12% más", "↓ 2% menos", "igual". */
export function contraAnio(r: number | null | undefined): { texto: string; sube: boolean | null } {
  if (r == null) return { texto: '—', sube: null };
  const pct = Math.round((r - 1) * 100);
  if (pct === 0) return { texto: 'Igual', sube: null };
  return pct > 0 ? { texto: `↑ ${pct}% más`, sube: true } : { texto: `↓ ${-pct}% menos`, sube: false };
}

/** El estado de «Qué pedir», con su pareja de color. */
export function estadoTexto(e: EstadoPedido, pedir: string | null): { texto: string; pill: string } {
  switch (e) {
    case 'ya': return { texto: 'Pedir ya', pill: 'naranja' };
    case 'pronto': return { texto: pedir ? `En ${MESES[Number(pedir.slice(5, 7)) - 1]}` : 'Pronto', pill: 'ambar' };
    case 'calma': return { texto: 'Con calma', pill: 'gris' };
    case 'sobra': return { texto: 'Sobra', pill: 'azul' };
    case 'sin_ventas': return { texto: 'Sin ventas', pill: 'gris' };
    default: return { texto: 'Sin datos', pill: 'gris' };
  }
}

/** «Se mueve»: Rápido (azul informativa), Normal (neutra), Lento (ámbar). */
export function seMueveTexto(s: SeMueve | null | undefined): { texto: string; pill: string } | null {
  if (!s) return null;
  return s === 'rapido' ? { texto: 'Rápido', pill: 'azul' } : s === 'normal' ? { texto: 'Normal', pill: 'gris' } : { texto: 'Lento', pill: 'ambar' };
}

/** "9 semanas", "1 semana", "9.5 semanas". */
export function semanas(n: number | null | undefined): string {
  if (n == null) return '—';
  const v = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${v.toLocaleString('es-MX')} ${v === 1 ? 'semana' : 'semanas'}`;
}

/** "Hay ventas desde enero de 2025". */
export function mesAnio(dia: string | null | undefined): string {
  if (!dia) return '';
  const [a, m] = dia.split('-').map(Number);
  return `${MESES[m - 1]} de ${a}`;
}

/** Cuánta historia hay, en palabras ("un año y diez meses"). */
export function cuantoTiempo(dias: number): string {
  const meses = Math.floor(dias / 30.4);
  const anios = Math.floor(meses / 12);
  const resto = meses % 12;
  const NUM = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once'];
  const m = (n: number) => (n === 1 ? 'un mes' : `${NUM[n] ?? n} meses`);
  if (anios === 0) return meses ? m(meses) : `${Math.floor(dias / 7)} semanas`;
  const a = anios === 1 ? 'un año' : `${NUM[anios] ?? anios} años`;
  return resto ? `${a} y ${m(resto)}` : a;
}

/** ¿Ya se pueden calcular rotación y «Qué pedir»? (con 28 días de ventas). */
export const conCalculos = (n: NivelHistoria): boolean => n !== 'poca';
/** ¿Ya se ve la temporada? (con un año completo). */
export const conTemporada = (n: NivelHistoria): boolean => n === 'completa' || n === 'confiable';

/** Una celda de CSV (con comillas si lleva coma, comillas o salto). */
export function celdaCsv(v: unknown): string {
  // Un texto que empieza con = + - @ Excel lo tomaría como fórmula: va con ' delante.
  const s = v == null ? '' : typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Un CSV con BOM UTF-8: Excel lo abre directo. */
export function csv(filas: unknown[][]): Blob {
  return new Blob(['﻿' + filas.map((f) => f.map(celdaCsv).join(',')).join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}
