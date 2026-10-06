'use strict';

const model = require('./model');
// Los datos de la carga se validan y limpian igual que en la carga de un hilo.
const { datosDeCarga, validarDatosCarga } = require('./service');
const almacenesModel = require('../almacenes/model');
const { pool } = require('../../config/db');
const { leerLibro } = require('../../utils/xlsx');
const { AppError } = require('../../middlewares/error');

// Carga de la LISTA COMPLETA del proveedor: un solo archivo con varios colores.
//
// El formato es el inventario que arma la tienda a partir del PDF del proveedor
// ("HTX 1.ARAC FFAU 721502-4 - INVENTARIO.xlsx"): cuatro hojas, y de cada una se
// toma solo lo que sirve.
//
//   GLOBAL       un renglón por BULTO. Se leen BOX NO (código), COLOR, CALIBRE,
//                LOT, NET (kilos que se cargan), CONOS y NOTA; GROSS y TARE solo
//                para comprobar que bruto − tara = neto. Lo demás (código de
//                color del proveedor, artículo, página del PDF) se ignora.
//   RESUMEN      el total por lote que imprimió el proveedor: con eso se
//                comprueba que no falte ni sobre ningún bulto.
//   DOCUMENTO    proveedor, número de la lista y fecha: quedan en las notas de
//                cada carga para poder rastrearla.
//   INCIDENCIAS  no se lee: lo mismo viene en la columna NOTA de cada renglón.
//
// Las columnas se buscan por su ENCABEZADO, no por su letra: si la tienda mueve
// o agrega una columna, se sigue leyendo bien.
//
// Cada color + calibre es UN hilo (el nombre es el que la tienda escribe en el
// Excel, tal cual se va a mostrar). Si ya existe, se le agregan bultos; si no,
// SE CREA, sin precio: la tienda se lo pone después y mientras tanto no se
// puede vender (lo avisa la campana). La línea —turco, nacional— NO separa
// hilos: el BLANCO 2/30 turco y el nacional son el mismo (decisión del usuario,
// 2026-10-03).

const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

/** Encabezados que se reconocen para cada dato, ya normalizados. */
const ENCABEZADOS = {
  codigo: ['BOX NO', 'BOX', 'CODIGO', 'CODIGO DE BARRAS', 'CODIGO DEL BULTO', 'BULTO'],
  color: ['COLOR'],
  calibre: ['CALIBRE'],
  lote: ['LOT', 'LOTE'],
  neto: ['NET', 'NETO', 'NET KG', 'PESO NETO', 'PESO'],
  bruto: ['GROSS', 'BRUTO', 'BRUT KG'],
  tara: ['TARE', 'TARA', 'TARE KG'],
  conos: ['CONOS', 'CONO'],
  nota: ['NOTA', 'NOTAS'],
  articulo: ['ARTICULO'],
};
const OBLIGATORIOS = { codigo: 'BOX NO', color: 'COLOR', calibre: 'CALIBRE', neto: 'NET' };

