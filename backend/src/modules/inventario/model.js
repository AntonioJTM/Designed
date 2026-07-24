'use strict';

const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');

// Acceso a datos de inventario (multi-almacén) y su bitácora (kardex).
// REGLA: todo cambio de existencias = UPDATE inventario + INSERT movimiento,
// siempre dentro de una transacción (ver registrarMovimiento / transferir).

// Signo del efecto sobre las existencias según el tipo de movimiento.
// 'ajuste' es especial: la cantidad enviada es el valor absoluto objetivo.
const SIGNO = { entrada: 1, devolucion: 1, salida: -1, merma: -1 };

const SELECT_STOCK = `
  SELECT i.id, i.variante_id, pv.sku, p.nombre AS producto, col.nombre AS color,
         i.almacen_id, a.nombre AS almacen,
         i.cantidad, i.cantidad_reservada,
         (i.cantidad - i.cantidad_reservada) AS disponible,
         i.stock_minimo, i.stock_maximo, i.ubicacion_fisica, i.actualizado_en
    FROM inventario i
    JOIN producto_variantes pv ON pv.id = i.variante_id
    JOIN productos p           ON p.id = pv.producto_id
    LEFT JOIN colores col      ON col.id = pv.color_id
    JOIN almacenes a           ON a.id = i.almacen_id
`;

