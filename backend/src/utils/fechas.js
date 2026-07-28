'use strict';

/**
 * Fecha de hoy en hora LOCAL, como 'YYYY-MM-DD'.
 *
 * No usar `new Date().toISOString().slice(0,10)`: eso da el día en UTC y en
 * México (UTC-6) a partir de las 18:00 ya devuelve el día siguiente, lo que
 * vaciaba el reporte de ventas del día y adelantaba la semana de nómina.
 */
function hoyLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = { hoyLocal };