/** Sin acentos, en mayúsculas y con un solo espacio: para comparar textos. */
function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[.:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "2-30", "2 / 30", "2\30" → "2/30". Así lo guarda el catálogo. */
function normalizarCalibre(s) {
  return String(s ?? '').trim().replace(/[\\-]/g, '/').replace(/\s+/g, '');
}

/** El nombre como lo escribió la tienda, sin espacios de sobra. */
function limpiarNombre(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Clave del hilo: color + calibre. La línea no cuenta. */
function claveHilo(nombre, calibre) {
  return `${normalizar(nombre)}|${normalizarCalibre(calibre)}`;
}

/** Un número del Excel ("19.25", "19,25"); null si no lo es. */
function numero(txt) {
  if (txt == null || String(txt).trim() === '') return null;
  const n = Number(String(txt).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Busca, en los primeros renglones de la hoja, el de los encabezados.
 * Devuelve `{ fila, columnas: { codigo: 'A', … } }` o, si no lo encuentra, los
 * obligatorios que faltaron en el renglón que más se le pareció.
 */
function _encabezados(hoja, encabezados, obligatorios) {
  let mejor = { faltan: Object.values(obligatorios), aciertos: -1 };
  for (const f of hoja.filas.slice(0, 15)) {
    const columnas = {};
    for (const [col, valor] of Object.entries(f.celdas)) {
      const v = normalizar(valor);
      for (const [campo, nombres] of Object.entries(encabezados)) {
        if (!columnas[campo] && nombres.includes(v)) columnas[campo] = col;
      }
    }
    const faltan = Object.entries(obligatorios).filter(([c]) => !columnas[c]).map(([, n]) => n);
    if (!faltan.length) return { fila: f.fila, columnas };
    const aciertos = Object.keys(obligatorios).length - faltan.length;
    if (aciertos > mejor.aciertos) mejor = { faltan, aciertos };
  }
  return { faltan: mejor.faltan };
}

/** La hoja de los bultos: la que se llama GLOBAL o, si no, la primera que tenga los encabezados. */
function _hojaDeBultos(hojas) {
  const ordenadas = [
    ...hojas.filter((h) => normalizar(h.nombre) === 'GLOBAL'),
    ...hojas.filter((h) => normalizar(h.nombre) !== 'GLOBAL'),
  ];
  let faltan = null;
  for (const hoja of ordenadas) {
    const e = _encabezados(hoja, ENCABEZADOS, OBLIGATORIOS);
    if (e.columnas) return { hoja, ...e };
    if (!faltan || e.faltan.length < faltan.length) faltan = e.faltan;
  }
  throw new AppError(422, 'FORMATO_INESPERADO',
    `No encontré la hoja de los bultos. Hace falta un renglón de encabezados con BOX NO, COLOR, ` +
    `CALIBRE y NET (en este archivo faltó: ${faltan.join(', ')}). ` +
    `Hojas del archivo: ${hojas.map((h) => h.nombre).join(', ')}.`);
}

/** Proveedor, número y fecha de la lista (hoja DOCUMENTO), si viene. */
function _documento(hojas) {
  const hoja = hojas.find((h) => normalizar(h.nombre) === 'DOCUMENTO');
  if (!hoja) return null;
  const pares = {};
  for (const f of hoja.filas) {
    if (f.celdas.A && f.celdas.B) pares[normalizar(f.celdas.A)] = String(f.celdas.B).trim();
  }
  const doc = {
    proveedor: pares.PROVEEDOR ?? null,
    numero: pares['BELGE NO'] ?? pares.DOCUMENTO_NO ?? pares.FOLIO ?? null,
    fecha: pares['BELGE TARIHI'] ?? pares.FECHA ?? null,
  };
  return doc.proveedor || doc.numero ? doc : null;
}

/** El total por lote que imprimió el proveedor (hoja RESUMEN), si viene. */
function _resumenPorLote(hojas) {
  const hoja = hojas.find((h) => normalizar(h.nombre) === 'RESUMEN');
  if (!hoja) return null;
  const e = _encabezados(
    hoja,
    { lote: ['LOT', 'LOTE'], cajas: ['CAJAS', 'BULTOS'], neto: ['NET KG', 'NET', 'NETO'], conos: ['CONOS'] },
    { lote: 'LOT', cajas: 'CAJAS', neto: 'NET KG' }
  );
  if (!e.columnas) return null;
  const lotes = [];
  for (const f of hoja.filas.filter((x) => x.fila > e.fila)) {
    const lote = String(f.celdas[e.columnas.lote] ?? '').trim();
    if (!lote || normalizar(lote) === 'TOTAL') continue;
    lotes.push({
      lote,
      cajas: numero(f.celdas[e.columnas.cajas]),
      kg: numero(f.celdas[e.columnas.neto]),
      conos: e.columnas.conos ? numero(f.celdas[e.columnas.conos]) : null,
    });
  }
  return lotes.length ? lotes : null;
}

const n = (x) => Number(x).toLocaleString('en-US', { maximumFractionDigits: 3 });

/**
 * Lee el archivo y lo convierte en hilos con sus bultos. No toca la base.
 *
 * `errores` impiden cargar (un bulto sin peso, un código repetido): con una
 * lista de cientos de bultos, saltarse uno en silencio dejaría el inventario
 * corto sin que nadie lo note. `avisos` solo piden revisar (las notas del
 * proveedor, un bruto − tara que no da el neto, un lote que no cuadra con el
 * resumen).
 */
function analizarLista(buffer, nombreArchivo) {
  let hojas;
  try {
    ({ hojas } = leerLibro(buffer));
  } catch (err) {
    throw new AppError(422, 'ARCHIVO_ILEGIBLE', `No se pudo leer el archivo: ${err.message}`);
  }

  const { hoja, fila: filaEncabezado, columnas: col } = _hojaDeBultos(hojas);
  const errores = [];
  const avisos = [];
  const hilos = new Map();
  const vistos = new Map(); // código → renglón donde apareció
  const articulos = {};
  const crudos = [];

  for (const f of hoja.filas.filter((x) => x.fila > filaEncabezado)) {
    const c = f.celdas;
    const codigo = String(c[col.codigo] ?? '').trim();
    const nombre = limpiarNombre(c[col.color]);
    const calibre = normalizarCalibre(c[col.calibre]);
    const netoTxt = String(c[col.neto] ?? '').trim();

    // Renglón en blanco (o solo con la leyenda de colores): no cuenta.
    if (!codigo && !nombre && !netoTxt) continue;
    if (normalizar(codigo) === 'TOTAL') continue;

    const quien = codigo ? `Renglón ${f.fila} (bulto ${codigo})` : `Renglón ${f.fila}`;
    if (!codigo) { errores.push({ fila: f.fila, mensaje: `${quien}: falta el código del bulto (BOX NO).` }); continue; }
    if (!nombre) { errores.push({ fila: f.fila, mensaje: `${quien}: falta el COLOR.` }); continue; }
    if (!calibre) { errores.push({ fila: f.fila, mensaje: `${quien}: falta el CALIBRE.` }); continue; }

    const neto = numero(netoTxt);
    if (neto == null || neto <= 0) {
      errores.push({ fila: f.fila, mensaje: `${quien}: el peso neto ${netoTxt ? `«${netoTxt}» no es válido` : 'está vacío'}.` });
      continue;
    }
    if (vistos.has(codigo)) {
      errores.push({ fila: f.fila, mensaje: `${quien}: el código ya venía en el renglón ${vistos.get(codigo)}.` });
      continue;
    }
    vistos.set(codigo, f.fila);

    const bruto = col.bruto ? numero(c[col.bruto]) : null;
    const tara = col.tara ? numero(c[col.tara]) : null;
    if (bruto != null && tara != null && Math.abs(bruto - tara - neto) > 0.005) {
      avisos.push({
        fila: f.fila,
        mensaje: `${quien}: bruto ${n(bruto)} − tara ${n(tara)} da ${n(round3(bruto - tara))} kg, pero el neto dice ${n(neto)}. Se carga el neto.`,
      });
    }
    // Las notas del proveedor (lecturas dudosas del PDF, datos corregidos).
    const nota = col.nota ? String(c[col.nota] ?? '').trim() : '';
    if (nota) avisos.push({ fila: f.fila, mensaje: `${quien}: ${nota}` });

    if (col.articulo && c[col.articulo]) {
      const a = String(c[col.articulo]).trim();
      articulos[a] = (articulos[a] ?? 0) + 1;
    }

    const conos = col.conos ? numero(c[col.conos]) : null;
    crudos.push({
      fila: f.fila,
      codigo,
      codigoEsNumero: f.numericas.has(col.codigo),
      nombre,
      calibre,
      bulto: {
        fila: f.fila,
        codigo,
        peso_kg: round3(neto),
        lote: String(c[col.lote] ?? '').trim() || null,
        conos: conos != null && conos > 0 ? Math.round(conos) : null,
      },
    });
  }

  // Un código guardado como NÚMERO pierde los ceros de la izquierda: "00626842"
  // queda 626842 y el lector de la caja nunca lo encontraría. Se detecta cuando
  // es más corto que el largo normal de los códigos del archivo.
  const largos = {};
  for (const r of crudos) largos[r.codigo.length] = (largos[r.codigo.length] ?? 0) + 1;
  // En un empate gana el más largo: los ceros solo se pierden, nunca se ganan.
  const largoNormal = Number(
    Object.entries(largos).sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]))[0]?.[0] ?? 0
  );

  for (const r of crudos) {
    if (r.codigoEsNumero && r.codigo.length < largoNormal) {
      errores.push({
        fila: r.fila,
        mensaje:
          `Renglón ${r.fila} (bulto ${r.codigo}): el código quedó guardado como número y perdió los ceros ` +
          `de la izquierda (los demás tienen ${largoNormal} dígitos). Dale formato de texto a la columna y escríbelo como en la etiqueta.`,
      });
      continue;
    }
    const clave = claveHilo(r.nombre, r.calibre);
    if (!hilos.has(clave)) hilos.set(clave, { clave, nombre: r.nombre, calibre: r.calibre, bultos: [] });
    hilos.get(clave).bultos.push(r.bulto);
  }

  const lista = [...hilos.values()].map((h) => {
    const pesos = h.bultos.map((b) => b.peso_kg);
    const kg = round3(pesos.reduce((s, p) => s + p, 0));
    const porLote = {};
    for (const b of h.bultos) {
      const l = b.lote ?? '(sin lote)';
      porLote[l] = porLote[l] ?? { lote: l, bultos: 0, kg: 0 };
      porLote[l].bultos += 1;
      porLote[l].kg = round3(porLote[l].kg + b.peso_kg);
    }
    return {
      ...h,
      num_bultos: h.bultos.length,
      kg_total: kg,
      conos: h.bultos.reduce((s, b) => s + (b.conos ?? 0), 0),
      peso_min: Math.min(...pesos),
      peso_max: Math.max(...pesos),
      peso_promedio: round3(kg / pesos.length),
      lotes: Object.values(porLote).sort((a, b) => a.lote.localeCompare(b.lote)),
    };
  });

  if (!lista.length && !errores.length) {
    throw new AppError(422, 'SIN_BULTOS', `La hoja ${hoja.nombre} no trae bultos.`);
  }

  // Cotejo contra el resumen por lote del proveedor: si cuadra, no falta ni
  // sobra ningún bulto. Solo avisa: el resumen puede venir de antes de que la
  // tienda corrigiera un dato en la hoja de bultos.
  const resumen = _resumenPorLote(hojas);
  let control = null;
  if (resumen) {
    const leidos = {};
    for (const h of lista) {
      for (const b of h.bultos) {
        const l = b.lote ?? '(sin lote)';
        leidos[l] = leidos[l] ?? { cajas: 0, kg: 0, conos: 0 };
        leidos[l].cajas += 1;
        leidos[l].kg = round3(leidos[l].kg + b.peso_kg);
        leidos[l].conos += b.conos ?? 0;
      }
    }
    const diferencias = [];
    for (const r of resumen) {
      const l = leidos[r.lote] ?? { cajas: 0, kg: 0, conos: 0 };
      const malCajas = r.cajas != null && r.cajas !== l.cajas;
      const malKg = r.kg != null && Math.abs(r.kg - l.kg) > 0.01;
      const malConos = r.conos != null && r.conos !== l.conos;
      if (malCajas || malKg || malConos) {
        diferencias.push(
          `Lote ${r.lote}: el resumen dice ${n(r.cajas ?? 0)} bultos y ${n(r.kg ?? 0)} kg` +
          `${r.conos != null ? ` (${n(r.conos)} conos)` : ''}; los renglones suman ${n(l.cajas)} y ${n(l.kg)} kg` +
          `${r.conos != null ? ` (${n(l.conos)} conos)` : ''}.`
        );
      }
    }
    for (const l of Object.keys(leidos)) {
      if (!resumen.some((r) => r.lote === l)) {
        diferencias.push(`Lote ${l}: viene en los renglones (${n(leidos[l].cajas)} bultos) pero no en el resumen.`);
      }
    }
    control = { lotes: resumen.length, cuadra: diferencias.length === 0, diferencias };
  }

  const articulo = Object.entries(articulos).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    archivo: nombreArchivo ?? null,
    hoja: hoja.nombre,
    documento: _documento(hojas),
    articulo,
    hilos: lista,
    control,
    errores,
    avisos,
  };
}

