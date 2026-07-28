'use strict';

const { pool } = require('../../config/db');

// Acceso a datos de `almacenes`.

const CAMPOS = 'id, nombre, direccion, es_punto_venta, es_tienda_linea, es_matriz, activo';

async function listar({ activo } = {}) {
  const where = activo !== undefined ? 'WHERE activo = :activo' : '';
  const [rows] = await pool.query(
    `SELECT ${CAMPOS} FROM almacenes ${where} ORDER BY nombre`,
    { activo: activo ? 1 : 0 }
  );
  return rows;
}

async function obtener(id) {
  const [rows] = await pool.query(
    `SELECT ${CAMPOS} FROM almacenes WHERE id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

async function crear(datos) {
  const [r] = await pool.query(
    `INSERT INTO almacenes (nombre, direccion, es_punto_venta, es_tienda_linea, es_matriz, activo)
     VALUES (:nombre, :direccion, :es_punto_venta, :es_tienda_linea, :es_matriz, :activo)`,
    datos
  );
  return obtener(r.insertId);
}

async function actualizar(id, datos) {
  await pool.query(
    `UPDATE almacenes SET nombre = :nombre, direccion = :direccion,
        es_punto_venta = :es_punto_venta, es_tienda_linea = :es_tienda_linea,
        es_matriz = :es_matriz, activo = :activo
      WHERE id = :id`,
    { ...datos, id }
  );
  return obtener(id);
}

/**
 * Cuenta lo que cuelga del almacén. Sirve para explicar por qué no se puede
 * borrar en vez de soltar un error de llave foránea.
 */
async function dependencias(id) {
  const [[r]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM inventario              WHERE almacen_id = :id) AS inventario,
       (SELECT COUNT(*) FROM movimientos_inventario  WHERE almacen_id = :id) AS movimientos,
       (SELECT COUNT(*) FROM cajas                   WHERE almacen_id = :id) AS cajas,
       (SELECT COUNT(*) FROM pedidos                 WHERE almacen_id = :id) AS pedidos,
       (SELECT COUNT(*) FROM variante_conversiones
         WHERE almacen_origen_id = :id OR almacen_destino_id = :id)          AS conversiones`,
    { id }
  );
  return r;
}

async function eliminar(id) {
  const [r] = await pool.query('DELETE FROM almacenes WHERE id = :id', { id });
  return r.affectedRows > 0;
}

/** Deja `es_tienda_linea` encendido en un único almacén: el indicado. */
async function marcarUnicoTiendaLinea(id) {
  await pool.query('UPDATE almacenes SET es_tienda_linea = (id = :id)', { id });
}

/** Deja `es_matriz` encendida en un único almacén: el indicado. */
async function marcarUnicaMatriz(id) {
  await pool.query('UPDATE almacenes SET es_matriz = (id = :id)', { id });
}

/** Almacén que surte a las sucursales, o null si no hay ninguno marcado. */
async function idMatriz() {
  const [rows] = await pool.query(
    'SELECT id FROM almacenes WHERE es_matriz = 1 AND activo = 1 ORDER BY id LIMIT 1'
  );
  return rows[0]?.id ?? null;
}

/**
 * Almacén del que descuenta la tienda en línea.
 *
 * Es el marcado con `es_tienda_linea`. Si no hay ninguno (instalación previa
 * a la migración), cae al comportamiento histórico: el primer almacén activo
 * que no sea punto de venta. Devuelve null si no hay almacenes activos.
 *
 * Acepta una conexión para poder usarse dentro de una transacción.
 */
async function idTiendaLinea(ejecutor = pool) {
  const [marcado] = await ejecutor.query(
    'SELECT id FROM almacenes WHERE es_tienda_linea = 1 AND activo = 1 ORDER BY id LIMIT 1'
  );
  if (marcado[0]) return marcado[0].id;

  const [fallback] = await ejecutor.query(
    'SELECT id FROM almacenes WHERE activo = 1 ORDER BY es_punto_venta ASC, id LIMIT 1'
  );
  return fallback[0]?.id ?? null;
}

module.exports = {
  listar,
  obtener,
  crear,
  actualizar,
  dependencias,
  eliminar,
  marcarUnicoTiendaLinea,
  marcarUnicaMatriz,
  idTiendaLinea,
  idMatriz,
};
