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

/**
 * Ventas agrupadas por día en el rango, con los KILOS que salieron.
 *
 * Los kilos van en una consulta aparte y se pegan por día: juntarlos en la
 * misma con un JOIN a `pedido_detalle` multiplicaría `COUNT(*)` y `SUM(total)`
 * por el número de renglones de cada pedido. `kilos_paquete` dice cuánto de eso
 * salió en paquete cerrado (el resto, en cono o a granel): es como la tienda
 * mide si vende a mayoreo o a mostrador.
 */
async function ventasPorDia(desde, hastaExcl) {
  const [[rows], [kilos]] = await Promise.all([
    pool.query(
      `SELECT DATE(creado_en) AS dia, COUNT(*) AS num_pedidos, COALESCE(SUM(total),0) AS total
         FROM pedidos
        WHERE creado_en >= :desde AND creado_en < :hasta AND ${VENTA_VALIDA}
        GROUP BY DATE(creado_en)
        ORDER BY dia`,
      { desde, hasta: hastaExcl }
    ),
    pool.query(
      `SELECT DATE(ped.creado_en) AS dia,
              COALESCE(SUM(d.cantidad), 0) AS kilos,
              COALESCE(SUM(CASE WHEN pv.tipo_presentacion = 'paquete' THEN d.cantidad ELSE 0 END), 0)
                AS kilos_paquete
         FROM pedido_detalle d
         JOIN pedidos ped           ON ped.id = d.pedido_id
         JOIN producto_variantes pv ON pv.id = d.variante_id
        WHERE ped.creado_en >= :desde AND ped.creado_en < :hasta
          AND ped.estado NOT IN ('cancelado','devuelto')
        GROUP BY DATE(ped.creado_en)`,
      { desde, hasta: hastaExcl }
    ),
  ]);
  const porDia = new Map(kilos.map((k) => [String(k.dia), k]));
  return rows.map((r) => ({
    ...r,
    kilos: porDia.get(String(r.dia))?.kilos ?? '0.000',
    kilos_paquete: porDia.get(String(r.dia))?.kilos_paquete ?? '0.000',
  }));
}

/** Productos más vendidos (vista v_mas_vendidos). */
async function masVendidos(limite) {
  // Con el calibre y la presentación: "ROJO" y "ROJO-2" no dicen qué hilo es,
  // y el mismo color en dos calibres son dos productos.
  const [rows] = await pool.query(
    `SELECT mv.*, p.grosor_calibre AS calibre, pv.tipo_presentacion
       FROM v_mas_vendidos mv
       JOIN producto_variantes pv ON pv.id = mv.variante_id
       JOIN productos p           ON p.id = pv.producto_id
      ORDER BY mv.unidades_vendidas DESC LIMIT :limite`,
    { limite }
  );
  return rows;
}

/** Productos por reabastecer: disponibles <= stock mínimo (vista v_alertas_stock). */
async function porReabastecer() {
  // Con el calibre y la presentación, igual que "Más vendidos": la vista solo
  // trae el color, y "ROJO" en dos calibres son dos hilos distintos que piden
  // reabastecerse por separado.
  const [rows] = await pool.query(
    `SELECT a.*, p.grosor_calibre AS calibre, pv.tipo_presentacion
       FROM v_alertas_stock a
       JOIN producto_variantes pv ON pv.id = a.variante_id
       JOIN productos p           ON p.id = pv.producto_id
      ORDER BY a.disponible - a.stock_minimo`
  );
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
