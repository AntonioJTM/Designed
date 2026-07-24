'use strict';

/**
 * Convierte un texto en un slug URL-safe: minúsculas, sin acentos,
 * separado por guiones. Ej: "Hilo de Bordar" → "hilo-de-bordar".
 */
function slugify(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita diacríticos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // no alfanumérico → guion
    .replace(/^-+|-+$/g, ''); // recorta guiones de los extremos
}

module.exports = { slugify };
