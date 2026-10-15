'use strict';

const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');

// LUGARES DE ENTREGA (2026-10-14): "los que entrego en Tulancingo, Tenango…
// necesito etiquetar esos clientes para sacar a cuántos les entrego en los
// municipios o estados" (usuario).
//
// Es una LISTA y no texto libre: con texto, "Tulancingo" y "tulancingo " serían
// dos lugares y la cuenta saldría partida. Cada lugar es un municipio (o el
// nombre con que lo conoce la tienda) y su estado; el mismo lugar no se repite
// en el mismo estado (la comparación ignora mayúsculas y acentos, por la
// intercalación de la tabla). Cada cliente tiene uno o ninguno
// (`clientes.lugar_entrega_id`).

const limpiar = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

/**
 * La lista, con cuántos clientes ACTIVOS tiene cada lugar, y cuántos activos
 * no tienen lugar. Ordenada por estado y lugar: así la lee la pantalla.
 */
async function listar() {
  const [lugares] = await pool.query(
    `SELECT le.id, le.nombre, le.estado,
            (SELECT COUNT(*) FROM clientes c WHERE c.lugar_entrega_id = le.id AND c.activo = 1) AS num_clientes
       FROM lugares_entrega le
      ORDER BY le.estado, le.nombre`
  );
  const [[cuenta]] = await pool.query(
    `SELECT COUNT(*) AS activos, SUM(lugar_entrega_id IS NULL) AS sin_lugar
       FROM clientes WHERE activo = 1`
  );
  return {
    lugares: lugares.map((l) => ({ ...l, num_clientes: Number(l.num_clientes) })),
    clientes_activos: Number(cuenta.activos ?? 0),
    sin_lugar: Number(cuenta.sin_lugar ?? 0),
  };
}

async function existe(id) {
  const [[r]] = await pool.query('SELECT id FROM lugares_entrega WHERE id = :id', { id });
  return !!r;
}

async function _obtener(id) {
  const [[r]] = await pool.query('SELECT id, nombre, estado FROM lugares_entrega WHERE id = :id', { id });
  return r || null;
}

/** ¿Ya hay ese lugar en ese estado (otro que no sea `exceptoId`)? */
async function _repetido(nombre, estado, exceptoId = 0) {
  const [[r]] = await pool.query(
    `SELECT id, nombre, estado FROM lugares_entrega
      WHERE nombre = :nombre AND estado = :estado AND id <> :excepto LIMIT 1`,
    { nombre, estado, excepto: exceptoId }
  );
  if (r) {
    throw new AppError(409, 'LUGAR_REPETIDO', `Ya está en la lista: ${r.nombre}, ${r.estado}.`, { id: r.id });
  }
}

async function crear(datos) {
  const nombre = limpiar(datos.nombre);
  const estado = limpiar(datos.estado);
  await _repetido(nombre, estado);
  const [r] = await pool.query(
    'INSERT INTO lugares_entrega (nombre, estado) VALUES (:nombre, :estado)',
    { nombre, estado }
  );
  return { ...(await _obtener(r.insertId)), num_clientes: 0 };
}

/** Corregir cómo se escribió: el lugar sigue siendo el mismo para sus clientes. */
async function actualizar(id, datos) {
  const actual = await _obtener(id);
  if (!actual) throw new AppError(404, 'NO_ENCONTRADO', 'Lugar de entrega no encontrado');
  const nombre = limpiar(datos.nombre);
  const estado = limpiar(datos.estado);
  await _repetido(nombre, estado, id);
  await pool.query(
    'UPDATE lugares_entrega SET nombre = :nombre, estado = :estado WHERE id = :id',
    { nombre, estado, id }
  );
  return _obtener(id);
}

module.exports = { listar, existe, crear, actualizar };
