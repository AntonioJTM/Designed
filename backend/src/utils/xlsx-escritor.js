'use strict';

const zlib = require('node:zlib');

/**
 * Escritor mínimo de .xlsx, sin dependencias (el gemelo de `xlsx.js`, que lee).
 *
 * Sirve para las PLANTILLAS que la tienda baja y llena (2026-10-22: "que me dé
 * el Excel en limpio para que nosotros lo llenemos"). Hace lo justo para que
 * Excel lo abra sin quejarse: el paquete completo ([Content_Types], relaciones,
 * libro, estilos y una hoja por pestaña), el encabezado en negritas sobre gris
 * claro y congelado, el ancho de cada columna y, en las que lo piden, el
 * formato de TEXTO: así un código "00633586" no pierde sus ceros y un calibre
 * "1/30" no se vuelve fecha al escribirlo.
 *
 *   escribirLibro([
 *     { nombre: 'GLOBAL', columnas: [{ titulo: 'BOX NO', ancho: 18, texto: true }, …], filas: [] },
 *   ]) → Buffer
 */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A, B, … Z, AA… */
function letra(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Estilos: 0 normal, 1 encabezado (negritas sobre gris, con borde abajo), 2 texto
// (formato "@"), 3 texto con salto de renglón (las instrucciones).
const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF9AA3B2"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function _hojaXml(hoja) {
  const cols = hoja.columnas
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho ?? 14}" customWidth="1"${c.texto || c.parrafo ? ` style="${c.parrafo ? 3 : 2}"` : ''}/>`)
    .join('');
  const celda = (v, ref, estilo) => {
    if (v === null || v === undefined || v === '') return estilo ? `<c r="${ref}" s="${estilo}"/>` : '';
    if (typeof v === 'number') return `<c r="${ref}"${estilo ? ` s="${estilo}"` : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  const encabezado = `<row r="1">${hoja.columnas.map((c, i) => celda(c.titulo, `${letra(i)}1`, 1)).join('')}</row>`;
  const filas = (hoja.filas ?? [])
    .map((fila, r) => {
      const n = r + 2;
      const estilo = (i) => (hoja.columnas[i]?.parrafo ? 3 : hoja.columnas[i]?.texto ? 2 : 0);
      return `<row r="${n}">${fila.map((v, i) => celda(typeof v === 'number' && hoja.columnas[i]?.texto ? String(v) : v, `${letra(i)}${n}`, estilo(i))).join('')}</row>`;
    })
    .join('');
  const congelar = hoja.congelar === false ? ''
    : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
      + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${congelar}<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${encabezado}${filas}</sheetData></worksheet>`;
}

/** Un ZIP con las entradas dadas (comprimidas con deflate). */
function _zip(entradas) {
  const locales = [];
  const centrales = [];
  let offset = 0;
  for (const [nombre, texto] of entradas) {
    const datos = Buffer.from(texto, 'utf8');
    const comp = zlib.deflateRawSync(datos);
    const crc = zlib.crc32(datos);
    const n = Buffer.from(nombre, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(n.length, 26);
    locales.push(local, n, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    centrales.push(central, n);
    offset += 30 + n.length + comp.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(dir.length, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, dir, fin]);
}

/** El libro con sus hojas, en el orden dado (la primera es la que abre). */
function escribirLibro(hojas) {
  const n = hojas.length;
  const ids = hojas.map((_, i) => i + 1);
  return _zip([
    ['[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + ids.map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>'],
    ['_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'],
    ['xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets>' + hojas.map((h, i) => `<sheet name="${esc(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>'
      + '</workbook>'],
    ['xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + ids.map((i) => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')
      + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>'],
    ['xl/styles.xml', ESTILOS],
    ...hojas.map((h, i) => [`xl/worksheets/sheet${i + 1}.xml`, _hojaXml(h)]),
  ]);
}

/** Manda un .xlsx para bajarlo. */
function enviarXlsx(res, buffer, nombre) {
  const ascii = nombre.normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/["\\/]/g, '-');
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Length': buffer.length,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    'Cache-Control': 'no-store',
  });
  res.send(buffer);
}

module.exports = { escribirLibro, enviarXlsx };
