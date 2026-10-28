'use strict';

const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const { leerHoja } = require('../../utils/xlsx');
const { hoyLocal } = require('../../utils/fechas');
const lista = require('../remesas/lista');

// VENTAS DE AÑOS ANTERIORES (2026-10-22, parte 2 de Rotación de inventario):
// "para no esperar un año a ver la temporada". Un .xlsx con un renglón por hilo,
// mes y (si se quiere) tienda: Hilo (el color), Calibre, Año, Mes (número o
// nombre), Kilos y Tienda (opcional; vacía = todas las tiendas). Se ve primero una
// VISTA PREVIA con lo que no se entiende; se carga solo si no hay errores.
//
// El hilo se reconoce con la MISMA regla que la carga del proveedor
// (`remesas/lista.js → catalogo/empatar`: color + calibre, sin importar
// mayúsculas, acentos ni "2-30"/"2/30"). En un mes donde el sistema ya tiene
// ventas de ese hilo, mandan las del sistema: se carga, pero las cuentas lo
// ignoran (y la vista previa lo dice). Cargar otra vez el mismo hilo, mes y
// tienda REEMPLAZA lo que había.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** El mes de una celda: 1–12, "enero", "ene", "Ene.", "SEPT"… (null si no se entiende). */
function leerMes(v) {
  const s = sinAcentos(v).replace(/\.$/, '');
  if (!s) return null;
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= 12 ? n : null;
  }
  const i = MESES.findIndex((m) => m === s || (s.length >= 3 && m.startsWith(s)) || (s === 'sept' && m === 'septiembre'));
  return i >= 0 ? i + 1 : null;
}

