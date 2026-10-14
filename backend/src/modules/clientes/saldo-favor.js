'use strict';

/**
 * EL SALDO A FAVOR de un cliente (2026-10-13, parte 2). "Un cliente te compra
 * hilo y regresa una parte o todo: no le quiero regresar dinero, lo que se le
 * tiene que agregar es como un saldo a favor de lo que regresó" (usuario).
 *
 * Es un LIBRO de movimientos, como el de crédito: el saldo es su suma y no hay
 * campo de saldo en `clientes` (un valor guardado aparte se descuadra en cuanto
 * algo falla a medias). Va APARTE de la deuda de crédito: "a veces el cliente
 * pide que su saldo a favor se utilice para otras compras y dejar su crédito
 * como está". Él elige:
 *   · usarlo para PAGAR una compra (`usarEnVenta`, desde el punto de venta);
 *   · DESCONTARLO de lo que debe (`aplicarADeuda`): sus notas pendientes de pago
 *     y su cuenta de crédito.
 *
 * Cuando se usa, queda como un PAGO de la venta con el método interno "Saldo a
 * favor" (o como un abono a su cuenta con ese método): así la venta dice cómo
 * se pagó, se liquida, y la comisión se paga como con cualquier pago.
 */

const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const clientesModel = require('./model');

const SIGNO = { devolucion: 1, uso: -1, aplicado: -1, reintegro: 1, ajuste: 1 };
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** El saldo a favor. Con `bloquear`, bloquea la fila del cliente (dos cajas a la vez). */
async function saldoFavor(clienteId, ejecutor = pool, bloquear = false) {
  if (bloquear) {
    await ejecutor.query('SELECT id FROM clientes WHERE id = :id FOR UPDATE', { id: clienteId });
  }
  const [rows] = await ejecutor.query(
    'SELECT tipo, monto FROM saldo_favor_movimientos WHERE cliente_id = :id',
    { id: clienteId }
  );
  return round2(rows.reduce((s, m) => s + (SIGNO[m.tipo] ?? 0) * Number(m.monto), 0));
}

/** Los movimientos del saldo a favor, del más nuevo al más viejo. */
async function movimientos(clienteId, { limit = 50 } = {}) {
  const [rows] = await pool.query(
    `SELECT m.id, m.tipo, m.monto, m.notas, m.creado_en,
            m.pedido_id, p.numero_pedido, m.devolucion_id, d.folio AS devolucion_folio,
            u.nombre AS registro
       FROM saldo_favor_movimientos m
       LEFT JOIN pedidos p      ON p.id = m.pedido_id
       LEFT JOIN devoluciones d ON d.id = m.devolucion_id
       LEFT JOIN usuarios u     ON u.id = m.usuario_id
      WHERE m.cliente_id = :id
      ORDER BY m.creado_en DESC, m.id DESC
      LIMIT :limit`,
    { id: clienteId, limit }
  );
  return rows;
}

async function agregar(conn, { clienteId, tipo, monto, pedidoId = null, devolucionId = null, usuarioId = null, notas = null }) {
  await conn.query(
    `INSERT INTO saldo_favor_movimientos (cliente_id, tipo, monto, pedido_id, devolucion_id, usuario_id, notas)
     VALUES (:cliente, :tipo, :monto, :pedido, :devolucion, :usuario, :notas)`,
    { cliente: clienteId, tipo, monto: round2(monto), pedido: pedidoId, devolucion: devolucionId, usuario: usuarioId, notas }
  );
}

/** El método de pago interno con que se asienta lo que paga el saldo a favor. */
async function metodoSaldoFavor(ejecutor = pool) {
  const [[m]] = await ejecutor.query(
    "SELECT id FROM metodos_pago WHERE nombre = 'Saldo a favor' AND interno = 1 LIMIT 1"
  );
  if (!m) throw new AppError(500, 'SIN_METODO_SALDO', 'Falta el método de pago "Saldo a favor" (migración 2026-10_saldo_a_favor).');
  return Number(m.id);
}

