'use strict';

const zlib = require('node:zlib');

/**
 * Lector mínimo de .xlsx, sin dependencias.
 *
 * Un .xlsx es un ZIP con XML dentro. Aquí solo se hace lo necesario para leer
 * la primera hoja como una tabla: descomprimir las dos entradas que importan
 * (`xl/sharedStrings.xml` y `xl/worksheets/sheet1.xml`) y sacar el valor de
 * cada celda.
 *
 * Se escribió a mano en vez de usar la librería `xlsx` de npm porque esa
 * arrastra un aviso de seguridad sin arreglo publicado, y el formato que se
 * importa aquí es fijo y conocido.
 *
 * Limitaciones asumidas a propósito: sin fórmulas ni fechas (las columnas de
 * fecha del formato vienen vacías). Una fórmula sin valor guardado sale vacía;
 * si el archivo trae otra cosa, el valor sale como texto crudo y la validación
 * de arriba lo rechaza.
 *
 * Dos formas de leerlo:
 *   · `leerHoja`  la primera hoja, como siempre (la lista de UN hilo).
 *   · `leerLibro` todas las hojas con su nombre: el inventario del proveedor
 *                 con varios colores trae GLOBAL, RESUMEN, DOCUMENTO e
 *                 INCIDENCIAS, y cada una sirve para algo distinto.
 */

/** Ubica una entrada del ZIP y devuelve su contenido descomprimido. */
function _leerEntrada(buf, nombre) {
  // El directorio central está al final; se busca su firma hacia atrás.
  const FIN_CENTRAL = 0x06054b50;
  let fin = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === FIN_CENTRAL) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error('El archivo no es un .xlsx válido (falta el directorio del ZIP)');

  const entradas = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);

  for (let n = 0; n < entradas; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const largoNombre = buf.readUInt16LE(p + 28);
    const largoExtra = buf.readUInt16LE(p + 30);
    const largoComentario = buf.readUInt16LE(p + 32);
    const offsetLocal = buf.readUInt32LE(p + 42);
    const nombreEntrada = buf.toString('utf8', p + 46, p + 46 + largoNombre);

    if (nombreEntrada === nombre) {
      // El encabezado local repite los largos y puede diferir del central.
      if (buf.readUInt32LE(offsetLocal) !== 0x04034b50) {
        throw new Error(`Entrada dañada en el ZIP: ${nombre}`);
      }
      const metodo = buf.readUInt16LE(offsetLocal + 8);
      const comprimido = buf.readUInt32LE(offsetLocal + 18);
      const lNombre = buf.readUInt16LE(offsetLocal + 26);
      const lExtra = buf.readUInt16LE(offsetLocal + 28);
      const inicio = offsetLocal + 30 + lNombre + lExtra;
      const datos = buf.subarray(inicio, inicio + comprimido);
      if (metodo === 0) return datos; // guardado sin comprimir
      if (metodo === 8) return zlib.inflateRawSync(datos);
      throw new Error(`Compresión no soportada (${metodo}) en ${nombre}`);
    }
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return null;
}

