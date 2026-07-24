'use strict';

const { pool } = require('../../config/db');

// Reportes de solo lectura. Los pedidos cancelados/devueltos no cuentan como venta.
const VENTA_VALIDA = "estado NOT IN ('cancelado','devuelto')";

/** Resumen de ventas en un rango [desde, hastaExcl). */
async function ventasResumen(desde, hastaExcl) {
  const [[resumen]] = await pool.query(
    `SELECT COUNT(*) AS num_pedidos,
            COALESCE(SUM(subtotal),0)  AS subtotal,
            COALESCE(SUM(descuento),0) AS descuento,
            COALESCE(SUM(impuestos),0) AS impuestos,
            COALESCE(SUM(total),0)     AS total
       FROM pedidos
      WHERE creado_en >= :desde AND creado_en < :hasta AND ${VENTA_VALIDA}`,
    { desde, hasta: hastaExcl }
  );
  const [porCanal] = await pool.query(
    `SELECT canal, COUNT(*) AS num_pedidos, COALESCE(SUM(total),0) AS total
       FROM pedidos
      WHERE creado_en >= :desde AND creado_en < :hasta AND ${VENTA_VALIDA}
      GROUP BY canal`,
    { desde, hasta: hastaExcl }
  );
  return { resumen, porCanal };
}

/** Ventas agrupadas por día en el rango. */
async function ventasPorDia(desde, hastaExcl) {
  const [rows] = await pool.query(
    `SELECT DATE(creado_en) AS dia, COUNT(*) AS num_pedidos, COALESCE(SUM(total),0) AS total
       FROM pedidos
      WHERE creado_en >= :desde AND creado_en < :hasta AND ${VENTA_VALIDA}
      GROUP BY DATE(creado_en)
      ORDER BY dia`,
    { desde, hasta: hastaExcl }
  );
  return rows;
}

/** Productos más vendidos (vista v_mas_vendidos). */
async function masVendidos(limite) {
  const [rows] = await pool.query(
    `SELECT * FROM v_mas_vendidos ORDER BY unidades_vendidas DESC LIMIT :limite`,
    { limite }
  );
  return rows;
}

/** Productos por reabastecer: disponibles <= stock mínimo (vista v_alertas_stock). */
async function porReabastecer() {
  const [rows] = await pool.query('SELECT * FROM v_alertas_stock ORDER BY disponible - stock_minimo');
  return rows;
}

/** Cortes de caja (sesiones) en el rango, con el efectivo por ventas. */
async function cortesCaja(desde, hastaExcl) {
  const [rows] = await pool.query(
    `SELECT s.id, c.nombre AS caja, u.nombre AS usuario, s.estado,
            s.monto_inicial, s.monto_esperado, s.monto_final, s.diferencia,
            s.fecha_apertura, s.fecha_cierre,
            (SELECT COALESCE(SUM(mc.monto),0) FROM movimientos_caja mc
              WHERE mc.sesion_caja_id = s.id AND mc.tipo = 'venta') AS ventas_efectivo
       FROM sesiones_caja s
       JOIN cajas c    ON c.id = s.caja_id
       JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.fecha_apertura >= :desde AND s.fecha_apertura < :hasta
      ORDER BY s.fecha_apertura DESC`,
    { desde, hasta: hastaExcl }
  );
  return rows;
}

module.exports = { ventasResumen, ventasPorDia, masVendidos, porReabastecer, cortesCaja };
