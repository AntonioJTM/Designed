'use strict';

const { pool } = require('../../config/db');
const { porPalabras } = require('../../utils/query');

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

/**
 * Lo que cuenta como VENDIDO en "Venta por color": lo que de verdad SALIÓ del
 * inventario. Ni lo cancelado ni lo devuelto (regresó al almacén), ni un
 * apartado que todavía no se entrega (`inventario_descontado = 0`: la
 * mercancía sigue en la bodega, solo está reservada).
 *
 * OJO: es más estricto que "Ventas por día" y que "Más vendidos" (la vista
 * v_mas_vendidos), que solo excluyen cancelado/devuelto y sí cuentan el
 * apartado sin entregar. Aquí no, porque el reporte compara lo vendido contra
 * lo que QUEDA en inventario, y un apartado sin entregar todavía está en las
 * existencias: contarlo en los dos lados lo sumaría dos veces. Por eso los
 * kilos de este reporte pueden salir un poco abajo de los de "Ventas por día".
 * El rango va por `pedidos.creado_en` (el apartado entregado cuenta el día que
 * se apartó), igual que los demás reportes.
 */
const VENDIDO = "ped.estado NOT IN ('cancelado','devuelto') AND ped.inventario_descontado = 1";

/**
 * Venta por color: un renglón por HILO (`productos.id` = color + calibre) con
 * todas sus presentaciones sumadas —paquete y cono, las dos en kilos—. Se
 * agrupa por `producto_id`, nunca por nombre: "ROJO 1/30" y "ROJO 2/30" son
 * dos hilos.
 *
 * Salen los hilos que vendieron algo en el rango y TAMBIÉN los que tienen
 * existencias sin haber vendido nada (0% del periodo es una respuesta). `q`
 * busca por palabras en color, calibre, material y línea.
 *
 * Devuelve los renglones crudos y lo vendido en el periodo por TODOS los hilos
 * (sin el filtro de `q`), que es contra lo que se mide el "% del periodo".
 */
async function ventaPorColor(desde, hastaExcl, q) {
  const params = { desde, hasta: hastaExcl };
  const where = ['(COALESCE(v.kg_periodo, 0) > 0 OR COALESCE(e.existencia, 0) > 0)'];
  const busca = porPalabras(q, [
    'p.nombre', { col: 'p.grosor_calibre', calibre: true }, 'cat.nombre', 'l.nombre',
  ]);
  if (busca) {
    where.push(busca.sql);
    Object.assign(params, busca.params);
  }

  const [[filas], [[periodo]]] = await Promise.all([
    pool.query(
      `SELECT p.id AS producto_id, p.nombre AS color, p.grosor_calibre AS calibre,
              cat.nombre AS material, l.nombre AS linea,
              COALESCE(v.kg_periodo, 0) AS kg_vendidos,
              COALESCE(v.importe, 0)    AS importe,
              COALESCE(v.kg_total, 0)   AS vendido_total,
              COALESCE(e.existencia, 0) AS existencia,
              v.ultima_venta
         FROM productos p
         LEFT JOIN categorias cat ON cat.id = p.categoria_id
         LEFT JOIN lineas l       ON l.id = p.linea_id
         LEFT JOIN (
           -- Lo vendido de cada hilo: en el rango y desde siempre, en una pasada.
           SELECT pv.producto_id,
                  SUM(CASE WHEN ped.creado_en >= :desde AND ped.creado_en < :hasta
                           THEN d.cantidad ELSE 0 END) AS kg_periodo,
                  SUM(CASE WHEN ped.creado_en >= :desde AND ped.creado_en < :hasta
                           THEN d.subtotal ELSE 0 END) AS importe,
                  SUM(d.cantidad) AS kg_total,
                  DATE_FORMAT(MAX(ped.creado_en), '%Y-%m-%d') AS ultima_venta
             FROM pedido_detalle d
             JOIN pedidos ped           ON ped.id = d.pedido_id
             JOIN producto_variantes pv ON pv.id = d.variante_id
            WHERE ${VENDIDO}
            GROUP BY pv.producto_id
         ) v ON v.producto_id = p.id
         LEFT JOIN (
           -- Lo que hay hoy, en todos los almacenes y todas sus presentaciones.
           SELECT pv.producto_id, SUM(i.cantidad) AS existencia
             FROM inventario i
             JOIN producto_variantes pv ON pv.id = i.variante_id
            GROUP BY pv.producto_id
         ) e ON e.producto_id = p.id
        WHERE ${where.join(' AND ')}`,
      params
    ),
    pool.query(
      `SELECT COALESCE(SUM(d.cantidad), 0) AS kg_vendidos, COALESCE(SUM(d.subtotal), 0) AS importe
         FROM pedido_detalle d
         JOIN pedidos ped ON ped.id = d.pedido_id
        WHERE ${VENDIDO} AND ped.creado_en >= :desde AND ped.creado_en < :hasta`,
      { desde, hasta: hastaExcl }
    ),
  ]);
  return { filas, periodo };
}

module.exports = { ventasResumen, ventasPorDia, masVendidos, porReabastecer, cortesCaja, ventaPorColor };
