'use strict';

const { pool } = require('../../config/db');
const model = require('./model');
const lista = require('./lista');

// QUÉ SE VA A CARGAR, para quien autoriza una carga (2026-10-21, usuario: "en
// la solicitud solo me sale [el resumen] y yo quiero datos más específicos: qué
// color de hilo, peso de paquetes, todo ese tipo de datos").
//
// Sale de lo que se guardó al pedirla —la petición completa: cada hilo con sus
// paquetes, el peso, el lote y los conos de cada uno— sin volver a leer el Excel.
// Cada hilo se empata contra el catálogo con la MISMA regla de la carga
// (`lista.js`): así "Ya existe" o "Nuevo" es lo que de verdad va a pasar al
// aceptarla. Solo mira: no aparta códigos ni cambia nada.
//
// El costo por kilo solo va a quien tiene «Ver costos», y lo que hay hoy del
// hilo en ese almacén solo a quien ve esa tienda y su Inventario (`veExistencias`).

const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const texto = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

/** El hilo de la lista del proveedor: cada color + calibre, empatado contra el catálogo. */
async function _hilosDeLista(cuerpo) {
  const catalogo = await lista.catalogo();
  // Dos grupos del mismo color + calibre son el mismo hilo (como al cargarla).
  const grupos = new Map();
  for (const h of cuerpo.hilos ?? []) {
    const clave = lista.claveHilo(h.nombre, h.calibre);
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        clave,
        nombre: lista.limpiarNombre(h.nombre),
        calibre: lista.normalizarCalibre(h.calibre),
        costo_kg: h.costo_kg ?? null,
        bultos: [],
      });
    }
    grupos.get(clave).bultos.push(...(h.bultos ?? []));
  }
  return [...grupos.values()].map((g) => {
    const { producto, ambiguos } = lista.empatar(catalogo, g.nombre, g.calibre);
    return { ...g, estado: producto ? 'existe' : ambiguos.length ? 'ambiguo' : 'nuevo', producto, iguales: ambiguos.length };
  });
}

/** La carga de UN hilo: la presentación que se eligió, o la del producto (se crea si le falta). */
async function _hiloSolo(cuerpo) {
  const sql = `SELECT p.id, p.nombre, p.grosor_calibre AS calibre, p.activo, cat.nombre AS material, l.nombre AS linea,
                      p.precio_kg, pv.id AS variante_id, pv.precio
                 FROM productos p
                 JOIN categorias cat ON cat.id = p.categoria_id
                 LEFT JOIN lineas l ON l.id = p.linea_id`;
  const [[producto]] = cuerpo.variante_id
    ? await pool.query(
      `${sql} JOIN producto_variantes pv ON pv.producto_id = p.id WHERE pv.id = :v`,
      { v: Number(cuerpo.variante_id) }
    )
    : await pool.query(
      `${sql} LEFT JOIN producto_variantes pv
                ON pv.id = (SELECT x.id FROM producto_variantes x
                             WHERE x.producto_id = p.id AND x.tipo_presentacion <> 'cono'
                             ORDER BY x.tipo_presentacion = 'paquete' DESC, x.activo DESC, x.id LIMIT 1)
        WHERE p.id = :p`,
      { p: Number(cuerpo.producto_id) }
    );
  return [{
    clave: 'hilo',
    nombre: producto?.nombre ?? 'El hilo ya no está en el catálogo',
    calibre: producto?.calibre ?? '',
    costo_kg: cuerpo.costo_kg ?? null,
    bultos: cuerpo.bultos ?? [],
    estado: producto ? 'existe' : 'no_existe',
    producto: producto ?? null,
    iguales: 0,
  }];
}

/** Los paquetes de un hilo por lote, en el orden del Excel (el renglón), con sus cifras. */
function _porLote(bultos, registrados) {
  const conOrden = bultos.map((b, i) => ({ b, orden: b.fila != null ? Number(b.fila) : 1e6 + i }));
  conOrden.sort((x, y) => x.orden - y.orden);
  const lotes = new Map();
  for (const { b } of conOrden) {
    const lote = texto(b.lote);
    const k = lote ?? '';
    if (!lotes.has(k)) lotes.set(k, { lote, paquetes: 0, kg: 0, conos: 0, sin_conos: 0, bultos: [] });
    const l = lotes.get(k);
    const codigo = String(b.codigo).trim();
    l.paquetes++;
    l.kg += Number(b.peso_kg ?? 0);
    if (b.conos == null) l.sin_conos++;
    else l.conos += Number(b.conos);
    l.bultos.push({
      fila: b.fila != null ? Number(b.fila) : null,
      codigo,
      peso_kg: round3(b.peso_kg),
      conos: b.conos != null ? Number(b.conos) : null,
      registrado: registrados.has(codigo),
    });
  }
  return [...lotes.values()].map((l) => ({ ...l, kg: round3(l.kg) }));
}

async function _nombre(tabla, id) {
  if (!id) return null;
  const [[r]] = await pool.query(`SELECT nombre FROM ${tabla} WHERE id = :id`, { id: Number(id) });
  return r?.nombre ?? null;
}

