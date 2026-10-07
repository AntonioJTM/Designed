'use strict';

/**
 * EL DETALLE DE UN HILO (2026-10-06). "Cuando doy clic en cualquier hilo, que me
 * diga los bultos que están y su lote; selecciono el lote y me da las
 * presentaciones que tiene cada uno" (usuario, desde Inventario → Detalle por
 * hilo).
 *
 * Tres niveles, de lo general a lo exacto:
 *   1. Cuánto hay del hilo en cada almacén, por presentación (paquete y cono):
 *      los SALDOS, que son la verdad. Junto a cada saldo de paquete, cuántos
 *      bultos están ubicados ahí, que es aproximado (la ubicación del bulto la
 *      corrigen el escaneo al vender, al desarmar y al surtir).
 *   2. Sus LOTES: de cada uno, lo que sigue en paquete (y dónde), lo que se bajó
 *      a conos, lo que se vendió en paquete, y en qué carga llegó.
 *   3. Los BULTOS de un lote, uno por uno (`bultosDeLote`).
 *
 * El cono no se lleva por lote: su saldo es uno por presentación y almacén. Del
 * lote se sabe cuántos paquetes se bajaron a conos y cuántos conos salieron, no
 * cuántos de esos conos quedan.
 */

const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');

const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

/** El lote vacío se agrupa como "sin lote"; viaja como null. */
const claveLote = (lote) => (lote == null || String(lote).trim() === '' ? null : String(lote));

async function _hilo(productoId) {
  const [[hilo]] = await pool.query(
    `SELECT p.id AS producto_id, p.nombre AS producto, p.grosor_calibre AS calibre,
            c.nombre AS material, l.nombre AS linea
       FROM productos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       LEFT JOIN lineas l     ON l.id = p.linea_id
      WHERE p.id = :id`,
    { id: productoId }
  );
  if (!hilo) throw new AppError(404, 'NO_ENCONTRADO', 'Ese hilo no existe');
  return hilo;
}

