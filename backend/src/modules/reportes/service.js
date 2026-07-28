'use strict';

const model = require('./model');
const { hoyLocal } = require('../../utils/fechas');

/**
 * Normaliza el rango de fechas. Sin parámetros → el día de hoy.
 * Devuelve `desde` (YYYY-MM-DD 00:00:00) y `hastaExcl` (día siguiente al fin),
 * de modo que el filtro sea [desde, hastaExcl).
 */
function rango(desdeStr, hastaStr) {
  const hoy = hoyLocal();
  const desde = (desdeStr || hoy).slice(0, 10);
  const hasta = (hastaStr || desde).slice(0, 10);

  // hastaExcl = hasta + 1 día, para incluir todo el día final.
  const d = new Date(`${hasta}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const hastaExcl = d.toISOString().slice(0, 10);

  return { desde: `${desde} 00:00:00`, hastaExcl: `${hastaExcl} 00:00:00`, etiqueta: { desde, hasta } };
}

async function ventas(desdeStr, hastaStr) {
  const { desde, hastaExcl, etiqueta } = rango(desdeStr, hastaStr);
  const [resumen, porDia] = await Promise.all([
    model.ventasResumen(desde, hastaExcl),
    model.ventasPorDia(desde, hastaExcl),
  ]);
  return { rango: etiqueta, ...resumen, porDia };
}

async function masVendidos(limite) {
  return model.masVendidos(Math.min(100, Math.max(1, limite || 10)));
}

async function porReabastecer() {
  return model.porReabastecer();
}

async function cortesCaja(desdeStr, hastaStr) {
  const { desde, hastaExcl, etiqueta } = rango(desdeStr, hastaStr);
  const cortes = await model.cortesCaja(desde, hastaExcl);
  return { rango: etiqueta, cortes };
}

module.exports = { ventas, masVendidos, porReabastecer, cortesCaja };