// ---------------------------------------------------------------- con la base

/**
 * Los hilos del catálogo con lo necesario para empatarlos: su presentación en
 * kilos (paquete, o simple) y si tiene precio. Se leen todos —son decenas— y se
 * empatan aquí, con la misma normalización que el archivo.
 */
async function _catalogo(ejecutor = pool) {
  const [rows] = await ejecutor.query(
    `SELECT p.id, p.nombre, p.grosor_calibre AS calibre, p.activo, p.precio_kg, p.multipresentacion,
            cat.nombre AS material, l.nombre AS linea,
            pv.id AS variante_id, pv.sku, pv.precio, pv.peso_kg, pv.tipo_presentacion
       FROM productos p
       JOIN categorias cat ON cat.id = p.categoria_id
       LEFT JOIN lineas l  ON l.id = p.linea_id
       LEFT JOIN producto_variantes pv
              ON pv.id = (SELECT x.id FROM producto_variantes x
                           WHERE x.producto_id = p.id AND x.tipo_presentacion <> 'cono'
                           ORDER BY x.tipo_presentacion = 'paquete' DESC, x.activo DESC, x.id
                           LIMIT 1)`
  );
  const porClave = new Map();
  for (const r of rows) {
    const k = claveHilo(r.nombre, r.calibre);
    if (!porClave.has(k)) porClave.set(k, []);
    porClave.get(k).push(r);
  }
  return { rows, porClave };
}