/**
 * Usa saldo a favor para PAGAR una venta (lo llama `crearPedido`, dentro de su
 * transacción). Valida con la fila del cliente bloqueada que le alcance: dos
 * cajas no pueden gastar el mismo saldo. El PAGO lo asienta la venta.
 */
async function usarEnVenta(conn, { clienteId, monto, pedidoId, numeroPedido, usuarioId }) {
  const disponible = await saldoFavor(clienteId, conn, true);
  if (monto > disponible + 0.001) {
    throw new AppError(409, 'SALDO_FAVOR_INSUFICIENTE',
      `Tiene $${disponible.toFixed(2)} a favor y se quieren usar $${round2(monto).toFixed(2)}.`);
  }
  await agregar(conn, {
    clienteId, tipo: 'uso', monto, pedidoId, usuarioId, notas: `Pagó parte de ${numeroPedido}`,
  });
}

/**
 * Al CANCELAR una venta donde se usó saldo a favor (al cobrarla, o descontado
 * de su nota pendiente), el saldo REGRESA (no se devuelve en efectivo: no era
 * dinero del cajón). Idempotente: regresa el neto de lo usado en esa venta, así
 * cancelar dos veces no lo regresa dos veces.
 */
async function reintegrarDeVenta(conn, { pedidoId, numeroPedido, usuarioId }) {
  const [rows] = await conn.query(
    `SELECT cliente_id, tipo, monto FROM saldo_favor_movimientos
      WHERE pedido_id = :id AND tipo IN ('uso', 'aplicado', 'reintegro')`,
    { id: pedidoId }
  );
  if (!rows.length) return 0;
  const neto = round2(rows.reduce((s, m) => s + (m.tipo === 'reintegro' ? -1 : 1) * Number(m.monto), 0));
  if (neto <= 0.004) return 0;
  await agregar(conn, {
    clienteId: rows[0].cliente_id, tipo: 'reintegro', monto: neto, pedidoId, usuarioId,
    notas: `Se canceló ${numeroPedido}: regresa lo que pagó con su saldo a favor`,
  });
  await conn.query(
    `UPDATE pagos p JOIN metodos_pago mp ON mp.id = p.metodo_pago_id
        SET p.estado = 'reembolsado'
      WHERE p.pedido_id = :id AND mp.interno = 1 AND p.estado = 'completado'`,
    { id: pedidoId }
  );
  return neto;
}

/**
 * DESCUENTA saldo a favor de lo que el cliente debe, hasta `monto` (o todo lo
 * que alcance). Primero lo de la nota `preferirPedidoId` (la de la devolución),
 * luego sus notas pendientes de pago de la más vieja a la más nueva, y luego su
 * cuenta de crédito; si la nota preferida es a crédito, la cuenta va primero.
 *   · a una nota pendiente le asienta un PAGO "Saldo a favor" (con el último
 *     queda pagada);
 *   · a la cuenta de crédito, un ABONO con ese método (se liquidan solas las
 *     ventas que cubre, de la más vieja a la más nueva).
 * Devuelve cuánto aplicó y a qué.
 */
