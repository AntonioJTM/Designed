'use strict';

const { pool } = require('../../config/db');

// Las preguntas que la tienda se hace y hasta ahora tenía que contestar de
// memoria: a quién le debo cobrar, quién dejó de venir, qué hilo está parado y
// qué colores dejan dinero.
//
// Todo se calcula de la base al momento; no hay tablas de resumen que
// mantener al día ni un proceso nocturno que se pueda quedar atrás. Son
// consultas de lectura y el volumen de esta tienda las aguanta de sobra.

// Lo que no cuenta como venta en ningún análisis.
const ESTADOS_MUERTOS = "('cancelado', 'devuelto')";

// ---------------------------------------------------------------------------
//  1. Cobranza: quién debe, y desde cuándo
// ---------------------------------------------------------------------------

/**
 * La cartera por ANTIGÜEDAD. Los rangos son los que usa cualquier cobranza
 * (0-30, 31-60, 61-90, +90) y se miden desde el ÚLTIMO MOVIMIENTO del cliente:
 * si abonó hace una semana, su saldo no es "viejo" aunque el cargo sea de hace
 * meses — está pagando, y tratarlo como moroso sería injusto y llevaría a
 * cobrarle a quien no toca.
 *
 * `dias_sin_abonar` es lo que de verdad importa para decidir a quién llamar.
 */
async function cartera({ diasAviso = 30 } = {}) {
  const [rows] = await pool.query(
    `SELECT c.id AS cliente_id, c.codigo, c.nombre, c.nombre_comercial,
            c.telefono, c.limite_credito,
            s.saldo,
            -- Desde cuándo no da señales de vida en su cuenta.
            DATEDIFF(NOW(), COALESCE(ult.ultimo_movimiento, c.creado_en)) AS dias_sin_abonar,
            ult.ultimo_movimiento,
            s.ultimo_abono,
            (SELECT MAX(p.creado_en) FROM pedidos p
              WHERE p.cliente_id = c.id AND p.estado NOT IN ${ESTADOS_MUERTOS}) AS ultima_compra
       FROM v_clientes_saldo s
       JOIN clientes c ON c.id = s.cliente_id
       LEFT JOIN (
         SELECT cliente_id, MAX(creado_en) AS ultimo_movimiento
           FROM credito_movimientos GROUP BY cliente_id
       ) ult ON ult.cliente_id = c.id
      WHERE s.saldo > 0
      ORDER BY dias_sin_abonar DESC, s.saldo DESC`
  );

  // Los tramos se arman aquí y no en SQL: el corte lo decide el negocio y así
  // se puede cambiar sin tocar la consulta.
  const TRAMOS = [
    { clave: 'al_dia', etiqueta: 'Al día (0-30 días)', hasta: 30 },
    { clave: 'un_mes', etiqueta: '31 a 60 días', hasta: 60 },
    { clave: 'dos_meses', etiqueta: '61 a 90 días', hasta: 90 },
    { clave: 'vencido', etiqueta: 'Más de 90 días', hasta: Infinity },
  ];
  const porTramo = TRAMOS.map((t) => ({ ...t, hasta: undefined, monto: 0, clientes: 0 }));

  for (const r of rows) {
    const dias = Number(r.dias_sin_abonar);
    const i = TRAMOS.findIndex((t) => dias <= t.hasta);
    const idx = i === -1 ? TRAMOS.length - 1 : i;
    porTramo[idx].monto = Math.round((porTramo[idx].monto + Number(r.saldo)) * 100) / 100;
    porTramo[idx].clientes += 1;
    r.tramo = TRAMOS[idx].clave;
  }

  const total = Math.round(rows.reduce((s, r) => s + Number(r.saldo), 0) * 100) / 100;
  const porAvisar = rows.filter((r) => Number(r.dias_sin_abonar) >= diasAviso);

  return {
    total_por_cobrar: total,
    num_clientes: rows.length,
    // Lo que se pasó del plazo que la tienda considere razonable.
    vencido: Math.round(porAvisar.reduce((s, r) => s + Number(r.saldo), 0) * 100) / 100,
    num_vencidos: porAvisar.length,
    dias_aviso: diasAviso,
    por_antiguedad: porTramo,
    clientes: rows,
  };
}

// ---------------------------------------------------------------------------
//  2. Clientes que no han vuelto
// ---------------------------------------------------------------------------

/**
 * Quién compraba y dejó de venir.
 *
 * No basta con "no ha comprado en 60 días": un cliente que vino UNA vez hace
 * tres meses no es un cliente perdido, es alguien que pasó. El filtro exige al
 * menos `minCompras` compras —que era un cliente de verdad— y compara los días
 * sin venir contra SU PROPIO ritmo: si compraba cada 30 días y llevan 90, es
 * tres veces su costumbre y eso sí es una señal.
 */
