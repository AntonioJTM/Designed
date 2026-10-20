import { HttpHeaders } from '@angular/common/http';

/**
 * Llave de un solo uso para una operación de dinero (la venta desde el
 * 2026-10-19; abonos, anticipos, pagos de nota, entregas y retiros desde el
 * 2026-10-20). `crypto.randomUUID` solo existe en páginas seguras (https); si
 * algún día la caja se abre por http, se arma igual con `getRandomValues`.
 */
export function nuevaClave(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * La cabecera con la llave (`X-Clave-Unica`): el servidor registra la operación
 * UNA vez y, si llega otra con la misma llave (doble clic, reintento), contesta
 * lo mismo sin registrar nada (`middlewares/una-vez.js`).
 */
export function conClave(clave?: string): { headers?: HttpHeaders } {
  return clave ? { headers: new HttpHeaders({ 'X-Clave-Unica': clave }) } : {};
}
