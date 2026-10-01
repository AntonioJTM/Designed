'use strict';

/**
 * Reloj simulado para sembrar HISTORIA con los servicios reales.
 *
 * Los servicios fechan todo con NOW()/CURRENT_TIMESTAMP de MySQL y algunos
 * folios con Date.now(). Para que una venta "de julio" quede de julio sin
 * reescribir fechas a mano después —que es como se descuadra un kardex— se
 * mueve el reloj de los DOS lados:
 *
 *   · MySQL: `SET timestamp = <epoch>` en la conexión, cada vez que el pool la
 *     entrega (evento 'acquire'). Así NOW() y los DEFAULT CURRENT_TIMESTAMP
 *     devuelven el momento simulado, dentro y fuera de transacciones.
 *   · Node: se reemplaza `Date` por una subclase cuyo `new Date()` y
 *     `Date.now()` devuelven ese mismo momento.
 *
 * El servidor guarda la hora en UTC (`@@time_zone = SYSTEM`, sistema en UTC),
 * así que la "hora de pared" que se le da a `fijar` es la que queda escrita.
 */

const RealDate = Date;
let actualMs = null;

class RelojDate extends RealDate {
  constructor(...args) {
    if (args.length === 0 && actualMs != null) super(actualMs);
    else super(...args);
  }
  static now() {
    return actualMs ?? RealDate.now();
  }
}

let instalado = false;

function instalar(pool) {
  if (instalado) return;
  instalado = true;
  global.Date = RelojDate;
  // `pool.pool` es el pool de callbacks que hay debajo de mysql2/promise. El
  // SET se encola en la conexión ANTES que la consulta de quien la pidió.
  pool.pool.on('acquire', (conn) => {
    const ts = actualMs == null ? 'DEFAULT' : (actualMs / 1000).toFixed(3);
    conn.query(`SET timestamp = ${ts}`, () => {});
  });
}

/** Fija el reloj en 'YYYY-MM-DD HH:MM[:SS]' (hora que quedará escrita). */
function fijar(fechaHora) {
  const [f, h = '00:00:00'] = fechaHora.split(' ');
  const hms = h.length === 5 ? `${h}:00` : h;
  const ms = RealDate.parse(`${f}T${hms}Z`);
  if (Number.isNaN(ms)) throw new Error(`Fecha inválida para el reloj: ${fechaHora}`);
  actualMs = ms;
}

/** Vuelve al reloj real. */
function soltar() {
  actualMs = null;
}

/** 'YYYY-MM-DD' del momento simulado (o de hoy, en UTC, si no hay). */
function hoy() {
  return new RealDate(actualMs ?? RealDate.now()).toISOString().slice(0, 10);
}

module.exports = { instalar, fijar, soltar, hoy, RealDate };
