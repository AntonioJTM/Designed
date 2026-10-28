'use strict';

/**
 * Lo que REGRESÓ con «Devolución» no cuenta como comprado en Clientes (2026-10-26,
 * auditoría): "Lo CANCELADO y lo DEVUELTO no cuenta en su historial ni en sus
 * totales". La devolución deja la venta como estaba, así que se resta aquí:
 *   · el dinero, con lo que se le dejó a favor por esa venta (con IVA, como `total`);
 *   · los kilos, de la línea de donde salieron (lo mismo que Reportes → Venta por
 *     color, `reportes/model.js → KG_NETO`).
 * Ejemplo: 10 kg de ROJO 2/30 por $1,000 y regresa 4 kg: cuenta 6 kg y $600.
 */
const regresoDinero = (pedido) => `(SELECT COALESCE(SUM(dd.importe), 0) FROM devoluciones dv
  JOIN devolucion_detalle dd ON dd.devolucion_id = dv.id WHERE dv.pedido_id = ${pedido}.id)`;

const regresoKg = (detalle) => `(SELECT COALESCE(SUM(dd.cantidad), 0) FROM devolucion_detalle dd
  WHERE dd.detalle_id = ${detalle}.id)`;

module.exports = { regresoDinero, regresoKg };
