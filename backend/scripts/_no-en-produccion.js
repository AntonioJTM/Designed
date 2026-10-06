'use strict';

/**
 * Seguro para las suites E2E: se niegan a correr contra una base REMOTA.
 *
 * Desde el 2026-09-05 el `.env` apunta a la base del servidor —el usuario
 * decidió trabajar solo contra producción— y estas suites CREAN Y BORRAN
 * productos, variantes, pedidos, clientes y movimientos de inventario. Están
 * hechas para limpiarse solas, pero si una muere a medias deja basura, y eso
 * en el catálogo real del negocio no es aceptable. (Ya pasó en local el mismo
 * día: una corrida abortada dejó un producto y dos pedidos colgando.)
 *
 * Se carga al principio de cada suite, después de leer el .env:
 *
 *     require('dotenv').config(...);
 *     require('./_no-en-produccion');
 *
 * Para correrlas contra el servidor a propósito —con respaldo hecho y sabiendo
 * lo que implica— hay que decirlo explícitamente:
 *
 *     E2E_ACEPTO_PRODUCCION=si node scripts/e2e-loquesea.js
 *
 * No basta con equivocarse de terminal: hay que escribirlo.
 *
 * Desde el 2026-10-05 la base REAL es `hitex` y `desarrollo` quedó para pruebas,
 * las dos en el mismo servidor (ver `_produccion.js`). Contra `hitex` no corre
 * nada, ni con el permiso: ahí está la operación de la tienda.
 */

const { esProduccion } = require('./_produccion');

const LOCALES = ['localhost', '127.0.0.1', '::1', ''];

const host = (process.env.DB_HOST || '').trim();
const base = (process.env.DB_NAME || '').trim();

if (esProduccion(base)) {
  console.error(
    `\n  ✗ "${base}" es la base de PRODUCCIÓN: ninguna prueba corre ahí, ni con E2E_ACEPTO_PRODUCCION.\n` +
      '    Las pruebas van contra la base de pruebas (desarrollo) o una local.\n'
  );
  process.exit(3);
}

if (!LOCALES.includes(host)) {
  if (String(process.env.E2E_ACEPTO_PRODUCCION || '').toLowerCase() === 'si') {
    console.warn(
      `\n  ⚠  Corriendo contra una base REMOTA (${host}). ` +
        'Va a crear y borrar datos ahí.\n'
    );
  } else {
    console.error(
      '\n  ✗ Esta prueba NO corre contra una base remota.\n' +
        `      DB_HOST = ${host}\n\n` +
        '    Crea y borra productos, pedidos y clientes; si algo falla a medias\n' +
        '    deja basura en el catálogo real.\n\n' +
        '    Para una base local, apunta el .env a localhost.\n' +
        '    Si de verdad quieres correrla contra el servidor (con respaldo hecho):\n\n' +
        '      E2E_ACEPTO_PRODUCCION=si node scripts/<la-prueba>.js\n'
    );
    process.exit(3);
  }
}
