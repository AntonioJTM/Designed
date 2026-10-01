'use strict';

const model = require('./model');

// Las cuatro preguntas del tablero. El service casi no añade lógica: son
// consultas de lectura y las reglas de negocio (qué cuenta como venta, cómo se
// mide la antigüedad) viven en el modelo, junto al SQL que las aplica.

/** Un entero dentro de un rango, o el valor por omisión. Filtra la basura de la query. */
function entero(valor, porOmision, min, max) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return porOmision;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

async function cobranza(q = {}) {
  return model.cartera({ diasAviso: entero(q.dias_aviso, 30, 1, 3650) });
}

async function clientesEnfriados(q = {}) {
  return model.clientesEnfriados({
    dias: entero(q.dias, 60, 1, 3650),
    minCompras: entero(q.min_compras, 2, 1, 100),
    limite: entero(q.limite, 50, 1, 500),
  });
}

async function hiloMuerto(q = {}) {
  return model.hiloMuerto({
    dias: entero(q.dias, 90, 1, 3650),
    limite: entero(q.limite, 50, 1, 500),
  });
}

async function margen(q = {}) {
  return model.margenPorHilo({
    desde: q.desde || undefined,
    hasta: q.hasta || undefined,
    limite: entero(q.limite, 50, 1, 500),
  });
}

/**
 * Todo junto, para pintar el tablero de un solo viaje. Las cuatro consultas son
 * independientes, así que van en paralelo: en serie, abrir el tablero costaría
 * la suma de las cuatro.
 */
async function tablero(q = {}) {
  const [cob, frios, muerto, marg] = await Promise.all([
    cobranza(q), clientesEnfriados(q), hiloMuerto(q), margen(q),
  ]);
  return { cobranza: cob, clientes_enfriados: frios, hilo_muerto: muerto, margen: marg };
}

module.exports = { cobranza, clientesEnfriados, hiloMuerto, margen, tablero };