async function aplicarADeuda(conn, { clienteId, monto = null, preferirPedidoId = null, usuarioId = null, origen = '' }) {
  const disponible = await saldoFavor(clienteId, conn, true);
  let resta = round2(monto == null ? disponible : Math.min(monto, disponible));
  if (resta <= 0.004) return { aplicado: 0, detalle: [] };
  const metodo = await metodoSaldoFavor(conn);
  const detalle = [];

  const [notas] = await conn.query(
    `SELECT p.id, p.numero_pedido, p.total,
            COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.pedido_id = p.id AND pg.estado = 'completado'), 0) AS pagado
       FROM pedidos p
      WHERE p.cliente_id = :cli AND p.nota_pendiente = 1 AND p.estado = 'pendiente'
        AND NOT EXISTS (SELECT 1 FROM credito_movimientos cm WHERE cm.pedido_id = p.id AND cm.tipo = 'cargo')
      ORDER BY (p.id = :pref) DESC, p.creado_en, p.id
      FOR UPDATE`,
    { cli: clienteId, pref: preferirPedidoId ?? 0 }
  );
  let preferidaACredito = false;
  if (preferirPedidoId) {
    const [[c]] = await conn.query(
      "SELECT 1 AS si FROM credito_movimientos WHERE pedido_id = :id AND tipo = 'cargo' LIMIT 1",
      { id: preferirPedidoId }
    );
    preferidaACredito = !!c;
  }

  const aCredito = async () => {
    if (resta <= 0.004) return;
    const deuda = await clientesModel.saldo(clienteId, conn, true);
    const usa = round2(Math.min(deuda, resta));
    if (usa <= 0.004) return;
    await clientesModel.agregarMovimiento({
      cliente_id: clienteId, tipo: 'abono', monto: usa, metodo_pago_id: metodo, usuario_id: usuarioId,
      notas: `Con su saldo a favor${origen ? ' (' + origen + ')' : ''}`,
    }, conn);
    await clientesModel.liquidarVentasACredito(conn, clienteId);
    await agregar(conn, {
      clienteId, tipo: 'aplicado', monto: usa, usuarioId,
      notas: `A su cuenta de crédito${origen ? ' (' + origen + ')' : ''}`,
    });
    detalle.push({ a: 'credito', monto: usa });
    resta = round2(resta - usa);
  };
  const aNotas = async () => {
    for (const n of notas) {
      if (resta <= 0.004) break;
      const falta = round2(Number(n.total) - Number(n.pagado));
      const usa = round2(Math.min(falta, resta));
      if (usa <= 0.004) continue;
      await conn.query(
        `INSERT INTO pagos (pedido_id, metodo_pago_id, monto, estado, referencia_transaccion)
         VALUES (:p, :m, :monto, 'completado', :ref)`,
        { p: n.id, m: metodo, monto: usa, ref: origen ? `Saldo a favor (${origen})` : 'Saldo a favor' }
      );
      if (usa + 0.004 >= falta) {
        await conn.query("UPDATE pedidos SET estado = 'pagado' WHERE id = :id", { id: n.id });
      }
      await agregar(conn, {
        clienteId, tipo: 'aplicado', monto: usa, pedidoId: n.id, usuarioId,
        notas: `Pagó la nota ${n.numero_pedido}${origen ? ' (' + origen + ')' : ''}`,
      });
      detalle.push({ a: 'nota', pedido_id: n.id, numero_pedido: n.numero_pedido, monto: usa, pagada: usa + 0.004 >= falta });
      resta = round2(resta - usa);
    }
  };

  if (preferidaACredito) {
    await aCredito();
    await aNotas();
  } else {
    await aNotas();
    await aCredito();
  }
  const aplicado = round2(detalle.reduce((s, d) => s + d.monto, 0));
  return { aplicado, detalle };
}

/** Cuánto debe en total: su cuenta de crédito y sus notas pendientes de pago. */
async function deudaTotal(clienteId, ejecutor = pool) {
  const credito = Math.max(0, await clientesModel.saldo(clienteId, ejecutor));
  const [[n]] = await ejecutor.query(
    `SELECT COALESCE(SUM(p.total - COALESCE((SELECT SUM(pg.monto) FROM pagos pg
                                              WHERE pg.pedido_id = p.id AND pg.estado = 'completado'), 0)), 0) AS falta
       FROM pedidos p
      WHERE p.cliente_id = :cli AND p.nota_pendiente = 1 AND p.estado = 'pendiente'
        AND NOT EXISTS (SELECT 1 FROM credito_movimientos cm WHERE cm.pedido_id = p.id AND cm.tipo = 'cargo')`,
    { cli: clienteId }
  );
  const notas = round2(n.falta);
  return { credito: round2(credito), notas, total: round2(credito + notas) };
}

module.exports = {
  saldoFavor, movimientos, agregar, metodoSaldoFavor, usarEnVenta, reintegrarDeVenta, aplicarADeuda, deudaTotal,
};
