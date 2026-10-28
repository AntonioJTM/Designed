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
  // Sin decir nada, el plazo de la caja y la campana (DIAS_SIN_ABONAR).
  // `dias_aviso`: las que vencieron hace MÁS de esos días (sin decirlo, todas las vencidas).
  return model.cartera({ diasAviso: q.dias_aviso == null ? undefined : entero(q.dias_aviso, 0, 0, 3650) });
}

async function clientesEnfriados(q = {}) {
  return model.clientesEnfriados({
    dias: entero(q.dias, 60, 1, 3650),
    minCompras: entero(q.min_compras, 2, 1, 100),
    limite: entero(q.limite, 50, 1, 500),
  });
}

/** `conCosto: false` lo valora todo a precio de venta y no enseña el costo. */
async function hiloMuerto(q = {}, { conCosto = true } = {}) {
  return model.hiloMuerto({
    dias: entero(q.dias, 90, 1, 3650),
    limite: entero(q.limite, 50, 1, 500),
    conCosto,
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
/**
 * El tablero de un viaje. Sin «Ver costos» (`conCosto: false`) el hilo parado va a
 * precio de venta y el margen no se calcula (llega en null).
 */
async function tablero(q = {}, { conCosto = true } = {}) {
  // `dias` es de los clientes que dejaron de venir; el hilo parado lleva su
  // propio umbral (`dias_parado`). Compartían el parámetro y mover "días sin
  // venir" en la pantalla cambiaba también qué hilo contaba como parado.
  const [cob, frios, muerto, marg, notas] = await Promise.all([
    cobranza(q), clientesEnfriados(q), hiloMuerto({ ...q, dias: q.dias_parado }, { conCosto }),
    conCosto ? margen(q) : null, model.notasPendientes(),
  ]);
  // Lo que la tienda les guarda a sus clientes (2026-10-19): la cifra; quiénes
  // y desde cuándo, en Clientes › Cuánto debe. No es un costo: le llega a todo el
  // que abre el tablero (2026-10-26, antes solo a quien veía costos).
  const aFavor = await require('../clientes/saldo-favor').aFavorDeClientes();
  return {
    cobranza: cob, clientes_enfriados: frios, hilo_muerto: muerto, margen: marg,
    a_favor: { total: aFavor.total, num_clientes: aFavor.num_clientes },
    notas_pendientes: notas,
  };
}

module.exports = { cobranza, clientesEnfriados, hiloMuerto, margen, tablero };
