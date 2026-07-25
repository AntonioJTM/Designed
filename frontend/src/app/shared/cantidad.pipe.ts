import { Pipe, PipeTransform } from '@angular/core';

/**
 * Muestra una cantidad sin ceros de relleno a la derecha.
 *
 * Las cantidades son DECIMAL(12,3) y MySQL las devuelve siempre con tres
 * decimales, así que "350000.000" llenaba la pantalla de ruido. Aquí se
 * conservan solo los decimales que de verdad existen:
 *
 *   350000.000 → 350,000        2.500 → 2.5        1.250 → 1.25
 *
 * El separador de miles ayuda a leer cifras grandes de un golpe.
 */
@Pipe({ name: 'cantidad' })
export class CantidadPipe implements PipeTransform {
  transform(valor: string | number | null | undefined, unidad?: string): string {
    if (valor === null || valor === undefined || valor === '') return '—';
    const n = Number(valor);
    if (Number.isNaN(n)) return String(valor);

    // maximumFractionDigits recorta los ceros sobrantes por sí solo.
    const texto = n.toLocaleString('es-MX', { maximumFractionDigits: 3 });
    return unidad ? `${texto} ${unidad}` : texto;
  }
}