/** El hilo del catálogo que le toca a un color + calibre del archivo. */
function _empatar(catalogo, nombre, calibre) {
  const todos = catalogo.porClave.get(claveHilo(nombre, calibre)) ?? [];
  if (todos.length <= 1) return { producto: todos[0] ?? null, ambiguos: [] };
  // Si hay varios, manda el activo; si siguen siendo varios, no se adivina.
  const activos = todos.filter((p) => p.activo);
  if (activos.length === 1) return { producto: activos[0], ambiguos: [] };
  return { producto: null, ambiguos: activos.length ? activos : todos };
}

/** Hilos del catálogo con el mismo nombre en otro calibre: para que no se pase un error de dedo. */
function _parecidos(catalogo, nombre, calibre) {
  const nom = normalizar(nombre);
  return catalogo.rows
    .filter((p) => normalizar(p.nombre) === nom && normalizarCalibre(p.calibre) !== normalizarCalibre(calibre))
    .map((p) => `${p.nombre}${p.calibre ? ' ' + p.calibre : ''}`);
}

/** El material que dice el ARTÍCULO del proveedor ("%100 ACRYLIC …" → ACRILAN). */
async function _materialSugerido(articulo) {
  const a = normalizar(articulo);
  const raiz = /ACRYL|ACRIL/.test(a) ? 'ACRIL' : /VISCO/.test(a) ? 'VISCO' : null;
  if (!raiz) return null;
  const [rows] = await pool.query('SELECT id, nombre FROM categorias WHERE activo = 1 ORDER BY nombre');
  return rows.find((c) => normalizar(c.nombre).startsWith(raiz))?.id ?? null;
}

