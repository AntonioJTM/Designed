'use strict';

const { pool } = require('../../config/db');
const cajaModel = require('../caja/model');

// La pantalla Hoy: lo que pasó en el día y lo que está esperando a alguien.
// Los pendientes son los de la campana (`/notificaciones`); aquí va lo del día.
const MUERTOS = "('cancelado', 'devuelto')";
const r2 = (n) => Math.round(Number(n) * 100) / 100;

async function resumen() {
  const [[vendido]] = await pool.query(
    `SELECT COUNT(*) AS ventas, COALESCE(SUM(total), 0) AS total
       FROM pedidos WHERE estado NOT IN ${MUERTOS} AND DATE(creado_en) = CURDATE()`
  );
  const [horas] = await pool.query(
    `SELECT HOUR(creado_en) AS hora, COUNT(*) AS n
       FROM pedidos WHERE estado NOT IN ${MUERTOS} AND DATE(creado_en) = CURDATE()
      GROUP BY hora`
  );
  const [turnos] = await pool.query(
    `SELECT s.id, c.nombre AS caja, a.nombre AS almacen, u.nombre AS usuario,
            s.fecha_apertura, s.monto_inicial,
            (SELECT COUNT(*) FROM pedidos p WHERE p.sesion_caja_id = s.id AND p.estado NOT IN ${MUERTOS}) AS ventas
       FROM sesiones_caja s
       JOIN cajas c     ON c.id = s.caja_id
       JOIN almacenes a ON a.id = c.almacen_id
       JOIN usuarios u  ON u.id = s.usuario_id
      WHERE s.estado = 'abierta'
      ORDER BY c.nombre`
  );
  // De 9 a 18 h siempre (el horario de la tienda); si se vendió fuera, se agrega.
  const lista = [...new Set([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, ...horas.map((h) => Number(h.hora))])].sort((a, b) => a - b);
  const cajas = [];
  for (const t of turnos) {
    const { neto } = await cajaModel.totalesSesion(t.id);
    cajas.push({ ...t, ventas: Number(t.ventas), esperado: r2(Number(t.monto_inicial) + neto) });
  }
  return {
    vendido_hoy: { ventas: Number(vendido.ventas), total: r2(vendido.total) },
    por_hora: lista.map((h) => ({ hora: h, n: Number(horas.find((x) => Number(x.hora) === h)?.n ?? 0) })),
    cajas,
    en_cajas: r2(cajas.reduce((s, c) => s + c.esperado, 0)),
  };
}

module.exports = { resumen };
