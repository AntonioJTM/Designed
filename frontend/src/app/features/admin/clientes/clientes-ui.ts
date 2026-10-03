import { EstadoRitmo, PeriodoClientes } from '../../../core/models/rediseno.models';

// Piezas comunes de la sección Clientes (las cinco pestañas y el expediente):
// cómo se nombra un periodo, cómo se pinta el ritmo de un cliente y cómo se
// leen las fechas. Van juntas para que las pestañas y el expediente digan lo
// mismo con las mismas palabras y los mismos colores.

/** Los periodos que acepta `GET /clientes/analisis/:vista?dias=`. */
export const PERIODOS: { dias: PeriodoClientes; etiqueta: string }[] = [
  { dias: 30, etiqueta: 'Últimos 30 días' },
  { dias: 90, etiqueta: 'Últimos 90 días' },
  { dias: 365, etiqueta: 'Último año' },
  { dias: 3650, etiqueta: 'Desde siempre' },
];

export function esPeriodo(n: number): n is PeriodoClientes {
  return PERIODOS.some((p) => p.dias === n);
}

/** "en 90 días", "en el último año", "desde siempre": para pegarlo a una frase. */
export function enPeriodo(dias: number): string {
  if (dias >= 3650) return 'desde siempre';
  if (dias === 365) return 'en el último año';
  return `en ${dias} días`;
}

/** "Contra los 90 días anteriores", "Contra el año anterior". */
export function contraAnterior(dias: number): string {
  if (dias === 365) return 'Contra el año anterior';
  return `Contra los ${dias} días anteriores`;
}

/**
 * Colores de la sección, tal como los trae el diseño aprobado. Las series de
 * gráfica (azul, naranja, aqua) y la rampa ordinal son las de la paleta
 * validada (`--viz-series-*`); el ámbar y el naranja oscuro son los puntos de
 * estado del diseño. No agregues otros a ojo.
 */
export const COLOR = {
  acento: '#2457C5',
  serie1: '#2a78d6',
  serie2: '#eb6834',
  serie3: '#1baf7a',
  ambar: '#E9A23B',
  alerta: '#C2410C',
  otros: '#a3a2a0',
  linea: '#c3c2b7',
  /** Rampa ordinal, de claro a oscuro: la antigüedad de una deuda, la frecuencia. */
  rampa: ['#86b6ef', '#3987e5', '#1c5cab', '#0d366b'],
  /** Tinta de alerta para un pie de cifra que preocupa ("lleva 24 sin venir"). */
  tintaAlerta: '#9A3412',
};

/**
 * Cómo va un cliente contra SU PROPIO ritmo. Es el mismo criterio que
 * `clientes/analisis.js → ritmos()`: 90 días sin venir es "dejó de venir"
 * pase lo que pase; sin ritmo (una sola compra) no se puede medir; más del
 * doble de su ritmo es que se está enfriando, y pasarlo sin llegar al doble es
 * que ya le toca.
 */
export const ESTADO_RITMO: Record<EstadoRitmo, { texto: string; pill: string; color: string; suave: string }> = {
  bien: { texto: 'Al corriente', pill: 'azul', color: COLOR.serie1, suave: '#BFD6F4' },
  toca: { texto: 'Ya le toca', pill: 'ambar', color: COLOR.ambar, suave: '#F6DDB0' },
  frio: { texto: 'Se está enfriando', pill: 'naranja', color: COLOR.alerta, suave: '#F3C7B1' },
  perdido: { texto: 'Dejó de venir', pill: 'gris', color: COLOR.otros, suave: '#E3E6EB' },
  una: { texto: 'Una sola compra', pill: 'gris', color: COLOR.otros, suave: '#E3E6EB' },
};

/** `null` = nunca ha comprado: no es lo mismo que llevar mucho sin volver. */
export function estadoRitmo(ritmo: number | null | undefined, diasSinVenir: number | null | undefined): EstadoRitmo | null {
  if (diasSinVenir === null || diasSinVenir === undefined) return null;
  if (diasSinVenir >= 90) return 'perdido';
  if (!ritmo) return 'una';
  const veces = Math.round((diasSinVenir / ritmo) * 10) / 10;
  if (veces > 2) return 'frio';
  if (veces >= 1) return 'toca';
  return 'bien';
}

// ------------------------------------------------------------------ cifras

