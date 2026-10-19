'use strict';

// LO QUE LA TIENDA LE GUARDA A SUS CLIENTES (2026-10-19): quién tiene saldo a
// favor, cuánto y DESDE CUÁNDO. Es dinero que ya entró (un anticipo) o
// mercancía que regresó, y se le debe en compras. Sin esta cuenta nadie veía
// que, por ejemplo, 3 clientes tenían $30,679.75 a favor.

const SIGNO = { devolucion: 1, anticipo: 1, uso: -1, aplicado: -1, reintegro: 1, ajuste: 1 };

/**
 * Con sus movimientos en orden ({ tipo, monto, dia }): cuánto tiene a favor,
 * desde qué día lo tiene (la última vez que pasó de cero a tener algo) y el día
 * de su último movimiento. `saldo` en 0 si no tiene nada.
 */
function aFavorDe(movs) {
  let saldo = 0;
  let desde = null;
  let ultimo = null;
  for (const m of movs) {
    const antes = saldo;
    saldo = Math.round((saldo + (SIGNO[m.tipo] ?? 0) * Number(m.monto)) * 100) / 100;
    if (antes <= 0.004 && saldo > 0.004) desde = m.dia;
    if (saldo <= 0.004) desde = null;
    ultimo = m.dia;
  }
  return saldo > 0.004 ? { saldo, desde, ultimo } : { saldo: 0, desde: null, ultimo };
}

module.exports = { aFavorDe, SIGNO };
