import { Pipe, PipeTransform } from '@angular/core';

/**
 * El folio CORTO para listas: "POS-1790864580000-79FA" → "POS-79FA".
 *
 * El folio se arma con la hora en milisegundos más cuatro letras al azar, y en
 * una tabla ocupaba tres renglones y empujaba las columnas fuera de la tarjeta.
 * Lo que una persona lee y dicta son las cuatro letras del final; el folio
 * COMPLETO sigue en el detalle del pedido, en el ticket y en el `title` de la
 * celda, y buscar "79FA" lo encuentra igual.
 */
export function folioCorto(folio: string | null | undefined): string {
  if (!folio) return '';
  return String(folio).replace(/^([A-Z]+)-\d{10,}-/, '$1-');
}

@Pipe({ name: 'folio' })
export class FolioPipe implements PipeTransform {
  transform(folio: string | null | undefined): string {
    return folioCorto(folio);
  }
}