/**
 * El detalle de una solicitud de carga (`autorizaciones/operaciones.js →
 * cargar_inventario.detalle`): de dónde y con qué papeles, cada hilo con su
 * material, línea, si ya existe, cuánto hay hoy de él en ese almacén, y sus lotes
 * con cada paquete (renglón, código, peso y conos). Un código que ya está
 * registrado en el sistema (en otra carga, a mano o como código de una
 * presentación) se marca: al aceptarla, no entraría. Solo se dice QUE está, no
 * dónde (podría ser de otra tienda).
 */
async function detalleDeCarga(cuerpo, { veCostos = false, veExistencias = false } = {}) {
  const almacenId = Number(cuerpo.almacen_id);
  const hilos = Array.isArray(cuerpo.hilos) ? await _hilosDeLista(cuerpo) : await _hiloSolo(cuerpo);

  const codigos = hilos.flatMap((h) => h.bultos.map((b) => String(b.codigo).trim()));
  const registrados = new Set((await model.codigosExistentes(codigos)).map((d) => String(d.codigo)));

  const variantes = hilos.map((h) => h.producto?.variante_id).filter(Boolean);
  const hoy = new Map();
  if (veExistencias && variantes.length) {
    const [filas] = await pool.query(
      'SELECT variante_id, cantidad FROM inventario WHERE almacen_id = :a AND variante_id IN (:v)',
      { a: almacenId, v: variantes }
    );
    for (const f of filas) hoy.set(Number(f.variante_id), Number(f.cantidad));
  }

  // Los hilos nuevos se crean con el material y la línea que se eligieron al revisarla.
  const hayNuevos = hilos.some((h) => h.estado === 'nuevo');
  const materialNuevo = hayNuevos ? await _nombre('categorias', cuerpo.categoria_id) : null;
  const lineaNueva = hayNuevos ? await _nombre('lineas', cuerpo.linea_id) : null;

  const salida = hilos.map((h) => {
    const p = h.producto;
    const pesos = h.bultos.map((b) => Number(b.peso_kg ?? 0));
    const lotes = _porLote(h.bultos, registrados);
    return {
      clave: h.clave,
      // El que ya existe se nombra como en el catálogo (ahí es donde entra); el
      // nuevo, como se va a crear: como venía en el Excel.
      nombre: p ? p.nombre : h.nombre,
      calibre: p ? (p.calibre ?? '') : h.calibre,
      estado: h.estado,
      // Cuántos hilos iguales hay en el catálogo (si son varios, no se sabe a cuál cargar).
      iguales: h.iguales,
      material: p ? p.material : h.estado === 'nuevo' ? materialNuevo : null,
      linea: p ? p.linea : h.estado === 'nuevo' ? lineaNueva : null,
      // Lo que cobra la caja es el precio de la presentación: en $0 no se vende.
      // Sin presentación, la carga le crea una con su precio por kilo.
      sin_precio: p ? !lista.tienePrecio(p) : h.estado === 'nuevo',
      desactivado: p ? !Number(p.activo) : false,
      // Ya existe pero no tiene presentación en kilos: la carga se la crea.
      crea_presentacion: p ? !p.variante_id : false,
      // null: el hilo es nuevo, o quien mira no ve las existencias de ese almacén.
      hoy_kg: veExistencias && p?.variante_id ? round3(hoy.get(Number(p.variante_id)) ?? 0) : null,
      ...(veCostos ? { costo_kg: h.costo_kg != null ? Number(h.costo_kg) : null } : {}),
      paquetes: h.bultos.length,
      kg: round3(pesos.reduce((s, x) => s + x, 0)),
      conos: lotes.reduce((s, l) => s + l.conos, 0),
      sin_conos: lotes.reduce((s, l) => s + l.sin_conos, 0),
      peso_min: pesos.length ? round3(Math.min(...pesos)) : null,
      peso_max: pesos.length ? round3(Math.max(...pesos)) : null,
      registrados: lotes.reduce((s, l) => s + l.bultos.filter((b) => b.registrado).length, 0),
      lotes,
    };
  });

  return {
    almacen: (await _nombre('almacenes', almacenId)) ?? 'el almacén',
    archivo: texto(cuerpo.archivo),
    papeles: {
      proveedor: await _nombre('proveedores', cuerpo.proveedor_id),
      factura: texto(cuerpo.factura),
      pedimento: texto(cuerpo.pedimento),
      contenedor: texto(cuerpo.contenedor),
      fecha_ingreso: texto(cuerpo.fecha_ingreso),
      // La hoja DOCUMENTO de la lista: "Proveedor Textil · lista DOC-0001 del 28.08.2026".
      documento: Array.isArray(cuerpo.hilos) ? lista.textoDocumento(cuerpo.documento) : null,
      notas: texto(cuerpo.notas),
    },
    ve_costos: Boolean(veCostos),
    ve_existencias: Boolean(veExistencias),
    hilos: salida,
    paquetes: salida.reduce((s, h) => s + h.paquetes, 0),
    kg: round3(salida.reduce((s, h) => s + h.kg, 0)),
    conos: salida.reduce((s, h) => s + h.conos, 0),
    lotes: new Set(salida.flatMap((h) => h.lotes.map((l) => `${h.clave}|${l.lote ?? ''}`))).size,
    registrados: salida.reduce((s, h) => s + h.registrados, 0),
    nuevos: salida.filter((h) => h.estado === 'nuevo').length,
  };
}

module.exports = { detalleDeCarga };
