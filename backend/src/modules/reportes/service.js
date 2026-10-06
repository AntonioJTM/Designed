'use strict';

const model = require('./model');
const { hoyLocal } = require('../../utils/fechas');
const { AppError } = require('../../middlewares/error');
const { armarVentaPorColor } = require('./venta-color');

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
  const [{ resumen, porCanal }, porDia] = await Promise.all([
    model.ventasResumen(desde, hastaExcl),
    model.ventasPorDia(desde, hastaExcl),
  ]);
  // Los kilos del periodo son la suma de los de cada día: la tienda piensa en
  // kilos ("cuánto hilo salió"), no solo en pesos.
  const suma = (campo) => Math.round(porDia.reduce((s, d) => s + Number(d[campo]), 0) * 1000) / 1000;
  return {
    rango: etiqueta,
    resumen: { ...resumen, kilos: suma('kilos'), kilos_paquete: suma('kilos_paquete') },
    porCanal,
    porDia,
  };
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

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Venta por color: cuántos kilos se vendieron de cada hilo en el rango, qué
 * parte son de lo vendido, cuánto se ha vendido desde siempre y cuánto queda.
 * Las cuentas viven en venta-color.js; qué cuenta como vendido, en el model.
 */
async function ventaPorColor(desdeStr, hastaStr, qStr) {
  // Una fecha mal escrita daría un 500 al armar el rango: mejor decirlo.
  for (const f of [desdeStr, hastaStr]) {
    if (f !== undefined && f !== '' && (!FECHA.test(String(f)) || Number.isNaN(Date.parse(`${f}T00:00:00Z`)))) {
      throw new AppError(422, 'VALIDACION', `Fecha inválida: "${f}" (se espera AAAA-MM-DD)`);
    }
  }
  const q = String(qStr ?? '').trim().slice(0, 100);
  const { desde, hastaExcl, etiqueta } = rango(desdeStr, hastaStr);
  // Un rango al revés se voltea en vez de regresar un reporte vacío.
  const r = etiqueta.desde > etiqueta.hasta ? rango(etiqueta.hasta, etiqueta.desde) : { desde, hastaExcl, etiqueta };
  const { filas, periodo } = await model.ventaPorColor(r.desde, r.hastaExcl, q);
  return armarVentaPorColor(filas, periodo, { rango: r.etiqueta, q });
}

module.exports = { ventas, masVendidos, porReabastecer, cortesCaja, ventaPorColor };
