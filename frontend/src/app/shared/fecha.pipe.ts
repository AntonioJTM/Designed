import { Pipe, PipeTransform } from '@angular/core';

/**
 * Fecha legible a partir de lo que manda el backend.
 *
 * MySQL guarda hora local y el pool la devuelve tal cual
 * ('2026-07-25 11:59:39'), así que aquí NO se convierte de zona horaria: solo
 * se reacomoda para leerla.
 *
 *   2026-07-25 11:59:39  →  25/07/2026 11:59
 *   2026-07-25           →  25/07/2026
 *
 * Con `soloFecha` se omite la hora.
 */
@Pipe({ name: 'fecha' })
export class FechaPipe implements PipeTransform {
  transform(valor: string | null | undefined, soloFecha = false): string {
    if (!valor) return '—';

    // Tolera el formato ISO con T/Z por si algún endpoint aún lo devuelve.
    const limpio = String(valor).replace('T', ' ').replace('Z', '').trim();
    const [dia, hora] = limpio.split(' ');
    const partes = dia.split('-');
    if (partes.length !== 3) return String(valor);

    const [a, m, d] = partes;
    const fecha = `${d}/${m}/${a}`;
    if (soloFecha || !hora) return fecha;
    return `${fecha} ${hora.slice(0, 5)}`;
  }
}

/**
 * Fecha de hoy en hora LOCAL, como 'YYYY-MM-DD'.
 * No usar `toISOString()`: da el día en UTC y en México adelanta desde las 18:00.
 */
export function hoyLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
