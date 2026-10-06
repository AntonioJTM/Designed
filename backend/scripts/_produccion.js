'use strict';

/**
 * Las bases de PRODUCCIÓN: la operación real de la tienda.
 *
 * Desde el 2026-10-05 el servidor tiene dos bases: `hitex` (producción, la del
 * sistema en https://devtristan.cloud) y `desarrollo` (pruebas, la del sistema
 * en https://devtristan.cloud:8443, con la muestra sembrada). Viven en el MISMO
 * servidor, así que mirar el host ya no basta para saber si una base es la real:
 * se mira el nombre.
 *
 * Ninguna prueba ni ningún sembrado escribe en estas bases, con ningún permiso.
 */
const BASES_PRODUCCION = ['hitex'];

function esProduccion(nombre) {
  return BASES_PRODUCCION.includes(String(nombre || '').trim().toLowerCase());
}

module.exports = { BASES_PRODUCCION, esProduccion };