async function detalleHilo(productoId) {
  const hilo = await _hilo(productoId);

  // 1 · Las presentaciones y su saldo en cada almacén (los saldos son la verdad).
  const [presentaciones] = await pool.query(
    `SELECT pv.id AS variante_id, pv.sku, pv.tipo_presentacion, pv.peso_kg
       FROM producto_variantes pv
      WHERE pv.producto_id = :id
      ORDER BY FIELD(pv.tipo_presentacion, 'paquete', 'simple', 'cono'), pv.id`,
    { id: productoId }
  );
  const [saldos] = await pool.query(
    `SELECT i.variante_id, i.almacen_id, a.nombre AS almacen, i.cantidad, i.cantidad_reservada
       FROM inventario i
       JOIN producto_variantes pv ON pv.id = i.variante_id
       JOIN almacenes a           ON a.id = i.almacen_id
      WHERE pv.producto_id = :id AND (i.cantidad <> 0 OR i.cantidad_reservada <> 0)
      ORDER BY a.es_matriz DESC, a.id`,
    { id: productoId }
  );

  // Bultos por lote, estado y almacén: con eso se arma todo lo demás.
  const [grupos] = await pool.query(
    `SELECT vc.lote, vc.estado, vc.almacen_id, a.nombre AS almacen,
            COUNT(*) AS bultos, COALESCE(SUM(vc.peso_kg), 0) AS kg, COALESCE(SUM(vc.conos), 0) AS conos,
            MIN(vc.peso_kg) AS peso_min, MAX(vc.peso_kg) AS peso_max
       FROM variante_codigos vc
       JOIN producto_variantes pv ON pv.id = vc.variante_id
       LEFT JOIN almacenes a      ON a.id = vc.almacen_id
      WHERE pv.producto_id = :id
      GROUP BY vc.lote, vc.estado, vc.almacen_id, a.nombre`,
    { id: productoId }
  );

  // Lo que se bajó a conos, por lote: cuántos conos salieron y con cuánto destare.
  const [desarmes] = await pool.query(
    `SELECT vc.lote, COUNT(*) AS bultos, COALESCE(SUM(cv.kg_consumidos), 0) AS kg,
            COALESCE(SUM(cv.piezas_generadas), 0) AS conos, COALESCE(SUM(cv.destare_kg), 0) AS destare_kg
       FROM variante_codigos vc
       JOIN producto_variantes pv    ON pv.id = vc.variante_id
       JOIN variante_conversiones cv ON vc.consumido_tipo = 'conversion' AND cv.id = vc.consumido_id
      WHERE pv.producto_id = :id AND vc.estado = 'desarmado'
      GROUP BY vc.lote`,
    { id: productoId }
  );

  // En qué carga llegó cada lote (puede venir en varias).
  const [cargas] = await pool.query(
    `SELECT vc.lote, r.id AS remesa_id, r.folio, DATE_FORMAT(COALESCE(r.fecha_ingreso, r.creado_en), '%Y-%m-%d') AS fecha_ingreso,
            pr.nombre AS proveedor, COUNT(*) AS bultos
       FROM variante_codigos vc
       JOIN producto_variantes pv ON pv.id = vc.variante_id
       JOIN remesas r             ON r.id = vc.remesa_id
       LEFT JOIN proveedores pr   ON pr.id = r.proveedor_id
      WHERE pv.producto_id = :id
      GROUP BY vc.lote, r.id, r.folio, fecha_ingreso, pr.nombre
      ORDER BY fecha_ingreso, r.id`,
    { id: productoId }
  );

  // ---- Se arma la respuesta ----
  const porAlmacenDisponible = new Map(); // almacen_id → { bultos, kg }
  const lotes = new Map();
  const lote = (k) => {
    if (!lotes.has(k)) {
      lotes.set(k, {
        lote: k,
        bultos: 0,
        kg: 0,
        disponibles: { bultos: 0, kg: 0, conos: 0, por_almacen: [] },
        vendidos: { bultos: 0, kg: 0 },
        // Apartados para un pedido o un apartado: siguen en la tienda pero ya
        // tienen dueño (salen al entregarlo).
        apartados: { bultos: 0, kg: 0 },
        desarmados: { bultos: 0, kg: 0, conos: 0, destare_kg: 0 },
        peso_min: null,
        peso_max: null,
        cargas: [],
      });
    }
    return lotes.get(k);
  };

  for (const g of grupos) {
    const l = lote(claveLote(g.lote));
    const bultos = Number(g.bultos);
    const kg = Number(g.kg);
    l.bultos += bultos;
    l.kg = round3(l.kg + kg);
    if (g.peso_min != null) l.peso_min = l.peso_min == null ? Number(g.peso_min) : Math.min(l.peso_min, Number(g.peso_min));
    if (g.peso_max != null) l.peso_max = l.peso_max == null ? Number(g.peso_max) : Math.max(l.peso_max, Number(g.peso_max));
    if (g.estado === 'disponible') {
      l.disponibles.bultos += bultos;
      l.disponibles.kg = round3(l.disponibles.kg + kg);
      l.disponibles.conos += Number(g.conos);
      l.disponibles.por_almacen.push({ almacen_id: g.almacen_id, almacen: g.almacen ?? null, bultos, kg: round3(kg) });
      const k = g.almacen_id ?? 0;
      const a = porAlmacenDisponible.get(k) ?? { bultos: 0, kg: 0 };
      porAlmacenDisponible.set(k, { bultos: a.bultos + bultos, kg: round3(a.kg + kg) });
    } else if (g.estado === 'apartado') {
      l.apartados.bultos += bultos;
      l.apartados.kg = round3(l.apartados.kg + kg);
      // Siguen ahí: cuentan en los paquetes de ese almacén (el saldo los incluye).
      const k = g.almacen_id ?? 0;
      const a = porAlmacenDisponible.get(k) ?? { bultos: 0, kg: 0 };
      porAlmacenDisponible.set(k, { bultos: a.bultos + bultos, kg: round3(a.kg + kg) });
    } else if (g.estado === 'vendido') {
      l.vendidos.bultos += bultos;
      l.vendidos.kg = round3(l.vendidos.kg + kg);
    }
  }
  for (const d of desarmes) {
    const l = lote(claveLote(d.lote));
    l.desarmados = {
      bultos: Number(d.bultos),
      kg: round3(d.kg),
      conos: Number(d.conos),
      destare_kg: round3(d.destare_kg),
    };
  }
  for (const c of cargas) {
    lote(claveLote(c.lote)).cargas.push({
      remesa_id: c.remesa_id, folio: c.folio, fecha_ingreso: c.fecha_ingreso, proveedor: c.proveedor, bultos: Number(c.bultos),
    });
  }
  for (const l of lotes.values()) {
    l.disponibles.por_almacen.sort((a, b) => b.kg - a.kg);
  }

  const listaLotes = [...lotes.values()].sort(
    (a, b) =>
      // Los que todavía tienen paquetes primero (es lo que se busca), el más
      // cargado arriba; "sin lote" al final.
      Number(b.disponibles.bultos > 0) - Number(a.disponibles.bultos > 0) ||
      Number(a.lote === null) - Number(b.lote === null) ||
      b.disponibles.kg - a.disponibles.kg ||
      String(a.lote).localeCompare(String(b.lote))
  );

  return {
    hilo,
    presentaciones: presentaciones.map((p) => {
      const suyos = saldos.filter((s) => s.variante_id === p.variante_id);
      const conBultos = p.tipo_presentacion !== 'cono';
      return {
        variante_id: p.variante_id,
        sku: p.sku,
        tipo_presentacion: p.tipo_presentacion,
        peso_kg: p.peso_kg,
        total: round3(suyos.reduce((s, x) => s + Number(x.cantidad), 0)),
        existencias: suyos.map((s) => ({
          almacen_id: s.almacen_id,
          almacen: s.almacen,
          cantidad: round3(s.cantidad),
          reservada: round3(s.cantidad_reservada),
          // Los bultos que se cree que están ahí (aproximado). Solo el paquete los tiene.
          bultos: conBultos ? porAlmacenDisponible.get(s.almacen_id)?.bultos ?? 0 : null,
          kg_en_bultos: conBultos ? porAlmacenDisponible.get(s.almacen_id)?.kg ?? 0 : null,
        })),
      };
    }),
    lotes: listaLotes,
    resumen: {
      lotes: listaLotes.filter((l) => l.disponibles.bultos > 0).length,
      lotes_total: listaLotes.length,
      bultos_disponibles: listaLotes.reduce((s, l) => s + l.disponibles.bultos, 0),
      kg_en_bultos: round3(listaLotes.reduce((s, l) => s + l.disponibles.kg, 0)),
      // Disponibles sin almacén: capturados a mano o de antes de que el bulto supiera dónde está.
      sin_ubicar: porAlmacenDisponible.get(0)?.bultos ?? 0,
    },
  };
}

