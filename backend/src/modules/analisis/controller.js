'use strict';

const service = require('./service');
const { puede } = require('../permisos/service');

/**
 * El tablero de un viaje.
 *
 * Hilo parado y margen EXPONEN COSTOS: lo que costó cada hilo y lo que deja.
 * La pantalla entera la abre quien tiene «Cómo va el negocio» (`ver:negocio`),
 * pero esas dos secciones solo van a quien además tiene «Ver costos y
 * márgenes» (`hacer:ver_costos`). Esconderlas en la pantalla no basta: el JSON
 * se puede leer en el navegador, así que a quien no tiene el permiso el margen
 * ni se le calcula y llega en `null`. Es la misma regla que aplica el asistente
 * con sus herramientas de costos.
 *
 * El hilo parado SÍ le llega, valorado a PRECIO DE VENTA, que no expone nada:
 * lo pidió el usuario el 2026-10-03, cuando la tienda dejó de llevar el costo
 * ("el hilo parado sí me sirve, calcúlalo con el precio de venta").
 */
async function tablero(req, res, next) {
  try {
    const q = req.query;
    if (await puede(req.auth, 'hacer:ver_costos')) {
      return res.json({ data: await service.tablero(q), error: null });
    }
    const [cobranza, clientesEnfriados, hiloMuerto] = await Promise.all([
      service.cobranza(q),
      service.clientesEnfriados(q),
      service.hiloMuerto({ ...q, dias: q.dias_parado }, { conCosto: false }),
    ]);
    res.json({
      data: { cobranza, clientes_enfriados: clientesEnfriados, hilo_muerto: hiloMuerto, margen: null },
      error: null,
    });
  } catch (err) { next(err); }
}

module.exports = { tablero };
