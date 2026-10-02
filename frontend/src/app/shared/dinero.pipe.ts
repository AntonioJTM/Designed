import { Pipe, PipeTransform } from '@angular/core';

/**
 * Pesos con separador de miles y dos decimales: "$12,450.00".
 *
 * MySQL devuelve el dinero como texto ("12450.00") y pintarlo con un `$` delante
 * dejaba cifras grandes difíciles de leer de un golpe. El signo va ANTES del
 * símbolo ("-$3,200.00", no "$-3,200.00"), que es como se lee un negativo.
 */
@Pipe({ name: 'dinero' })
export class DineroPipe implements PipeTransform {
  transform(valor: string | number | null | undefined): string {
    if (valor === null || valor === undefined || valor === '') return '—';
    const n = Number(valor);
    if (Number.isNaN(n)) return String(valor);
    return n.toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
