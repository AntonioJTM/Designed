'use strict';

const { pool } = require('../../config/db');
// Lo que cuenta como VENTA es lo mismo que en Reportes → Venta por color.
const { KG_NETO, DEVUELTO, VENDIDO } = require('../reportes/model');

// ROTACIÓN DE INVENTARIO (2026-10-22): las consultas. SOLO KILOS: ninguna
// selecciona precio, importe, subtotal, total ni costo. Todo se trae agrupado
// (por día, hilo y almacén) en pocas consultas; las cuentas se hacen en JS
// (`cuentas.js`, `service.js`).

/** La fecha de la venta: el día que se entregó (una nota en espera), o el que se hizo. */
const DIA_VENTA = "DATE_FORMAT(COALESCE(ped.entregado_en, ped.creado_en), '%Y-%m-%d')";

/** Los hilos (`productos.id` = color + calibre), con su material. */
async function hilos() {
  const [rows] = await pool.query(
    `SELECT p.id, p.nombre AS color, p.grosor_calibre AS calibre, p.activo, cat.nombre AS material
       FROM productos p
       LEFT JOIN categorias cat ON cat.id = p.categoria_id
      ORDER BY p.nombre, p.grosor_calibre`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    color: r.color,
    calibre: r.calibre || '',
    material: r.material || null,
    activo: !!Number(r.activo),
  }));
}

/** Los almacenes; «vende» = tiene mostrador. */
async function almacenes() {
  const [rows] = await pool.query(
    'SELECT id, nombre, es_matriz, es_punto_venta, activo FROM almacenes ORDER BY es_matriz DESC, nombre'
  );
  return rows.map((a) => ({
    id: Number(a.id),
    nombre: a.nombre,
    es_matriz: !!Number(a.es_matriz),
    vende: !!Number(a.es_punto_venta),
    activo: !!Number(a.activo),
  }));
}

/** Los kilos VENDIDOS por día, hilo, almacén y presentación (sin lo que regresó). */
async function ventasPorDia() {
  const [rows] = await pool.query(
    `SELECT pv.producto_id, ped.almacen_id, pv.tipo_presentacion AS tipo, ${DIA_VENTA} AS dia,
            SUM(${KG_NETO}) AS kg
       FROM pedido_detalle d
       JOIN pedidos ped           ON ped.id = d.pedido_id
       JOIN producto_variantes pv ON pv.id = d.variante_id
       ${DEVUELTO}
      WHERE ${VENDIDO}
      GROUP BY pv.producto_id, ped.almacen_id, pv.tipo_presentacion, dia`
  );
  return rows
    .map((r) => ({ hilo: Number(r.producto_id), almacen: Number(r.almacen_id), tipo: r.tipo, dia: r.dia, kg: Number(r.kg) }))
    .filter((r) => r.kg > 0.0005);
}

/**
 * Lo que SURTIÓ un almacén a las tiendas, por día e hilo: las salidas por envío
 * (el traspaso descuenta del origen con un movimiento 'transferencia'). Es la
 * "venta" de un almacén que no tiene mostrador.
 */
async function surtidoPorDia() {
  const [rows] = await pool.query(
    `SELECT pv.producto_id, m.almacen_id, DATE_FORMAT(m.creado_en, '%Y-%m-%d') AS dia, -SUM(m.cantidad) AS kg
       FROM movimientos_inventario m
       JOIN producto_variantes pv ON pv.id = m.variante_id
      WHERE m.referencia_tipo = 'traspaso' AND m.tipo = 'transferencia' AND m.cantidad < 0
      GROUP BY pv.producto_id, m.almacen_id, dia`
  );
  return rows.map((r) => ({ hilo: Number(r.producto_id), almacen: Number(r.almacen_id), dia: r.dia, kg: Number(r.kg) }));
}

/** El kardex por día, hilo y almacén: con él se sabe cuánto había cada día. */
async function kardexPorDia() {
  const [rows] = await pool.query(
    `SELECT pv.producto_id, m.almacen_id, DATE_FORMAT(m.creado_en, '%Y-%m-%d') AS dia, SUM(m.cantidad) AS kg
       FROM movimientos_inventario m
       JOIN producto_variantes pv ON pv.id = m.variante_id
      GROUP BY pv.producto_id, m.almacen_id, dia
      ORDER BY dia`
  );
  return rows.map((r) => ({ hilo: Number(r.producto_id), almacen: Number(r.almacen_id), dia: r.dia, kg: Number(r.kg) }));
}

/** Lo que hay hoy (lo físico, como Inventario), por hilo, almacén y presentación. */
async function existencias() {
  const [rows] = await pool.query(
    `SELECT pv.producto_id, i.almacen_id, pv.tipo_presentacion AS tipo, SUM(i.cantidad) AS kg
       FROM inventario i
       JOIN producto_variantes pv ON pv.id = i.variante_id
      GROUP BY pv.producto_id, i.almacen_id, pv.tipo_presentacion`
  );
  return rows.map((r) => ({ hilo: Number(r.producto_id), almacen: Number(r.almacen_id), tipo: r.tipo, kg: Number(r.kg) }));
}