async function clientesEnfriados({ dias = 60, minCompras = 2, limite = 50 } = {}) {
  const [rows] = await pool.query(
    `SELECT c.id AS cliente_id, c.codigo, c.nombre, c.nombre_comercial, c.telefono,
            DATE_FORMAT(c.cliente_desde, '%Y-%m-%d') AS cliente_desde,
            v.num_compras, v.total_comprado, v.primera_compra, v.ultima_compra,
            DATEDIFF(NOW(), v.ultima_compra) AS dias_sin_venir,
            -- Cada cuántos días compraba, en promedio: el lapso entre su
            -- primera y su última compra, repartido entre los intervalos.
            CASE WHEN v.num_compras > 1
                 THEN ROUND(DATEDIFF(v.ultima_compra, v.primera_compra) / (v.num_compras - 1))
                 ELSE NULL END AS cada_cuantos_dias,
            COALESCE(s.saldo, 0) AS saldo
       FROM clientes c
       JOIN (
         SELECT cliente_id,
                COUNT(*) AS num_compras,
                SUM(total) AS total_comprado,
                MIN(creado_en) AS primera_compra,
                MAX(creado_en) AS ultima_compra
           FROM pedidos
          WHERE cliente_id IS NOT NULL AND estado NOT IN ${ESTADOS_MUERTOS}
          GROUP BY cliente_id
       ) v ON v.cliente_id = c.id
       LEFT JOIN v_clientes_saldo s ON s.cliente_id = c.id
      WHERE c.activo = 1
        AND v.num_compras >= :minCompras
        AND DATEDIFF(NOW(), v.ultima_compra) >= :dias
      ORDER BY v.total_comprado DESC, dias_sin_venir DESC
      LIMIT :limite`,
    { dias, minCompras, limite }
  );

  // Cuántas veces su propio ritmo lleva sin venir. Es el dato que distingue al
  // que se enfrió del que simplemente compra poco seguido.
  for (const r of rows) {
    const ritmo = Number(r.cada_cuantos_dias);
    r.veces_su_ritmo = ritmo > 0
      ? Math.round((Number(r.dias_sin_venir) / ritmo) * 10) / 10
      : null;
  }

  return {
    dias, min_compras: minCompras,
    num_clientes: rows.length,
    // Cuánto compraban al año los que se fueron: el tamaño del hueco.
    venta_en_riesgo: Math.round(rows.reduce((s, r) => s + Number(r.total_comprado), 0) * 100) / 100,
    clientes: rows,
  };
}

// ---------------------------------------------------------------------------
//  3. Hilo muerto: qué está parado y cuánto dinero hay ahí
// ---------------------------------------------------------------------------

/**
 * Existencias que no se mueven.
 *
 * El dinero parado se valora AL COSTO cuando se conoce (es lo que de verdad
 * está inmovilizado) y al precio de venta cuando no, marcándolo con
 * `valorado_a` para que la pantalla no presente una cifra como si fuera lo que
 * no es.
 *
 * Un hilo que NUNCA se ha vendido cuenta como parado desde que entró: es el
 * caso más importante —comprado y nunca movido— y filtrarlo por "última venta"
 * lo dejaría fuera justo por no tener ninguna.
 */
async function hiloMuerto({ dias = 90, limite = 50 } = {}) {
  const [rows] = await pool.query(
    `SELECT p.id AS producto_id, p.nombre AS color, p.grosor_calibre AS calibre,
            cat.nombre AS material, l.nombre AS linea,
            pv.id AS variante_id, pv.sku, pv.presentacion, pv.tipo_presentacion,
            pv.precio, pv.costo,
            SUM(i.cantidad) AS kilos,
            mh.ultima_salida, mh.ultima_entrada, mh.kg_vendidos_historico,
            -- Desde cuándo está parado: desde la última venta, o desde que
            -- entró si nunca se ha vendido.
            DATEDIFF(NOW(), COALESCE(mh.ultima_salida, mh.ultima_entrada, pv.creado_en)) AS dias_parado,
            (mh.ultima_salida IS NULL) AS nunca_vendido,
            ROUND(SUM(i.cantidad) * COALESCE(pv.costo, pv.precio), 2) AS dinero_parado,
            CASE WHEN pv.costo IS NULL THEN 'precio_venta' ELSE 'costo' END AS valorado_a
       FROM inventario i
       JOIN producto_variantes pv  ON pv.id = i.variante_id
       JOIN productos p            ON p.id = pv.producto_id
       LEFT JOIN categorias cat    ON cat.id = p.categoria_id
       LEFT JOIN lineas l          ON l.id = p.linea_id
       LEFT JOIN v_movimiento_hilo mh ON mh.variante_id = pv.id
      WHERE i.cantidad > 0
      GROUP BY pv.id, p.id, p.nombre, p.grosor_calibre, cat.nombre, l.nombre,
               pv.sku, pv.presentacion, pv.tipo_presentacion, pv.precio, pv.costo,
               mh.ultima_salida, mh.ultima_entrada, mh.kg_vendidos_historico, pv.creado_en
      HAVING dias_parado >= :dias
      ORDER BY dinero_parado DESC
      LIMIT :limite`,
    { dias, limite }
  );

  const total = Math.round(rows.reduce((s, r) => s + Number(r.dinero_parado), 0) * 100) / 100;
  const kilos = Math.round(rows.reduce((s, r) => s + Number(r.kilos), 0) * 1000) / 1000;

  return {
    dias,
    dinero_parado: total,
    kilos_parados: kilos,
    num_hilos: rows.length,
    nunca_vendidos: rows.filter((r) => r.nunca_vendido).length,
    // Si algún renglón se valoró a precio de venta, la cifra total está
    // inflada respecto al costo real y la pantalla tiene que decirlo.
    hay_sin_costo: rows.some((r) => r.valorado_a === 'precio_venta'),
    hilos: rows,
  };
}