/** Vista previa: el archivo, empatado contra el catálogo y contra los códigos ya registrados. */
async function previaLista(buffer, nombreArchivo) {
  const r = analizarLista(buffer, nombreArchivo);
  const catalogo = await _catalogo();

  const codigos = r.hilos.flatMap((h) => h.bultos.map((b) => b.codigo));
  const registrados = new Map((await model.codigosExistentes(codigos)).map((d) => [d.codigo, d]));

  for (const h of r.hilos) {
    const { producto, ambiguos } = _empatar(catalogo, h.nombre, h.calibre);
    h.estado = producto ? 'existe' : ambiguos.length ? 'ambiguo' : 'nuevo';
    h.producto = producto
      ? {
          id: producto.id,
          nombre: producto.nombre,
          calibre: producto.calibre,
          material: producto.material,
          linea: producto.linea,
          activo: !!producto.activo,
          precio_kg: producto.precio_kg != null ? Number(producto.precio_kg) : null,
          sku: producto.sku,
          // Lo que de verdad cobra la caja es el precio de la presentación.
          tiene_precio: producto.precio != null && Number(producto.precio) > 0,
        }
      : null;
    h.parecidos = producto ? [] : _parecidos(catalogo, h.nombre, h.calibre);

    if (ambiguos.length) {
      r.errores.push({
        fila: h.bultos[0].fila,
        mensaje:
          `Hay ${ambiguos.length} hilos «${h.nombre} ${h.calibre}» en el catálogo ` +
          `(${ambiguos.map((p) => `${p.linea ?? 'sin línea'}, id ${p.id}`).join('; ')}). ` +
          'Deja uno solo (o desactiva los demás) para saber a cuál cargar.',
      });
    }
    if (producto && !producto.activo) {
      r.avisos.push({
        fila: h.bultos[0].fila,
        mensaje: `«${producto.nombre} ${producto.calibre ?? ''}» está desactivado: la mercancía entra igual, pero no se ofrece hasta que lo actives.`,
      });
    }
    for (const b of h.bultos) {
      const d = registrados.get(b.codigo);
      if (d) {
        r.errores.push({
          fila: b.fila,
          mensaje: `Renglón ${b.fila} (bulto ${b.codigo}): ya está registrado en «${d.producto} · ${d.sku}».`,
        });
      }
    }
  }

  r.errores.sort((a, b) => a.fila - b.fila);
  r.avisos.sort((a, b) => a.fila - b.fila);
  const kg = round3(r.hilos.reduce((s, h) => s + h.kg_total, 0));
  r.resumen = {
    num_hilos: r.hilos.length,
    nuevos: r.hilos.filter((h) => h.estado === 'nuevo').length,
    num_bultos: r.hilos.reduce((s, h) => s + h.num_bultos, 0),
    kg_total: kg,
    conos: r.hilos.reduce((s, h) => s + h.conos, 0),
    lotes: new Set(r.hilos.flatMap((h) => h.lotes.map((l) => l.lote))).size,
  };
  r.material_sugerido_id = await _materialSugerido(r.articulo);
  r.se_puede_cargar = r.errores.length === 0 && r.hilos.length > 0;
  return r;
}

