'use strict';

/**
 * EL TICKET DE UN ABONO A UNA NOTA (2026-10-15: "tickets de abono"): lo que se
 * pagó de una nota pendiente de pago, una nota en espera o un apartado —cada
 * pago es un renglón de `pagos`—, cuánto llevaba pagado, cuánto le falta
 * después de este pago y cuánto le falta hoy. Los datos se arman aquí y el
 * ticket lo dibuja la pantalla (`shared/ticket/ticket.ts`). Sale igual al
 * registrarlo que al reimprimirlo: se cuenta con los pagos hasta ese.
 */

const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function pagoDeNota(pedidoId, pagoId) {
  const [[p]] = await pool.query(
    `SELECT p.id, p.numero_pedido, p.creado_en, p.total, p.estado, p.nota_pendiente, p.encargo,
            p.inventario_descontado, c.nombre AS cliente, c.nombre_comercial, c.codigo AS cliente_codigo,
            a.nombre AS almacen
       FROM pedidos p
       LEFT JOIN clientes c  ON c.id = p.cliente_id
       LEFT JOIN almacenes a ON a.id = p.almacen_id
      WHERE p.id = :id`,
    { id: pedidoId }
  );
  if (!p) throw new AppError(404, 'NO_ENCONTRADO', 'Pedido no encontrado');
  const [[g]] = await pool.query(
    `SELECT g.id, g.monto, g.estado, g.referencia_transaccion AS referencia, g.creado_en, mp.nombre AS metodo
       FROM pagos g JOIN metodos_pago mp ON mp.id = g.metodo_pago_id
      WHERE g.id = :pago AND g.pedido_id = :pedido`,
    { pago: pagoId, pedido: pedidoId }
  );
  if (!g || g.estado !== 'completado') {
    throw new AppError(404, 'PAGO_NO_ENCONTRADO', 'Ese pago no es de esta nota o no está cobrado.');
  }

  const [pagos] = await pool.query(
    `SELECT id, monto FROM pagos WHERE pedido_id = :id AND estado = 'completado' ORDER BY creado_en, id`,
    { id: pedidoId }
  );
  const i = pagos.findIndex((x) => Number(x.id) === Number(pagoId));
  const suma = (lista) => round2(lista.reduce((s, x) => s + Number(x.monto), 0));
  const total = round2(p.total);
  const llevaba = suma(pagos.slice(0, i));
  const pagado = suma(pagos.slice(0, i + 1));

  const de = Number(p.nota_pendiente) ? 'Nota pendiente de pago'
    : Number(p.encargo) ? 'Nota en espera'
      : p.estado === 'apartado' || Number(p.inventario_descontado) === 0 ? 'Apartado'
        : 'Venta';
  return {
    id: Number(g.id),
    pedido: {
      id: Number(p.id), numero_pedido: p.numero_pedido, creado_en: p.creado_en, total, de, almacen: p.almacen,
    },
    cliente: p.cliente ? { nombre: p.cliente, nombre_comercial: p.nombre_comercial, codigo: p.cliente_codigo } : null,
    fecha: g.creado_en,
    monto: round2(g.monto),
    metodo: g.metodo,
    referencia: g.referencia,
    llevaba_pagado: llevaba,
    pagado,
    falta: Math.max(0, round2(total - pagado)),
    falta_hoy: Math.max(0, round2(total - suma(pagos))),
  };
}

module.exports = { pagoDeNota };
