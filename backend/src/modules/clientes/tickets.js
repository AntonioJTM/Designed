'use strict';

/**
 * LOS TICKETS DE LA CUENTA DEL CLIENTE (2026-10-15: "necesito que me generes
 * tickets de anticipos y tickets de abono"). Aquí se arman los DATOS; el ticket
 * lo dibuja la pantalla (`shared/ticket/ticket.ts`), igual que el de la venta.
 *
 * Salen de la base al momento, y salen IGUAL al registrarlo que al reimprimirlo
 * días después: el "antes" y el "después" se calculan con el libro hasta ese
 * movimiento (crédito y saldo a favor son libros, no saldos guardados), y el
 * "hoy" con el libro completo.
 */

const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const { repartirAbonos, SIGNO_CREDITO } = require('./model');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
/** El saldo a favor: lo que suma y lo que resta cada tipo (como en saldo-favor.js). */
const SIGNO_FAVOR = { devolucion: 1, anticipo: 1, uso: -1, aplicado: -1, reintegro: 1, ajuste: 1 };

async function _cliente(clienteId) {
  const [[c]] = await pool.query(
    'SELECT id, nombre, nombre_comercial, codigo FROM clientes WHERE id = :id',
    { id: clienteId }
  );
  if (!c) throw new AppError(404, 'NO_ENCONTRADO', 'Cliente no encontrado');
  return c;
}

/**
 * Un ABONO A SU CUENTA de crédito: cuánto abonó y con qué, cuánto debía antes,
 * cuánto quedó debiendo, cuánto debe hoy y qué ventas fiadas quedaron pagadas
 * con él (el abono paga primero lo más antiguo).
 */
async function abonoCuenta(clienteId, movId) {
  const [[m]] = await pool.query(
    `SELECT m.id, m.tipo, m.monto, m.referencia, m.notas, m.creado_en,
            mp.nombre AS metodo, u.nombre AS usuario, cj.nombre AS caja
       FROM credito_movimientos m
       LEFT JOIN metodos_pago mp  ON mp.id = m.metodo_pago_id
       LEFT JOIN usuarios u       ON u.id = m.usuario_id
       LEFT JOIN sesiones_caja s  ON s.id = m.sesion_caja_id
       LEFT JOIN cajas cj         ON cj.id = s.caja_id
      WHERE m.id = :mov AND m.cliente_id = :cli`,
    { mov: movId, cli: clienteId }
  );
  if (!m || m.tipo !== 'abono') throw new AppError(404, 'ABONO_NO_ENCONTRADO', 'Ese abono no es de este cliente.');
  const cliente = await _cliente(clienteId);

  const [movs] = await pool.query(
    `SELECT id, tipo, monto, pedido_id FROM credito_movimientos
      WHERE cliente_id = :cli ORDER BY creado_en, id`,
    { cli: clienteId }
  );
  const i = movs.findIndex((x) => Number(x.id) === Number(movId));
  const antes = movs.slice(0, i);
  const hasta = movs.slice(0, i + 1);
  const saldo = (lista) => round2(lista.reduce((s, x) => s + (SIGNO_CREDITO[x.tipo] ?? 0) * Number(x.monto), 0));

  // Las ventas fiadas que ESTE abono terminó de pagar.
  const debianAntes = new Map(repartirAbonos(antes).filter((d) => d.pedidoId).map((d) => [d.pedidoId, d.porPagar]));
  const pagadasCon = repartirAbonos(hasta)
    .filter((d) => d.pedidoId && d.porPagar <= 0.004 && (debianAntes.get(d.pedidoId) ?? 0) > 0.004)
    .map((d) => d.pedidoId);
  let liquidadas = [];
  if (pagadasCon.length) {
    const [ps] = await pool.query('SELECT numero_pedido FROM pedidos WHERE id IN (:ids) ORDER BY id', { ids: pagadasCon });
    liquidadas = ps.map((p) => p.numero_pedido);
  }

  return {
    id: Number(m.id),
    cliente,
    fecha: m.creado_en,
    monto: round2(m.monto),
    metodo: m.metodo,
    referencia: m.referencia,
    notas: m.notas,
    usuario: m.usuario,
    caja: m.caja,
    debia: saldo(antes),
    quedo_debiendo: saldo(hasta),
    debe_hoy: saldo(movs),
    liquidadas,
  };
}

/**
 * Un ANTICIPO: el dinero que dejó a cuenta, sin nota. Si dejó parte en efectivo
 * y parte por transferencia son dos movimientos del mismo momento: van en UN
 * ticket. Cuánto tenía a favor antes, con cuánto quedó y cuánto tiene hoy.
 */
async function anticipo(clienteId, movId) {
  const [[m]] = await pool.query(
    `SELECT id, creado_en, usuario_id FROM saldo_favor_movimientos
      WHERE id = :mov AND cliente_id = :cli AND tipo = 'anticipo'`,
    { mov: movId, cli: clienteId }
  );
  if (!m) throw new AppError(404, 'ANTICIPO_NO_ENCONTRADO', 'Ese anticipo no es de este cliente.');
  const cliente = await _cliente(clienteId);

  // Lo que se registró junto: mismo cliente, misma persona, mismo momento.
  const [partes] = await pool.query(
    `SELECT f.id, f.monto, f.referencia, f.notas, mp.nombre AS metodo, cj.nombre AS caja, u.nombre AS usuario
       FROM saldo_favor_movimientos f
       LEFT JOIN metodos_pago mp ON mp.id = f.metodo_pago_id
       LEFT JOIN usuarios u      ON u.id = f.usuario_id
       LEFT JOIN sesiones_caja s ON s.id = f.sesion_caja_id
       LEFT JOIN cajas cj        ON cj.id = s.caja_id
      WHERE f.cliente_id = :cli AND f.tipo = 'anticipo' AND f.creado_en = :creado
        AND f.usuario_id <=> :usuario
      ORDER BY f.id`,
    { cli: clienteId, creado: m.creado_en, usuario: m.usuario_id }
  );
  const ids = new Set(partes.map((p) => Number(p.id)));

  const [movs] = await pool.query(
    'SELECT id, tipo, monto FROM saldo_favor_movimientos WHERE cliente_id = :cli ORDER BY creado_en, id',
    { cli: clienteId }
  );
  const primero = movs.findIndex((x) => ids.has(Number(x.id)));
  let ultimo = primero;
  movs.forEach((x, j) => { if (ids.has(Number(x.id))) ultimo = j; });
  const saldo = (lista) => round2(lista.reduce((s, x) => s + (SIGNO_FAVOR[x.tipo] ?? 0) * Number(x.monto), 0));

  // Las notas que pone el sistema solo ("Anticipo en efectivo") no dicen nada más.
  const propias = partes.map((p) => p.notas).filter((n) => n && !/^Anticipo (en efectivo|por transferencia)$/.test(n));
  return {
    id: Number(partes[0]?.id ?? movId),
    cliente,
    fecha: m.creado_en,
    partes: partes.map((p) => ({ metodo: p.metodo, monto: round2(p.monto), referencia: p.referencia })),
    total: round2(partes.reduce((s, p) => s + Number(p.monto), 0)),
    notas: propias[0] ?? null,
    usuario: partes[0]?.usuario ?? null,
    caja: partes.find((p) => p.caja)?.caja ?? null,
    tenia_a_favor: saldo(movs.slice(0, primero)),
    quedo_a_favor: saldo(movs.slice(0, ultimo + 1)),
    a_favor_hoy: saldo(movs),
  };
}

module.exports = { abonoCuenta, anticipo };