/** "Canan Tekstil · lista IRD00103079 del 28.08.2026", para las notas de cada carga. */
function _textoDocumento(doc) {
  if (!doc) return null;
  const partes = [];
  if (doc.proveedor) partes.push(doc.proveedor);
  if (doc.numero) partes.push(`lista ${doc.numero}${doc.fecha ? ` del ${doc.fecha}` : ''}`);
  return partes.join(' · ') || null;
}

/**
 * Confirma la lista: crea los hilos que falten (sin precio), su presentación de
 * paquete, y una CARGA por hilo con sus bultos y su entrada al inventario.
 * Todo en una sola transacción: o entra la lista completa o no entra nada.
 * `avisar` recibe lo que se va haciendo, para que la pantalla lo diga.
 */
async function confirmarLista(datos, usuarioId, avisar = () => {}) {
  const almacen = await almacenesModel.obtener(datos.almacen_id);
  if (!almacen) throw new AppError(422, 'ALMACEN_INVALIDO', 'El almacén no existe');
  avisar({ tipo: 'paso', texto: 'Revisando que ningún código esté registrado' });

  // Un código es una pieza física: no puede venir dos veces ni estar ya cargado.
  const codigos = datos.hilos.flatMap((h) => h.bultos.map((b) => String(b.codigo).trim()));
  const repetidos = codigos.filter((c, i) => codigos.indexOf(c) !== i);
  if (repetidos.length) {
    throw new AppError(422, 'CODIGOS_REPETIDOS',
      `Hay códigos repetidos en la lista: ${[...new Set(repetidos)].slice(0, 5).join(', ')}.`);
  }
  const duplicados = await model.codigosExistentes(codigos);
  if (duplicados.length) {
    throw new AppError(409, 'CODIGOS_DUPLICADOS',
      `${duplicados.length} código(s) ya están registrados: ${duplicados
        .slice(0, 5).map((d) => d.codigo).join(', ')}${duplicados.length > 5 ? '…' : ''}`);
  }

  // Dos renglones del mismo color + calibre son el mismo hilo aunque lleguen
  // como dos grupos (escritos distinto): se juntan.
  const grupos = new Map();
  for (const h of datos.hilos) {
    const k = claveHilo(h.nombre, h.calibre);
    if (!grupos.has(k)) grupos.set(k, { ...h, nombre: limpiarNombre(h.nombre), calibre: normalizarCalibre(h.calibre), bultos: [] });
    grupos.get(k).bultos.push(...h.bultos);
  }

  await validarDatosCarga(datos);

  return model.crearLista(
    {
      almacen_id: datos.almacen_id,
      categoria_id: datos.categoria_id ?? null,
      linea_id: datos.linea_id ?? null,
      // Los datos de la carga son los mismos para todos los hilos de la lista.
      ...datosDeCarga(datos),
      archivo: datos.archivo ?? null,
      notas: [_textoDocumento(datos.documento), datos.notas?.trim()].filter(Boolean).join(' · ') || null,
      hilos: [...grupos.values()].map((h) => ({
        nombre: h.nombre,
        calibre: h.calibre,
        costo_kg: h.costo_kg ?? null,
        bultos: h.bultos.map((b) => ({
          codigo: String(b.codigo).trim(),
          peso_kg: round3(b.peso_kg),
          lote: b.lote ?? null,
          conos: b.conos ?? null,
        })),
      })),
    },
    usuarioId,
    { catalogo: _catalogo, empatar: _empatar, avisar }
  );
}

module.exports = {
  analizarLista,
  previaLista,
  confirmarLista,
  // Para las pruebas.
  normalizar,
  normalizarCalibre,
  claveHilo,
};