// ---------------------------------------------------------------------------
//  4. Margen por hilo
// ---------------------------------------------------------------------------

/**
 * Qué colores dejan dinero.
 *
 * Solo cuenta las líneas con `costo_unitario` capturado: sin costo no hay
 * margen, y suponerlo cero daría un margen del 100% que llevaría a decisiones
 * equivocadas. Las líneas sin costo se cuentan aparte para que la pantalla
 * pueda avisar cuánta venta está quedando fuera del análisis.
 */
async function margenPorHilo({ desde, hasta, limite = 50 } = {}) {
  const where = [`ped.estado NOT IN ${ESTADOS_MUERTOS}`];
  const params = { limite };
  if (desde) { where.push('ped.creado_en >= :desde'); params.desde = desde; }
  if (hasta) { where.push('ped.creado_en < DATE_ADD(:hasta, INTERVAL 1 DAY)'); params.hasta = hasta; }
  const whereSql = where.join(' AND ');

  const [rows] = await pool.query(
    `SELECT p.id AS producto_id, p.nombre AS color, p.grosor_calibre AS calibre,
            cat.nombre AS material, l.nombre AS linea,
            SUM(d.cantidad) AS kilos,
            SUM(d.subtotal) AS venta,
            SUM(d.cantidad * d.costo_unitario) AS costo,
            SUM(d.subtotal - d.cantidad * d.costo_unitario) AS ganancia,
            -- Margen sobre la VENTA (no sobre el costo): es como se lee un
            -- margen comercial y permite comparar hilos entre sí.
            ROUND(
              100 * SUM(d.subtotal - d.cantidad * d.costo_unitario)
                  / NULLIF(SUM(d.subtotal), 0), 1
            ) AS margen_pct,
            COUNT(DISTINCT ped.id) AS num_ventas
       FROM pedido_detalle d
       JOIN pedidos ped            ON ped.id = d.pedido_id
       JOIN producto_variantes pv  ON pv.id = d.variante_id
       JOIN productos p            ON p.id = pv.producto_id
       LEFT JOIN categorias cat    ON cat.id = p.categoria_id
       LEFT JOIN lineas l          ON l.id = p.linea_id
      WHERE ${whereSql} AND d.costo_unitario IS NOT NULL
      GROUP BY p.id, p.nombre, p.grosor_calibre, cat.nombre, l.nombre
      ORDER BY ganancia DESC
      LIMIT :limite`,
    params
  );

  // Lo que quedó fuera por no tener costo capturado.
  const [[sinCosto]] = await pool.query(
    `SELECT COUNT(*) AS lineas, COALESCE(SUM(d.subtotal), 0) AS venta
       FROM pedido_detalle d
       JOIN pedidos ped ON ped.id = d.pedido_id
      WHERE ${whereSql} AND d.costo_unitario IS NULL`,
    params
  );

  const venta = Math.round(rows.reduce((s, r) => s + Number(r.venta), 0) * 100) / 100;
  const ganancia = Math.round(rows.reduce((s, r) => s + Number(r.ganancia), 0) * 100) / 100;

  return {
    desde: desde ?? null,
    hasta: hasta ?? null,
    venta_analizada: venta,
    ganancia: ganancia,
    margen_pct: venta > 0 ? Math.round((100 * ganancia / venta) * 10) / 10 : null,
    // Cuánta venta no se pudo analizar. Si es alta, el margen de arriba no
    // representa al negocio y hay que decirlo.
    sin_costo_lineas: Number(sinCosto.lineas),
    sin_costo_venta: Number(sinCosto.venta),
    hilos: rows,
  };
}

module.exports = { cartera, clientesEnfriados, hiloMuerto, margenPorHilo };
