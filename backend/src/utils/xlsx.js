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
 * Limitaciones asumidas a propósito: una sola hoja, sin fórmulas, sin fechas
 * (las columnas de fecha del formato vienen vacías). Si el archivo trae algo
 * de eso, el valor sale como texto crudo y la validación de arriba lo rechaza.
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

/**
 * Lee la primera hoja de un .xlsx.
 * Devuelve `{ hoja, filas }`, donde cada fila es
 * `{ fila: <número de renglón>, celdas: { A: 'valor', B: '18.65', … } }`.
 * Las celdas vacías no aparecen.
 */
function leerHoja(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // Cadenas compartidas: las celdas de texto guardan su índice, no el texto.
  const compartidas = [];
  const ss = _leerEntrada(buf, 'xl/sharedStrings.xml');
  if (ss) {
    for (const si of ss.toString('utf8').match(/<si>[\s\S]*?<\/si>/g) || []) {
      compartidas.push(_textoDe(si));
    }
  }

  let hoja = 'Hoja1';
  const wb = _leerEntrada(buf, 'xl/workbook.xml');
  if (wb) {
    const m = /<sheet[^>]*name="([^"]*)"/.exec(wb.toString('utf8'));
    if (m) hoja = _desescapar(m[1]);
  }

  const sheet = _leerEntrada(buf, 'xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('El archivo no tiene una primera hoja legible');
  const xml = sheet.toString('utf8');

  const filas = [];
  for (const rowXml of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const numero = Number(/<row[^>]*\sr="(\d+)"/.exec(rowXml)?.[1] ?? 0);
    const celdas = {};

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
      }

      if (String(valor).trim() !== '') celdas[ref] = String(valor).trim();
    }

    if (Object.keys(celdas).length) filas.push({ fila: numero, celdas });
  }

  return { hoja, filas };
}

module.exports = { leerHoja };