/**
 * Pesos SIN centavos, para las cifras grandes y las etiquetas de barra
 * ("$20,328"). En las tablas, donde importa el centavo, va el pipe `dinero`.
 */
export function pesos(v: unknown): string {
  return Number(v ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
}

/** Kilos sin ceros de relleno, como el pipe `cantidad`, para armar frases. */
export function kilos(v: unknown): string {
  return `${Number(v ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`;
}

export function plural(n: number, uno: string, varios: string): string {
  return `${n.toLocaleString('es-MX')} ${n === 1 ? uno : varios}`;
}

/** "1 de cada 4": más fácil de leer que "26%". Por debajo del 10% va el porcentaje. */
export function unoDeCada(pct: number): string {
  if (pct >= 10 && pct <= 100) return `1 de cada ${Math.max(1, Math.round(100 / pct))}`;
  return `el ${pct}%`;
}

// ------------------------------------------------------------------ fechas

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
               'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Año, mes y día de lo que manda el backend ('2026-09-08' o '2026-09-08 11:59:39'). */
function partes(valor: string | null | undefined): [number, number, number] | null {
  if (!valor) return null;
  const [a, m, d] = String(valor).slice(0, 10).split('-').map(Number);
  if (!a || !m) return null;
  return [a, m, d || 1];
}

/** "8 sep"; con el año si no es este ("8 sep 2025"). */
export function fechaCorta(valor: string | null | undefined): string {
  const p = partes(valor);
  if (!p) return '—';
  const [a, m, d] = p;
  return `${d} ${MESES_CORTOS[m - 1]}${a !== new Date().getFullYear() ? ' ' + a : ''}`;
}

/** "8 de septiembre"; con el año si no es este. */
export function fechaLarga(valor: string | null | undefined): string {
  const p = partes(valor);
  if (!p) return '—';
  const [a, m, d] = p;
  return `${d} de ${MESES[m - 1]}${a !== new Date().getFullYear() ? ' de ' + a : ''}`;
}

/** "marzo de 2019". */
export function mesYAnio(valor: string | null | undefined): string {
  const p = partes(valor);
  return p ? `${MESES[p[1] - 1]} de ${p[0]}` : '—';
}

/** '2026-09' → "septiembre". */
export function nombreMes(ym: string): string {
  const m = Number(String(ym).slice(5, 7));
  return MESES[m - 1] ?? ym;
}

/** Los últimos `n` meses ('YYYY-MM'), del más viejo al actual, en hora local. */
export function ultimosMeses(n: number): string[] {
  const hoy = new Date();
  const lista: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    lista.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return lista;
}

/** Suma días a una fecha 'YYYY-MM-DD' y la devuelve igual, sin pasar por UTC. */
export function sumarDias(fecha: string, dias: number): string {
  const p = partes(fecha);
  if (!p) return fecha;
  const d = new Date(p[0], p[1] - 1, p[2] + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 11 → "11 a 12 h". */
export function horaRango(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—';
  return `${h} a ${h + 1} h`;
}

const DIAS_CORTOS: Record<string, string> = {
  lunes: 'Lun', martes: 'Mar', 'miércoles': 'Mié', jueves: 'Jue', viernes: 'Vie', 'sábado': 'Sáb', domingo: 'Dom',
};
export function diaCorto(dia: string): string {
  return DIAS_CORTOS[dia] ?? dia;
}

/** "sábado" → "sábados" (viene los sábados). */
export function diaEnPlural(dia: string | null | undefined): string {
  if (!dia) return '—';
  return dia.endsWith('s') ? dia : dia + 's';
}

export function capitalizar(s: string | null | undefined): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// ------------------------------------------------------------------ nombres

/** Palabras que no cuentan para las iniciales ("Tejidos DE la Esperanza"). */
const VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e']);

/**
 * Las iniciales del avatar. Salen del APODO si lo tiene, que es como la
 * tienda conoce al cliente ("Doña Chela" → DC), y si no del nombre.
 */
export function iniciales(nombre: string, apodo?: string | null): string {
  const base = (apodo || nombre || '?').trim();
  const palabras = base.split(/\s+/).filter((p) => p && !VACIAS.has(p.toLowerCase()));
  const letras = (palabras.length ? palabras : [base]).slice(0, 2).map((p) => p.charAt(0));
  return letras.join('').toUpperCase();
}