/** Un número de una celda ("1,234.5", "1234,5", "1 234"): null si no lo es. */
function leerNumero(v) {
  let s = String(v ?? '').trim().replace(/\s/g, '').replace(/kg$/i, '');
  if (!s) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Busca el renglón de los encabezados y a qué columna va cada dato. */
function _columnas(filas) {
  const quien = {
    hilo: /^(hilo|color)$/, calibre: /^calibre$/, anio: /^(ano|anio|year)$/, mes: /^mes$/,
    kg: /^(kilos|kg|kgs|kilogramos)$/, tienda: /^(tienda|almacen|sucursal)$/,
  };
  for (const f of filas.slice(0, 15)) {
    const col = {};
    for (const [letra, valor] of Object.entries(f.celdas)) {
      const t = sinAcentos(valor).replace(/[^a-z]/g, '');
      for (const [campo, re] of Object.entries(quien)) if (!col[campo] && re.test(t)) col[campo] = letra;
    }
    if (col.hilo && col.anio && col.mes && col.kg) return { fila: f.fila, col };
  }
  return null;
}

/**
 * Lee el archivo y dice qué se va a cargar. No toca la base. Cada renglón sale
 * con su estado: 'ok', 'aviso' (se carga, pero ojo) o 'error' (impide cargar).
 */
async function previa(buffer) {
  let hoja;
  try {
    hoja = leerHoja(buffer);
  } catch {
    throw new AppError(422, 'ARCHIVO_INVALIDO', 'No se pudo leer el archivo: tiene que ser un Excel (.xlsx).');
  }
  const enc = _columnas(hoja.filas);
  if (!enc) {
    throw new AppError(422, 'FALTAN_COLUMNAS',
      'No encontré los encabezados. La primera fila tiene que decir: Hilo, Calibre, Año, Mes, Kilos y, si quieres, Tienda.');
  }
  const { col } = enc;
  const catalogo = await lista.catalogo();
  const [almacenes] = await pool.query('SELECT id, nombre FROM almacenes WHERE es_punto_venta = 1');
  const hoy = hoyLocal();
  const [ah, mh] = hoy.split('-').map(Number);
  // Los meses en que el sistema ya tiene ventas de cada hilo: ahí mandan las suyas.
  const [conSistema] = await pool.query(
    `SELECT DISTINCT pv.producto_id, DATE_FORMAT(COALESCE(ped.entregado_en, ped.creado_en), '%Y-%m') AS mes
       FROM pedido_detalle d
       JOIN pedidos ped           ON ped.id = d.pedido_id
       JOIN producto_variantes pv ON pv.id = d.variante_id
      WHERE ped.estado NOT IN ('cancelado','devuelto') AND ped.inventario_descontado = 1`
  );
  const sistema = new Set(conSistema.map((r) => `${r.producto_id}|${r.mes}`));
  const [ya] = await pool.query('SELECT producto_id, almacen_id, anio, mes, kg FROM ventas_anteriores');
  const cargado = new Map(ya.map((r) => [`${r.producto_id}|${r.almacen_id ?? ''}|${r.anio}|${r.mes}`, Number(r.kg)]));

  const renglones = [];
  const vistos = new Map();
  for (const f of hoja.filas.filter((x) => x.fila > enc.fila)) {
    const v = (c) => (col[c] ? f.celdas[col[c]] ?? '' : '');
    if (!v('hilo') && !v('anio') && !v('mes') && !v('kg')) continue;
    const r = { fila: f.fila, hilo_excel: `${v('hilo')}${v('calibre') ? ' ' + v('calibre') : ''}`.trim(), estado: 'ok', mensajes: [] };
    const error = (m) => { r.estado = 'error'; r.mensajes.push(m); };
    const aviso = (m) => { if (r.estado === 'ok') r.estado = 'aviso'; r.mensajes.push(m); };

    // El hilo.
    if (!v('hilo')) error('Falta el hilo (el color).');
    else {
      const { producto, ambiguos } = lista.empatar(catalogo, v('hilo'), v('calibre'));
      if (producto) {
        r.producto_id = Number(producto.id);
        r.hilo = `${producto.nombre}${producto.calibre ? ' ' + producto.calibre : ''}`;
      } else if (ambiguos.length) error(`Hay ${ambiguos.length} hilos «${r.hilo_excel}» en el catálogo: deja uno solo.`);
      else error(`No existe el hilo «${r.hilo_excel}» en el catálogo${v('calibre') ? '' : ' (¿falta el calibre?)'}.`);
    }
    // El año y el mes: ya pasados.
    const anio = leerNumero(v('anio'));
    const mes = leerMes(v('mes'));
    if (!Number.isInteger(anio) || anio < 2000 || anio > ah) error(`El año «${v('anio')}» no se entiende.`);
    else r.anio = anio;
    if (!mes) error(`El mes «${v('mes')}» no se entiende (escribe 1 a 12 o su nombre).`);
    else r.mes = mes;
    if (r.anio && r.mes && r.anio * 12 + r.mes >= ah * 12 + mh) error('Ese mes todavía no termina: solo se cargan meses pasados.');
    // Los kilos.
    const kg = leerNumero(v('kg'));
    if (kg == null) error('Faltan los kilos.');
    else if (!(kg > 0)) error('Los kilos tienen que ser más de 0.');
    else r.kg = Math.round(kg * 1000) / 1000;
    // La tienda (opcional): vacía = todas.
    r.almacen_id = null;
    r.tienda = 'Todas las tiendas';
    if (v('tienda')) {
      const t = sinAcentos(v('tienda'));
      const a = almacenes.find((x) => sinAcentos(x.nombre) === t) ?? almacenes.find((x) => sinAcentos(x.nombre).includes(t));
      if (a) {
        r.almacen_id = Number(a.id);
        r.tienda = a.nombre;
      } else error(`No existe la tienda «${v('tienda')}».`);
    }
    if (r.estado !== 'error') {
      const clave = `${r.producto_id}|${r.almacen_id ?? ''}|${r.anio}|${r.mes}`;
      if (vistos.has(clave)) error(`Repetido: ya viene en el renglón ${vistos.get(clave)}.`);
      else vistos.set(clave, r.fila);
      if (sistema.has(`${r.producto_id}|${r.anio}-${String(r.mes).padStart(2, '0')}`)) {
        aviso('Ya hay ventas del sistema en ese mes: se ignora.');
      }
      if (cargado.has(clave)) aviso(`Ya estaba cargado (${cargado.get(clave).toLocaleString('es-MX')} kg): se reemplaza.`);
    }
    renglones.push(r);
  }
  // El mismo hilo y mes "para todas las tiendas" Y por tienda: en el total se sumarían
  // los dos (2026-10-26, auditoría). Se avisa en los renglones de ese mes.
  const porMes = new Map();
  for (const r of renglones) {
    if (r.estado === 'error' || r.producto_id == null) continue;
    const k = `${r.producto_id}|${r.anio}|${r.mes}`;
    if (!porMes.has(k)) porMes.set(k, []);
    porMes.get(k).push(r);
  }
  for (const lista of porMes.values()) {
    if (!lista.some((r) => r.almacen_id == null) || !lista.some((r) => r.almacen_id != null)) continue;
    for (const r of lista) {
      if (r.estado === 'ok') r.estado = 'aviso';
      r.mensajes.push('Ese mes viene para todas las tiendas y también por tienda: en el total se sumarían los dos. Deja uno.');
    }
  }
  const validos = renglones.filter((r) => r.estado !== 'error');
  const meses = validos.map((r) => `${r.anio}-${String(r.mes).padStart(2, '0')}`).sort();
  return {
    renglones,
    errores: renglones.length - validos.length,
    validos: validos.length,
    kg: Math.round(validos.reduce((s, r) => s + r.kg, 0)),
    hilos: new Set(validos.map((r) => r.producto_id)).size,
    desde: meses[0] ?? null,
    hasta: meses[meses.length - 1] ?? null,
    se_puede: validos.length > 0 && renglones.length === validos.length,
  };
}

/** Carga lo del archivo (si no tiene errores). Lo del mismo hilo, mes y tienda se reemplaza. */
async function confirmar(buffer, usuarioId) {
  const p = await previa(buffer);
  if (!p.validos) throw new AppError(422, 'ARCHIVO_VACIO', 'El archivo no trae ningún renglón para cargar.');
  if (p.errores) {
    throw new AppError(422, 'ARCHIVO_CON_ERRORES',
      `Hay ${p.errores} ${p.errores === 1 ? 'renglón que no se entiende' : 'renglones que no se entienden'}: corrígelos en el Excel y súbelo otra vez.`);
  }
  await withTransaction(async (conn) => {
    for (const r of p.renglones) {
      await conn.query(
        `DELETE FROM ventas_anteriores
          WHERE producto_id = :p AND anio = :a AND mes = :m AND almacen_id <=> :al`,
        { p: r.producto_id, a: r.anio, m: r.mes, al: r.almacen_id }
      );
      await conn.query(
        `INSERT INTO ventas_anteriores (producto_id, almacen_id, anio, mes, kg, usuario_id)
         VALUES (:p, :al, :a, :m, :kg, :u)`,
        { p: r.producto_id, al: r.almacen_id, a: r.anio, m: r.mes, kg: r.kg, u: usuarioId ?? null }
      );
    }
  });
  return { cargados: p.validos, kg: p.kg, hilos: p.hilos, desde: p.desde, hasta: p.hasta };
}

/** Lo que hay cargado: cuántos renglones, kilos, hilos y de qué mes a qué mes. */
async function resumen() {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS renglones, COALESCE(SUM(kg), 0) AS kg, COUNT(DISTINCT producto_id) AS hilos,
            MIN(anio * 100 + mes) AS desde, MAX(anio * 100 + mes) AS hasta
       FROM ventas_anteriores`
  );
  const mes = (n) => (n ? `${Math.floor(n / 100)}-${String(n % 100).padStart(2, '0')}` : null);
  return { renglones: Number(r.renglones), kg: Math.round(Number(r.kg)), hilos: Number(r.hilos), desde: mes(r.desde), hasta: mes(r.hasta) };
}

/** Borra todo lo cargado (por si se subió un archivo equivocado). */
async function borrar() {
  const [r] = await pool.query('DELETE FROM ventas_anteriores');
  return { borrados: r.affectedRows };
}

module.exports = { previa, confirmar, resumen, borrar, leerMes, leerNumero };
