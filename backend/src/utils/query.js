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

/**
 * Búsqueda de un hilo por PALABRAS: cada palabra tiene que aparecer en alguna
 * de las columnas, en cualquier orden. Así "rojo 2/30" encuentra el ROJO de
 * calibre 2/30 —el color está en el nombre y el calibre en otra columna— y
 * "2-30" también, porque el proveedor escribe el calibre con guion.
 *
 * Devuelve el pedazo de WHERE y sus parámetros (`:bq0`, `:bq1`…), o null si
 * no hay nada que buscar. Va con un tope de palabras para que una búsqueda
 * pegada por error no arme una consulta enorme.
 */
function porPalabras(q, columnas) {
  const palabras = String(q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!palabras.length) return null;
  const params = {};
  const partes = palabras.map((w, i) => {
    params[`bq${i}`] = `%${w}%`;
    params[`bc${i}`] = `%${w.replace(/-/g, '/')}%`;
    // La variante con "/" solo cambia algo en el calibre; en las demás columnas
    // basta la palabra tal cual. Una columna también puede ser una función que
    // arma su condición con el nombre del parámetro (para un EXISTS).
    const cond = (c) => {
      if (typeof c === 'function') return c(`:bq${i}`);
      if (c.calibre) return `${c.col} LIKE :bc${i}`;
      return `${c.col ?? c} LIKE :bq${i}`;
    };
    return '(' + columnas.map(cond).join(' OR ') + ')';
  });
  return { sql: partes.join(' AND '), params };
}

module.exports = { parsePagination, paginado, parseBool, porPalabras };
