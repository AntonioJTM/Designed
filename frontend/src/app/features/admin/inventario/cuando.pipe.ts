import { Pipe, PipeTransform } from '@angular/core';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Cuándo pasó algo, como se dice en la tienda: "hoy 13:42", "ayer 17:10",
 * "28 sep 11:30" y, si fue otro año, "28 sep 2025". Lo usan las pantallas de
 * mercancía (inventario, kardex, remesas y traspasos), donde la pregunta casi
 * siempre es "¿esto fue hoy o la semana pasada?" y "02/10/2026 13:42" obliga a
 * hacer la cuenta.
 *
 * Igual que el pipe `fecha`, NO convierte de zona horaria: MySQL guarda la hora
 * de pared y el pool la devuelve tal cual ('2026-10-02 13:42:10').
 *
 * Con `soloFecha` se omite la hora ("hoy", "28 sep").
 */
@Pipe({ name: 'cuando' })
export class CuandoPipe implements PipeTransform {
  transform(valor: string | null | undefined, soloFecha = false, ahora: Date = new Date()): string {
    if (!valor) return '—';
    const limpio = String(valor).replace('T', ' ').replace('Z', '').trim();
    const [dia, hora] = limpio.split(' ');
    const partes = dia.split('-').map(Number);
    if (partes.length !== 3 || partes.some((n) => Number.isNaN(n))) return String(valor);
    const [a, m, d] = partes;

    const hhmm = !soloFecha && hora ? ' ' + hora.slice(0, 5).replace(/^0/, '') : '';
    const fecha = new Date(a, m - 1, d);
    const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const dias = Math.round((hoy.getTime() - fecha.getTime()) / 86400000);

    if (dias === 0) return 'hoy' + hhmm;
    if (dias === 1) return 'ayer' + hhmm;
    if (a !== ahora.getFullYear()) return `${d} ${MESES[m - 1]} ${a}`;
    return `${d} ${MESES[m - 1]}${hhmm}`;
  }
}
