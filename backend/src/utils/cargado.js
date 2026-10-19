'use strict';

/**
 * Lo que un hilo o una presentación tiene CARGADO, dicho en palabras de tienda:
 * "3 cargas de mercancía, 80 bultos y 1,527.5 kg en existencia". Lo usan el
 * candado de borrar un producto (productos/service.js) y el de borrar una
 * presentación (variantes/service.js, 2026-10-16), para que digan lo mismo.
 *
 * `c` trae los conteos de `cargado()` (productos/model.js) o `cargada()`
 * (variantes/model.js): bultos, cargas, kg, saldos, movimientos, ventas,
 * traspasos, desarmes, compras y carritos.
 */
function motivosCarga(c) {
  const n = (x, uno, varios) => `${x.toLocaleString('en-US')} ${x === 1 ? uno : varios}`;
  const lista = [];
  if (c.cargas) lista.push(n(c.cargas, 'carga de mercancía', 'cargas de mercancía'));
  if (c.bultos) lista.push(n(c.bultos, 'bulto', 'bultos'));
  if (c.saldos) lista.push(`${Number(c.kg).toLocaleString('en-US', { maximumFractionDigits: 3 })} kg en existencia`);
  if (c.movimientos) lista.push(n(c.movimientos, 'movimiento en el kardex', 'movimientos en el kardex'));
  if (c.ventas) lista.push(n(c.ventas, 'venta', 'ventas'));
  if (c.traspasos) lista.push(n(c.traspasos, 'traspaso', 'traspasos'));
  if (c.desarmes) lista.push(n(c.desarmes, 'desarme a conos', 'desarmes a conos'));
  if (c.compras) lista.push(n(c.compras, 'orden de compra', 'órdenes de compra'));
  if (c.carritos) lista.push(n(c.carritos, 'carrito de la tienda en línea', 'carritos de la tienda en línea'));
  return lista;
}

/** "a, b y c". */
function enLista(xs) {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
}

module.exports = { motivosCarga, enLista };
