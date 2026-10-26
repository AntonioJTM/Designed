'use strict';

/**
 * EL TICKET DE UN ABONO A UNA NOTA (2026-10-15: "tickets de abono"): lo que se
 * pagó de una nota pendiente de pago, una nota en espera o un apartado —cada
 * pago es un renglón de `pagos`—, cuánto llevaba pagado, cuánto le falta
 * después de este pago y cuánto le falta hoy. Los datos se arman aquí y el
 * ticket lo dibuja la pantalla (`shared/ticket/ticket.ts`). Sale igual al
 * registrarlo que al reimprimirlo: se cuenta con los pagos hasta ese.
 *
 * DOS FORMAS (2026-10-26): los pagos de la MISMA hora son una sola operación
 * (efectivo y transferencia, o con su saldo a favor): el ticket los junta, y si lo
 * que faltaba pasó a su cuenta de crédito en ese momento, también lo dice.
 */

const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const clientesModel = require('../clientes/model');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function pagoDeNota(pedidoId, pagoId) {
  const [[p]] = await pool.query(
    `SELECT p.id, p.numero_pedido, p.creado_en, p.total, p.estado, p.nota_pendiente, p.encargo,
            p.inventario_descontado, p.cliente_id, c.nombre AS cliente, c.nombre_comercial, c.codigo AS cliente_codigo,
            c.telefono, c.telefono_alt, a.nombre AS almacen
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
    `SELECT g.id, g.monto, g.creado_en, g.referencia_transaccion AS referencia, mp.nombre AS metodo
       FROM pagos g JOIN metodos_pago mp ON mp.id = g.metodo_pago_id
      WHERE g.pedido_id = :id AND g.estado = 'completado' ORDER BY g.creado_en, g.id`,
    { id: pedidoId }
  );
  // Los de la misma hora que este son la misma operación (dos formas).
  const grupo = pagos.filter((x) => String(x.creado_en) === String(g.creado_en));
  const primero = pagos.indexOf(grupo[0]);
  const ultimo = pagos.indexOf(grupo[grupo.length - 1]);
  const suma = (lista) => round2(lista.reduce((s, x) => s + Number(x.monto), 0));
  const total = round2(p.total);
  const llevaba = suma(pagos.slice(0, primero));
  const pagado = suma(pagos.slice(0, ultimo + 1));
  // Lo que faltaba y pasó a su cuenta de crédito en ese mismo momento.
  const [[cr]] = await pool.query(
    `SELECT COALESCE(SUM(cm.monto), 0) AS monto, MAX(COALESCE(pe.dias_credito, 15)) AS dias,
            DATE_FORMAT(DATE_ADD(MAX(cm.creado_en), INTERVAL MAX(COALESCE(pe.dias_credito, 15)) DAY), '%Y-%m-%d') AS vence_el
       FROM credito_movimientos cm JOIN pedidos pe ON pe.id = cm.pedido_id
      WHERE cm.pedido_id = :id AND cm.tipo = 'cargo' AND cm.creado_en = :en`,
    { id: pedidoId, en: g.creado_en }
  );
  const aCredito = round2(cr?.monto ?? 0);

  // LO QUE LE FALTA HOY (2026-10-26, auditoría): lo que no cubren sus pagos ni su
  // cargo a crédito, MÁS lo que de ese cargo todavía debe en su cuenta. Antes solo
  // contaba el crédito de ese mismo momento: una nota que pasó a crédito después (o
  // que ya liquidó su crédito) salía "debiendo".
  // (El cargo completo: lo que regresó y se descontó de la nota ya bajó lo que debe.)
  const [[cargo]] = await pool.query(
    "SELECT COALESCE(SUM(monto), 0) AS monto FROM credito_movimientos WHERE pedido_id = :id AND tipo = 'cargo'",
    { id: pedidoId }
  );
  const fiadoHoy = round2(cargo?.monto ?? 0);
  let debeEnCredito = 0;
  if (p.cliente_id && fiadoHoy > 0) {
    const deuda = (await clientesModel.aplicarAbonos(pool, p.cliente_id)).find((d) => d.pedidoId === Number(p.id));
    debeEnCredito = round2(deuda?.porPagar ?? 0);
  }

  const de = Number(p.nota_pendiente) ? 'Nota pendiente de pago'
    : Number(p.encargo) ? 'Nota en espera'
      : p.estado === 'apartado' || Number(p.inventario_descontado) === 0 ? 'Apartado'
        : 'Venta';
  return {
    id: Number(g.id),
    pedido: {
      id: Number(p.id), numero_pedido: p.numero_pedido, creado_en: p.creado_en, total, de, almacen: p.almacen,
    },
    cliente: p.cliente
      ? {
        id: Number(p.cliente_id), nombre: p.cliente, nombre_comercial: p.nombre_comercial, codigo: p.cliente_codigo,
        telefono: p.telefono, telefono_alt: p.telefono_alt,
      }
      : null,
    fecha: g.creado_en,
    monto: suma(grupo),
    metodo: g.metodo,
    referencia: g.referencia,
    // Cada forma con lo suyo (una sola, si se pagó con una).
    partes: grupo.map((x) => ({ metodo: x.metodo, monto: round2(x.monto), referencia: x.referencia })),
    credito: aCredito > 0.004 ? { monto: aCredito, dias: Number(cr.dias), vence_el: cr.vence_el } : null,
    llevaba_pagado: llevaba,
    pagado,
    falta: Math.max(0, round2(total - pagado - aCredito)),
    falta_hoy: round2(Math.max(0, round2(total - suma(pagos) - fiadoHoy)) + debeEnCredito),
    // De lo que falta hoy, lo que debe en su cuenta de crédito.
    falta_hoy_credito: debeEnCredito,
  };
}

module.exports = { pagoDeNota };
