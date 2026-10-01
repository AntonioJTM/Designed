'use strict';

const { pool } = require('../../config/db');

// Configuración de la tienda: clave/valor. Son los pocos datos que el
// administrador tiene que poder cambiar sin tocar código —la tarifa de envío,
// los datos para depositar— y que el checkout necesita leer.
//
// `publica` marca las claves que puede leer un visitante sin sesión. Hoy todas
// lo son (nada sensible vive aquí), pero la bandera existe para que mañana
// agregar una clave interna no la filtre al catálogo por descuido.

const CAMPOS = 'clave, valor, descripcion, publica, actualizado_en';

/** Todas las claves, o solo las públicas. Devuelve filas. */
async function listar({ soloPublicas = false } = {}) {
  const [rows] = await pool.query(
    `SELECT ${CAMPOS} FROM configuracion ${soloPublicas ? 'WHERE publica = 1' : ''} ORDER BY clave`
  );
  return rows;
}

/** Las mismas claves, ya como objeto { clave: valor }. Es lo que consume la UI. */
async function mapa({ soloPublicas = false } = {}) {
  const rows = await listar({ soloPublicas });
  return Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
}

/** Valor de una clave, o null si no está capturada. */
async function valor(clave, ejecutor = pool) {
  const [rows] = await ejecutor.query(
    'SELECT valor FROM configuracion WHERE clave = :clave LIMIT 1',
    { clave }
  );
  return rows[0] ? rows[0].valor : null;
}

/**
 * Valor numérico de una clave. Una clave sin capturar o con basura vale
 * `respaldo`, no NaN: esto alimenta totales de dinero y un NaN los envenena.
 */
async function numero(clave, respaldo = 0, ejecutor = pool) {
  const v = await valor(clave, ejecutor);
  const n = Number(v);
  return v === null || v === '' || !Number.isFinite(n) ? respaldo : n;
}

/**
 * Guarda las claves recibidas. Solo escribe las que YA existen: la lista de
 * claves la define la migración, no el que llama, así que un typo en el panel
 * no crea una clave fantasma que nadie lee.
 * Devuelve cuántas se escribieron.
 */
async function guardar(cambios) {
  const claves = Object.keys(cambios);
  if (claves.length === 0) return 0;

  let escritas = 0;
  for (const clave of claves) {
    const v = cambios[clave];
    const [r] = await pool.query(
      'UPDATE configuracion SET valor = :valor WHERE clave = :clave',
      { clave, valor: v === '' ? null : v }
    );
    escritas += r.affectedRows;
  }
  return escritas;
}

/** Las claves que la migración dio de alta; sirve para validar la entrada. */
async function clavesValidas() {
  const [rows] = await pool.query('SELECT clave FROM configuracion');
  return rows.map((r) => r.clave);
}

module.exports = { listar, mapa, valor, numero, guardar, clavesValidas };
