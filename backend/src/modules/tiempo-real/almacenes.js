'use strict';

const { pool } = require('../../config/db');

// DE QUÉ TIENDA ES LO QUE SE GUARDÓ (2026-10-19: "cada quien, sus tiendas" también
// en el aviso en vivo). Con eso el aviso le llega solo a quien ve esa tienda:
// alguien de Moroleón ya no se entera, ni con las herramientas del navegador, de
// CUÁNDO se vendió en otra tienda. Lo que no es de ninguna tienda en particular
// (catálogo, clientes —son compartidos—, un abono por transferencia) le llega a
// todos.

/** No se pudo saber de qué tienda es (falló la base): el aviso va solo a quien ve todas. */
const DESCONOCIDO = 'desconocido';

const num = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Las PISTAS de la tienda en la petición, sin ir a la base: almacenes del
 * formulario y los ids de la ruta que sí la saben (venta, turno, caja,
 * traspaso, carga, paquete). Pura: se prueba sola.
 */
function pistasDelCambio(ruta, cuerpo) {
  const b = cuerpo && typeof cuerpo === 'object' && !Buffer.isBuffer(cuerpo) ? cuerpo : {};
  const p = { almacenes: [], sesiones: [], pedido: null, caja: null, traspaso: null, remesa: null, bulto: null };
  for (const k of ['almacen_id', 'almacen_origen_id', 'almacen_destino_id']) {
    const n = num(b[k]);
    if (n && !p.almacenes.includes(n)) p.almacenes.push(n);
  }
  if (num(b.sesion_caja_id)) p.sesiones.push(num(b.sesion_caja_id));
  const r = String(ruta ?? '');
  let m;
  if ((m = r.match(/^\/pedidos\/(\d+)(\/|$)/))) p.pedido = Number(m[1]);
  if ((m = r.match(/^\/caja\/sesiones\/(\d+)(\/|$)/))) p.sesiones.push(Number(m[1]));
  if ((m = r.match(/^\/caja\/cajas\/(\d+)(\/|$)/))) p.caja = Number(m[1]);
  // Un gasto de la caja (2026-10-20): su tienda es la de su turno.
  if ((m = r.match(/^\/caja\/gastos\/(\d+)(\/|$)/))) p.gasto = Number(m[1]);
  if (r === '/caja/sesiones' && num(b.caja_id)) p.caja = num(b.caja_id);
  if ((m = r.match(/^\/inventario\/traspasos\/(\d+)(\/|$)/))) p.traspaso = Number(m[1]);
  if ((m = r.match(/^\/remesas\/(\d+)(\/|$)/))) p.remesa = Number(m[1]);
  if ((m = r.match(/^\/variantes\/codigos\/(\d+)(\/|$)/))) p.bulto = Number(m[1]);
  return p;
}

/** Las tiendas del cambio, o null si no es de ninguna en particular (le llega a todos). */
async function almacenesDelCambio(ruta, cuerpo) {
  // Transferencias suma todas las tiendas (y un abono por transferencia no tiene
  // tienda): lo que se marca ahí le llega solo a quien ve todas (2026-10-20).
  if (/^\/transferencias(\/|$)/.test(String(ruta ?? ''))) return DESCONOCIDO;
  // Rotación de inventario también suma todas las tiendas (2026-10-22).
  if (/^\/rotacion(\/|$)/.test(String(ruta ?? ''))) return DESCONOCIDO;
  const p = pistasDelCambio(ruta, cuerpo);
  const ids = new Set(p.almacenes);
  const una = async (sql, params) => {
    const [rows] = await pool.query(sql, params);
    for (const row of rows) for (const v of Object.values(row)) if (num(v)) ids.add(num(v));
  };
  if (p.pedido) await una('SELECT almacen_id FROM pedidos WHERE id = :id', { id: p.pedido });
  if (p.caja) await una('SELECT almacen_id FROM cajas WHERE id = :id', { id: p.caja });
  if (p.traspaso) {
    await una('SELECT almacen_origen_id, almacen_destino_id FROM traspasos WHERE id = :id', { id: p.traspaso });
  }
  if (p.remesa) await una('SELECT almacen_id FROM remesas WHERE id = :id', { id: p.remesa });
  if (p.bulto) await una('SELECT almacen_id FROM variante_codigos WHERE id = :id', { id: p.bulto });
  if (p.gasto) {
    await una(
      `SELECT c.almacen_id FROM gastos g JOIN sesiones_caja s ON s.id = g.sesion_caja_id
         JOIN cajas c ON c.id = s.caja_id WHERE g.id = :id`,
      { id: p.gasto }
    );
  }
  if (p.sesiones.length) {
    await una(
      'SELECT c.almacen_id FROM sesiones_caja s JOIN cajas c ON c.id = s.caja_id WHERE s.id IN (:ids)',
      { ids: p.sesiones }
    );
  }
  return ids.size ? [...ids] : null;
}

/**
 * Las tiendas del aviso: las de la petición antes y después de guardar y las
 * que se anotaron por dentro (`contexto.js`). Si alguna no se pudo saber, el
 * aviso es DESCONOCIDO; si no hay ninguna, null (le llega a todos).
 */
function juntarAlmacenes(antes, despues, anotados = []) {
  if (antes === DESCONOCIDO || despues === DESCONOCIDO) return DESCONOCIDO;
  const ids = new Set([...(antes || []), ...(despues || []), ...anotados].map(Number));
  return ids.size ? [...ids] : null;
}

module.exports = { pistasDelCambio, almacenesDelCambio, juntarAlmacenes, DESCONOCIDO };