/**
 * Los bultos de UN lote del hilo (`lote` null = los que no traen lote), uno por
 * uno: su peso real, sus conos, dónde está o qué pasó con él, y en qué carga
 * llegó. Todos los estados: la pantalla filtra.
 */
async function bultosDeLote(productoId, lote) {
  await _hilo(productoId);
  const [rows] = await pool.query(
    `SELECT vc.id, vc.codigo, vc.peso_kg, vc.conos, vc.estado, vc.almacen_id, a.nombre AS almacen,
            pv.sku, pv.tipo_presentacion,
            r.folio AS carga_folio, DATE_FORMAT(COALESCE(r.fecha_ingreso, r.creado_en), '%Y-%m-%d') AS fecha_ingreso,
            vc.consumido_en, vc.consumido_tipo, vc.consumido_id,
            ped.numero_pedido AS pedido_folio,
            cv.piezas_generadas AS conos_generados
       FROM variante_codigos vc
       JOIN producto_variantes pv  ON pv.id = vc.variante_id
       LEFT JOIN almacenes a       ON a.id = vc.almacen_id
       LEFT JOIN remesas r         ON r.id = vc.remesa_id
       LEFT JOIN pedidos ped       ON vc.consumido_tipo = 'pedido' AND ped.id = vc.consumido_id
       LEFT JOIN variante_conversiones cv ON vc.consumido_tipo = 'conversion' AND cv.id = vc.consumido_id
      WHERE pv.producto_id = :id
        AND ${lote === null ? "(vc.lote IS NULL OR TRIM(vc.lote) = '')" : 'vc.lote = :lote'}
      ORDER BY FIELD(vc.estado, 'disponible', 'apartado', 'desarmado', 'vendido'), a.nombre, vc.codigo`,
    { id: productoId, lote }
  );
  return rows.map((b) => ({
    ...b,
    peso_kg: b.peso_kg == null ? null : round3(b.peso_kg),
    conos_generados: b.conos_generados == null ? null : Number(b.conos_generados),
  }));
}

module.exports = { detalleHilo, bultosDeLote };