/** Quita las entidades XML y devuelve texto plano. */
function _desescapar(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Une el texto de todos los <t> de un fragmento (el texto rico viene partido). */
function _textoDe(fragmento) {
  const partes = fragmento.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
  return partes.map((t) => _desescapar(t.replace(/<[^>]+>/g, ''))).join('');
}

/** Cadenas compartidas: las celdas de texto guardan su índice, no el texto. */
function _compartidas(buf) {
  const lista = [];
  const ss = _leerEntrada(buf, 'xl/sharedStrings.xml');
  if (ss) {
    for (const si of ss.toString('utf8').match(/<si>[\s\S]*?<\/si>/g) || []) {
      lista.push(_textoDe(si));
    }
  }
  return lista;
}

/**
 * Los renglones de una hoja. Cada uno es
 * `{ fila, celdas: { A: 'valor', … }, numericas: Set(['E', 'G']) }`: el valor
 * siempre llega como texto, y `numericas` dice cuáles celdas eran NÚMERO en el
 * Excel. Importa para los códigos de barras: guardado como número, "00626842"
 * se vuelve 626842 y ya no coincide con la etiqueta.
 */
function _filas(xml, compartidas) {
  const filas = [];
  for (const rowXml of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const numero = Number(/<row[^>]*\sr="(\d+)"/.exec(rowXml)?.[1] ?? 0);
    const celdas = {};
    const numericas = new Set();

    for (const cXml of rowXml.match(/<c[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = /\sr="([A-Z]+)\d+"/.exec(cXml)?.[1];
      if (!ref) continue;
      const tipo = /\st="([^"]+)"/.exec(cXml)?.[1];

      let valor = '';
      if (tipo === 's') {
        const i = Number(/<v>([\s\S]*?)<\/v>/.exec(cXml)?.[1] ?? -1);
        valor = compartidas[i] ?? '';
      } else if (tipo === 'inlineStr') {
        valor = _textoDe(cXml);
      } else {
        valor = _desescapar(/<v>([\s\S]*?)<\/v>/.exec(cXml)?.[1] ?? '');
        if (!tipo || tipo === 'n') numericas.add(ref);
      }

      if (String(valor).trim() !== '') celdas[ref] = String(valor).trim();
      else numericas.delete(ref);
    }

    if (Object.keys(celdas).length) filas.push({ fila: numero, celdas, numericas });
  }
  return filas;
}

/**
 * Lee la primera hoja de un .xlsx.
 * Devuelve `{ hoja, filas }`, donde cada fila es
 * `{ fila: <número de renglón>, celdas: { A: 'valor', B: '18.65', … } }`.
 * Las celdas vacías no aparecen.
 */
function leerHoja(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const compartidas = _compartidas(buf);

  let hoja = 'Hoja1';
  const wb = _leerEntrada(buf, 'xl/workbook.xml');
  if (wb) {
    const m = /<sheet[^>]*name="([^"]*)"/.exec(wb.toString('utf8'));
    if (m) hoja = _desescapar(m[1]);
  }

  const sheet = _leerEntrada(buf, 'xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('El archivo no tiene una primera hoja legible');
  return { hoja, filas: _filas(sheet.toString('utf8'), compartidas) };
}

/**
 * Lee TODAS las hojas, en el orden de sus pestañas.
 * Devuelve `{ hojas: [{ nombre, filas }] }` con las filas como en `_filas`.
 *
 * Cada hoja se ubica por las relaciones del libro (workbook.xml.rels), no por
 * su número de archivo: el orden de las pestañas no tiene por qué coincidir con
 * sheet1, sheet2… y hay programas que escriben la ruta absoluta
 * ("/xl/worksheets/sheet1.xml") en vez de la relativa.
 */
function leerLibro(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const compartidas = _compartidas(buf);

  const wb = _leerEntrada(buf, 'xl/workbook.xml');
  if (!wb) throw new Error('El archivo no es un libro de Excel (falta xl/workbook.xml)');

  const destinos = {};
  const rels = _leerEntrada(buf, 'xl/_rels/workbook.xml.rels');
  for (const r of (rels?.toString('utf8') ?? '').match(/<Relationship\s[^>]*>/g) || []) {
    const id = /\sId="([^"]+)"/.exec(r)?.[1];
    const destino = /\sTarget="([^"]+)"/.exec(r)?.[1];
    if (!id || !destino) continue;
    destinos[id] = destino.startsWith('/') ? destino.slice(1) : `xl/${destino.replace(/^\.\//, '')}`;
  }

  const hojas = [];
  let n = 0;
  for (const s of wb.toString('utf8').match(/<sheet\s[^>]*>/g) || []) {
    n += 1;
    const nombre = _desescapar(/\sname="([^"]*)"/.exec(s)?.[1] ?? `Hoja${n}`);
    const rid = /\sr:id="([^"]+)"/.exec(s)?.[1];
    const ruta = (rid && destinos[rid]) || `xl/worksheets/sheet${n}.xml`;
    const xml = _leerEntrada(buf, ruta);
    hojas.push({ nombre, filas: xml ? _filas(xml.toString('utf8'), compartidas) : [] });
  }
  if (!hojas.length) throw new Error('El archivo no tiene hojas');
  return { hojas };
}

module.exports = { leerHoja, leerLibro };