/** Lo que viene EN CAMINO entre almacenes (enviado sin recibir), por hilo y destino. */
async function enCamino() {
  const [rows] = await pool.query(
    `SELECT pv.producto_id, t.almacen_destino_id AS almacen, SUM(td.cantidad) AS kg
       FROM traspasos t
       JOIN traspaso_detalle td   ON td.traspaso_id = t.id
       JOIN producto_variantes pv ON pv.id = td.variante_id
      WHERE t.estado = 'en_transito'
      GROUP BY pv.producto_id, t.almacen_destino_id`
  );
  return rows.map((r) => ({ hilo: Number(r.producto_id), almacen: Number(r.almacen), kg: Number(r.kg) }));
}

/**
 * Los PAQUETES que hay (disponibles o apartados), por hilo y almacén, con su peso
 * promedio real. Y el peso de catálogo del paquete, para cuando no hay ninguno.
 */
async function paquetes() {
  const [[porAlmacen], [catalogo]] = await Promise.all([
    pool.query(
      `SELECT pv.producto_id, vc.almacen_id, COUNT(*) AS n, SUM(vc.peso_kg) AS kg
         FROM variante_codigos vc
         JOIN producto_variantes pv ON pv.id = vc.variante_id
        WHERE vc.estado IN ('disponible', 'apartado') AND pv.tipo_presentacion = 'paquete' AND vc.peso_kg > 0
        GROUP BY pv.producto_id, vc.almacen_id`
    ),
    pool.query(
      `SELECT producto_id, MAX(peso_kg) AS peso FROM producto_variantes
        WHERE tipo_presentacion = 'paquete' GROUP BY producto_id`
    ),
  ]);
  return {
    porAlmacen: porAlmacen.map((r) => ({ hilo: Number(r.producto_id), almacen: r.almacen_id == null ? null : Number(r.almacen_id), n: Number(r.n), kg: Number(r.kg) })),
    catalogo: new Map(catalogo.map((r) => [Number(r.producto_id), r.peso != null ? Number(r.peso) : null])),
  };
}

/** Las cargas del proveedor de un hilo (o de todos), de la más nueva a la más vieja. */
async function cargas(productoId = null) {
  const [rows] = await pool.query(
    `SELECT r.id, pv.producto_id, DATE_FORMAT(COALESCE(r.fecha_ingreso, r.creado_en), '%Y-%m-%d') AS fecha,
            r.kg_total AS kg, a.nombre AS almacen
       FROM remesas r
       JOIN producto_variantes pv ON pv.id = r.variante_id
       JOIN almacenes a           ON a.id = r.almacen_id
      ${productoId ? 'WHERE pv.producto_id = :p' : ''}
      ORDER BY fecha DESC, r.id DESC`,
    { p: productoId }
  );
  return rows.map((r) => ({ id: Number(r.id), hilo: Number(r.producto_id), fecha: r.fecha, kg: Number(r.kg), almacen: r.almacen }));
}

/** Las ventas de AÑOS ANTERIORES que se cargaron (kilos por hilo, mes y tienda). */
async function ventasAnteriores() {
  const [rows] = await pool.query('SELECT producto_id, almacen_id, anio, mes, kg FROM ventas_anteriores');
  return rows.map((r) => ({
    hilo: Number(r.producto_id),
    almacen: r.almacen_id == null ? null : Number(r.almacen_id),
    anio: Number(r.anio),
    mes: Number(r.mes),
    kg: Number(r.kg),
  }));
}

/** Las claves de los ajustes de «Qué pedir». */
const CLAVES_AJUSTES = ['rotacion_semanas_proveedor', 'rotacion_semanas_colchon', 'rotacion_meses_cubre',
  'rotacion_kg_contenedor', 'rotacion_ajustes_confirmados'];

async function ajustes() {
  const [rows] = await pool.query('SELECT clave, valor FROM configuracion WHERE clave IN (:c)', { c: CLAVES_AJUSTES });
  const v = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
  const num = (clave, respaldo) => {
    const n = Number(v[clave]);
    return v[clave] != null && String(v[clave]).trim() !== '' && Number.isFinite(n) ? n : respaldo;
  };
  return {
    semanas_proveedor: num('rotacion_semanas_proveedor', 10),
    semanas_colchon: num('rotacion_semanas_colchon', 3),
    meses_cubre: num('rotacion_meses_cubre', 4),
    kg_contenedor: v.rotacion_kg_contenedor != null && String(v.rotacion_kg_contenedor).trim() !== '' && Number(v.rotacion_kg_contenedor) > 0
      ? Number(v.rotacion_kg_contenedor) : null,
    confirmados: num('rotacion_ajustes_confirmados', 0) === 1,
  };
}

/** Guarda los cuatro ajustes y los da por confirmados. */
async function guardarAjustes(a) {
  const valores = {
    rotacion_semanas_proveedor: String(a.semanas_proveedor),
    rotacion_semanas_colchon: String(a.semanas_colchon),
    rotacion_meses_cubre: String(a.meses_cubre),
    rotacion_kg_contenedor: a.kg_contenedor == null ? '' : String(a.kg_contenedor),
    rotacion_ajustes_confirmados: '1',
  };
  for (const [clave, valor] of Object.entries(valores)) {
    await pool.query('UPDATE configuracion SET valor = :valor WHERE clave = :clave', { clave, valor });
  }
}

module.exports = {
  hilos, almacenes, ventasPorDia, surtidoPorDia, kardexPorDia, existencias, enCamino, paquetes, cargas,
  ventasAnteriores, ajustes, guardarAjustes, CLAVES_AJUSTES,
};
