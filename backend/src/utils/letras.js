'use strict';

/**
 * Una cantidad de dinero con letra, como va en un recibo:
 *   1230.5 → "Mil doscientos treinta pesos 50/100 M.N."
 *
 * Solo enteros de hasta cientos de millones; los centavos van en número (xx/100),
 * que es como se escribe en México.
 */

const UNIDADES = [
  '', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis',
  'veintisiete', 'veintiocho', 'veintinueve',
];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos',
  'setecientos', 'ochocientos', 'novecientos'];

function decenas(n) {
  if (n < 30) return UNIDADES[n];
  const u = n % 10;
  return DECENAS[Math.floor(n / 10)] + (u ? ' y ' + UNIDADES[u] : '');
}

function centenas(n) {
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const r = n % 100;
  return [CENTENAS[c], r ? decenas(r) : ''].filter(Boolean).join(' ');
}

/** "uno" se acorta antes de un sustantivo: "un mil"… "veintiún mil", "treinta y un pesos". */
function apocope(texto) {
  return texto.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');
}

function miles(n) {
  const m = Math.floor(n / 1000);
  const r = n % 1000;
  const cabeza = m === 0 ? '' : m === 1 ? 'mil' : `${apocope(centenas(m))} mil`;
  return [cabeza, r ? centenas(r) : ''].filter(Boolean).join(' ');
}

/** Un entero con letra (en minúsculas). */
function entero(n) {
  if (n === 0) return 'cero';
  const mm = Math.floor(n / 1000000);
  const r = n % 1000000;
  const cabeza = mm === 0 ? '' : mm === 1 ? 'un millón' : `${apocope(miles(mm))} millones`;
  return [cabeza, r ? miles(r) : ''].filter(Boolean).join(' ');
}

/** "Mil doscientos treinta pesos 50/100 M.N." (sin signo: el recibo dice aparte si es en contra). */
function pesos(monto) {
  const centavos = Math.round(Math.abs(Number(monto) || 0) * 100);
  const n = Math.floor(centavos / 100);
  const cc = String(centavos % 100).padStart(2, '0');
  let texto = apocope(entero(n));
  // "un millón de pesos", "dos millones de pesos": exacto en millones lleva "de".
  if (n >= 1000000 && n % 1000000 === 0) texto += ' de';
  texto += n === 1 ? ' peso' : ' pesos';
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)} ${cc}/100 M.N.`;
}

module.exports = { pesos, entero };
