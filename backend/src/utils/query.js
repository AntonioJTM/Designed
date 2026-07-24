'use strict';

/**
 * Normaliza parámetros de paginación desde el query string.
 * page >= 1, limit entre 1 y 100 (por defecto 20).
 */
function parsePagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limitRaw = Number.parseInt(query.limit, 10) || 20;
  const limit = Math.min(100, Math.max(1, limitRaw));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/** Arma la respuesta paginada estándar. */
function paginado(items, total, page, limit) {
  return { items, total, page, limit, paginas: Math.ceil(total / limit) || 0 };
}

/**
 * Interpreta un valor de query como booleano opcional.
 * 'true'/'1' → true, 'false'/'0' → false, ausente/'' → undefined.
 */
function parseBool(valor) {
  if (valor === undefined || valor === '') return undefined;
  if (valor === 'true' || valor === '1') return true;
  if (valor === 'false' || valor === '0') return false;
  return undefined;
}

module.exports = { parsePagination, paginado, parseBool };