async function listarStock({ almacen_id, variante_id, q, bajo_stock, limit, offset }) {
  const where = [];
  const params = {};
  if (almacen_id !== undefined) {
    where.push('i.almacen_id = :almacen_id');
    params.almacen_id = almacen_id;
  }
  if (variante_id !== undefined) {
    where.push('i.variante_id = :variante_id');
    params.variante_id = variante_id;
  }
  if (q) {
    where.push('(pv.sku LIKE :q OR p.nombre LIKE :q)');
    params.q = `%${q}%`;
  }
  if (bajo_stock) {
    where.push('(i.cantidad - i.cantidad_reservada) <= i.stock_minimo');
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `${SELECT_STOCK} ${whereSql} ORDER BY p.nombre, pv.sku LIMIT :limit OFFSET :offset`,
    { ...params, limit, offset }
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM inventario i
       JOIN producto_variantes pv ON pv.id = i.variante_id
       JOIN productos p ON p.id = pv.producto_id ${whereSql}`,
    params
  );
  return { rows, total };
}

/** Existencias por debajo (o al nivel) del stock mínimo. */
async function alertas() {
  const [rows] = await pool.query(
    `${SELECT_STOCK} WHERE (i.cantidad - i.cantidad_reservada) <= i.stock_minimo
      ORDER BY (i.cantidad - i.cantidad_reservada) - i.stock_minimo`
  );
  return rows;
}

async function listarMovimientos({ variante_id, almacen_id, tipo, limit, offset }) {
  const where = [];
  const params = {};
  if (variante_id !== undefined) {
    where.push('m.variante_id = :variante_id');
    params.variante_id = variante_id;
  }
  if (almacen_id !== undefined) {
    where.push('m.almacen_id = :almacen_id');
    params.almacen_id = almacen_id;
  }
  if (tipo) {
    where.push('m.tipo = :tipo');
    params.tipo = tipo;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT m.id, m.variante_id, pv.sku, m.almacen_id, a.nombre AS almacen,
            m.tipo, m.cantidad, m.costo_unitario, m.referencia_tipo, m.referencia_id,
            m.usuario_id, u.nombre AS usuario, m.motivo, m.creado_en
       FROM movimientos_inventario m
       JOIN producto_variantes pv ON pv.id = m.variante_id
       JOIN almacenes a           ON a.id = m.almacen_id
       LEFT JOIN usuarios u        ON u.id = m.usuario_id
       ${whereSql}
      ORDER BY m.creado_en DESC, m.id DESC
      LIMIT :limit OFFSET :offset`,
    { ...params, limit, offset }
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM movimientos_inventario m ${whereSql}`,
    params
  );
  return { rows, total };
}

/** Lee existencias de una variante en un almacén (0 si no hay fila). */
async function _leerCantidad(conn, variante_id, almacen_id) {
  const [rows] = await conn.query(
    'SELECT id, cantidad FROM inventario WHERE variante_id = :variante_id AND almacen_id = :almacen_id FOR UPDATE',
    { variante_id, almacen_id }
  );
  return rows[0] || null;
}

/** Aplica un nuevo saldo (upsert) a la fila de inventario. */
async function _aplicarSaldo(conn, variante_id, almacen_id, nuevo) {
  await conn.query(
    `INSERT INTO inventario (variante_id, almacen_id, cantidad)
     VALUES (:variante_id, :almacen_id, :nuevo)
     ON DUPLICATE KEY UPDATE cantidad = :nuevo`,
    { variante_id, almacen_id, nuevo }
  );
}

async function _insertarMovimiento(conn, mov) {
  const [r] = await conn.query(
    `INSERT INTO movimientos_inventario
       (variante_id, almacen_id, tipo, cantidad, costo_unitario,
        referencia_tipo, referencia_id, usuario_id, motivo)
     VALUES
       (:variante_id, :almacen_id, :tipo, :cantidad, :costo_unitario,
        :referencia_tipo, :referencia_id, :usuario_id, :motivo)`,
    mov
  );
  return r.insertId;
}

/**
 * Registra un movimiento simple (entrada/salida/ajuste/devolucion/merma) en un
 * solo almacén. `cantidad` es magnitud positiva salvo en 'ajuste', donde es el
 * valor absoluto objetivo. El movimiento guarda el delta con signo.
 */
async function registrarMovimiento(datos, usuarioId) {
  const { variante_id, almacen_id, tipo, cantidad } = datos;
  return withTransaction(async (conn) => {
    const fila = await _leerCantidad(conn, variante_id, almacen_id);
    const actual = fila ? Number(fila.cantidad) : 0;

    let delta;
    if (tipo === 'ajuste') {
      delta = cantidad - actual; // llevar el saldo al valor contado
    } else {
      delta = SIGNO[tipo] * cantidad;
    }

    const nuevo = actual + delta;
    if (nuevo < 0) {
      throw new AppError(409, 'STOCK_INSUFICIENTE',
        `Existencias insuficientes: hay ${actual}, se intenta descontar ${Math.abs(delta)}`);
    }

    await _aplicarSaldo(conn, variante_id, almacen_id, nuevo);
    const movId = await _insertarMovimiento(conn, {
      variante_id,
      almacen_id,
      tipo,
      cantidad: delta,
      costo_unitario: datos.costo_unitario ?? null,
      referencia_tipo: datos.referencia_tipo ?? null,
      referencia_id: datos.referencia_id ?? null,
      usuario_id: usuarioId ?? null,
      motivo: datos.motivo ?? null,
    });

    return { movimiento_id: movId, variante_id, almacen_id, tipo, delta, saldo_anterior: actual, saldo_nuevo: nuevo };
  });
}

/**
 * Transferencia entre almacenes: salida en origen + entrada en destino,
 * dos movimientos 'transferencia' dentro de una sola transacción.
 */
async function transferir(datos, usuarioId) {
  const { variante_id, almacen_origen_id, almacen_destino_id, cantidad } = datos;
  if (almacen_origen_id === almacen_destino_id) {
    throw new AppError(422, 'ALMACENES_IGUALES', 'El origen y el destino deben ser distintos');
  }
  return withTransaction(async (conn) => {
    const filaOrigen = await _leerCantidad(conn, variante_id, almacen_origen_id);
    const actualOrigen = filaOrigen ? Number(filaOrigen.cantidad) : 0;
    if (actualOrigen - cantidad < 0) {
      throw new AppError(409, 'STOCK_INSUFICIENTE',
        `Existencias insuficientes en el origen: hay ${actualOrigen}, se intenta transferir ${cantidad}`);
    }
    const filaDestino = await _leerCantidad(conn, variante_id, almacen_destino_id);
    const actualDestino = filaDestino ? Number(filaDestino.cantidad) : 0;

    await _aplicarSaldo(conn, variante_id, almacen_origen_id, actualOrigen - cantidad);
    await _aplicarSaldo(conn, variante_id, almacen_destino_id, actualDestino + cantidad);

    const base = {
      variante_id,
      tipo: 'transferencia',
      costo_unitario: datos.costo_unitario ?? null,
      referencia_tipo: 'transferencia',
      referencia_id: null,
      usuario_id: usuarioId ?? null,
      motivo: datos.motivo ?? null,
    };
    await _insertarMovimiento(conn, { ...base, almacen_id: almacen_origen_id, cantidad: -cantidad });
    await _insertarMovimiento(conn, { ...base, almacen_id: almacen_destino_id, cantidad });

    return {
      variante_id,
      origen: { almacen_id: almacen_origen_id, saldo_nuevo: actualOrigen - cantidad },
      destino: { almacen_id: almacen_destino_id, saldo_nuevo: actualDestino + cantidad },
    };
  });
}

/** Configura umbrales/ubicación SIN mover existencias (upsert). */
async function configurar(datos) {
  await pool.query(
    `INSERT INTO inventario (variante_id, almacen_id, stock_minimo, stock_maximo, ubicacion_fisica)
     VALUES (:variante_id, :almacen_id, :stock_minimo, :stock_maximo, :ubicacion_fisica)
     ON DUPLICATE KEY UPDATE
       stock_minimo = :stock_minimo, stock_maximo = :stock_maximo, ubicacion_fisica = :ubicacion_fisica`,
    datos
  );
  const [rows] = await pool.query(
    `${SELECT_STOCK} WHERE i.variante_id = :variante_id AND i.almacen_id = :almacen_id LIMIT 1`,
    { variante_id: datos.variante_id, almacen_id: datos.almacen_id }
  );
  return rows[0];
}

module.exports = {
  listarStock,
  alertas,
  listarMovimientos,
  registrarMovimiento,
  transferir,
  configurar,
};
