'use strict';

const { pool, withTransaction } = require('../../config/db');

// Direcciones de entrega del cliente. Solo el dueño las ve y las toca: cada
// consulta lleva el `cliente_id` en el WHERE, nunca se confía en el id de la
// ruta por sí solo.

const CAMPOS = `id, cliente_id, tipo, nombre_receptor, calle, numero_ext, numero_int,
                colonia, ciudad, estado, codigo_postal, pais, telefono, referencias,
                es_predeterminada`;

async function listar(clienteId) {
  const [rows] = await pool.query(
    `SELECT ${CAMPOS} FROM direcciones WHERE cliente_id = :c
      ORDER BY es_predeterminada DESC, id DESC`,
    { c: clienteId }
  );
  return rows;
}

/** Una dirección, solo si es de ese cliente. Devuelve null si no lo es. */
async function obtener(id, clienteId, ejecutor = pool) {
  const [rows] = await ejecutor.query(
    `SELECT ${CAMPOS} FROM direcciones WHERE id = :id AND cliente_id = :c LIMIT 1`,
    { id, c: clienteId }
  );
  return rows[0] || null;
}

/** Deja una sola predeterminada por cliente. */
async function _desmarcarOtras(conn, clienteId, exceptoId) {
  await conn.query(
    'UPDATE direcciones SET es_predeterminada = 0 WHERE cliente_id = :c AND id <> :id',
    { c: clienteId, id: exceptoId ?? 0 }
  );
}

async function crear(clienteId, d) {
  return withTransaction(async (conn) => {
    // La primera dirección que captura el cliente es su predeterminada aunque
    // no lo pida: si no, el checkout abriría sin nada seleccionado.
    const [[{ n }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM direcciones WHERE cliente_id = :c',
      { c: clienteId }
    );
    const predeterminada = d.es_predeterminada || Number(n) === 0;

    const [r] = await conn.query(
      `INSERT INTO direcciones
         (cliente_id, tipo, nombre_receptor, calle, numero_ext, numero_int, colonia,
          ciudad, estado, codigo_postal, pais, telefono, referencias, es_predeterminada)
       VALUES
         (:cliente_id, :tipo, :nombre_receptor, :calle, :numero_ext, :numero_int, :colonia,
          :ciudad, :estado, :codigo_postal, :pais, :telefono, :referencias, :es_predeterminada)`,
      { cliente_id: clienteId, ...d, es_predeterminada: predeterminada ? 1 : 0 }
    );
    if (predeterminada) await _desmarcarOtras(conn, clienteId, r.insertId);
    return obtener(r.insertId, clienteId, conn);
  });
}

async function actualizar(id, clienteId, d) {
  return withTransaction(async (conn) => {
    await conn.query(
      `UPDATE direcciones SET
         tipo = :tipo, nombre_receptor = :nombre_receptor, calle = :calle,
         numero_ext = :numero_ext, numero_int = :numero_int, colonia = :colonia,
         ciudad = :ciudad, estado = :estado, codigo_postal = :codigo_postal,
         pais = :pais, telefono = :telefono, referencias = :referencias,
         es_predeterminada = :es_predeterminada
       WHERE id = :id AND cliente_id = :cliente_id`,
      { id, cliente_id: clienteId, ...d, es_predeterminada: d.es_predeterminada ? 1 : 0 }
    );
    if (d.es_predeterminada) await _desmarcarOtras(conn, clienteId, id);
    return obtener(id, clienteId, conn);
  });
}

/** Cuántos pedidos apuntan a esta dirección; impiden borrarla. */
async function pedidosQueLaUsan(id) {
  const [[r]] = await pool.query(
    'SELECT COUNT(*) AS n FROM pedidos WHERE direccion_envio_id = :id',
    { id }
  );
  return Number(r.n);
}

async function eliminar(id, clienteId) {
  return withTransaction(async (conn) => {
    const [r] = await conn.query(
      'DELETE FROM direcciones WHERE id = :id AND cliente_id = :c',
      { id, c: clienteId }
    );
    if (!r.affectedRows) return false;
    // Si se fue la predeterminada, asciende la más reciente que quede: el
    // checkout siempre debe abrir con una dirección puesta.
    const [[{ n }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM direcciones WHERE cliente_id = :c AND es_predeterminada = 1',
      { c: clienteId }
    );
    if (Number(n) === 0) {
      await conn.query(
        `UPDATE direcciones SET es_predeterminada = 1
          WHERE cliente_id = :c ORDER BY id DESC LIMIT 1`,
        { c: clienteId }
      );
    }
    return true;
  });
}

module.exports = { listar, obtener, crear, actualizar, eliminar, pedidosQueLaUsan };
