'use strict';

const PDFDocument = require('pdfkit');

/**
 * Piezas para armar los reportes en PDF (carta, vertical). Lo que se repite en
 * todos —encabezado, renglones de datos, cifras grandes, tablas que siguen en la
 * página siguiente con su encabezado, y el pie con "Página X de Y"— vive aquí;
 * cada reporte solo dice QUÉ va.
 *
 * Usa las fuentes estándar del PDF (Helvetica), que traen los acentos y la ñ.
 * OJO: NO traen flechas ni "≈": se escribe "a" o "aprox." en su lugar.
 */

const COLOR = {
  tinta: '#161A23',
  tinta2: '#3F4552',
  tinta3: '#5B6270',
  borde: '#E3E6EB',
  bordeSuave: '#EEF0F3',
  fondo: '#F4F5F7',
  acento: '#2457C5',
};
const MARGEN = 40;
const ALTO_PIE = 28;

function crear() {
  // bufferPages: el pie con "Página X de Y" se escribe al final, cuando ya se
  // sabe cuántas páginas son.
  return new PDFDocument({ size: 'LETTER', margin: MARGEN, bufferPages: true });
}

function ancho(doc) {
  return doc.page.width - MARGEN * 2;
}

/** Lo último donde cabe algo antes del pie. */
function fondoUtil(doc) {
  return doc.page.height - MARGEN - ALTO_PIE;
}

/** Salta de página si lo que sigue no cabe. Devuelve true si saltó. */
function asegurar(doc, alto) {
  if (doc.y + alto <= fondoUtil(doc)) return false;
  doc.addPage();
  return true;
}

/** Nombre de la tienda, título del reporte y su subtítulo, con una raya abajo. */
function encabezado(doc, { titulo, subtitulo, derecha }) {
  const x = MARGEN;
  doc.font('Helvetica').fontSize(9).fillColor(COLOR.tinta3).text('TIENDA DE HILOS', x, MARGEN, {
    characterSpacing: 1,
  });
  if (derecha) {
    doc.text(derecha, x, MARGEN, { width: ancho(doc), align: 'right' });
  }
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(COLOR.tinta).text(titulo, x);
  if (subtitulo) {
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(11).fillColor(COLOR.tinta3).text(subtitulo, x);
  }
  doc.moveDown(0.8);
  linea(doc, COLOR.borde);
  doc.moveDown(0.9);
}

function linea(doc, color = COLOR.bordeSuave) {
  const y = doc.y;
  doc.moveTo(MARGEN, y).lineTo(MARGEN + ancho(doc), y).lineWidth(0.8).strokeColor(color).stroke();
}

/** Título de una sección del reporte. */
function seccion(doc, texto) {
  asegurar(doc, 60);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR.tinta).text(texto, MARGEN);
  doc.moveDown(0.5);
}

/** Nota en gris (una explicación, un aviso). */
function nota(doc, texto) {
  asegurar(doc, 30);
  doc.font('Helvetica').fontSize(9).fillColor(COLOR.tinta3).text(texto, MARGEN, doc.y, { width: ancho(doc) });
  doc.moveDown(0.6);
}

/**
 * Pares etiqueta → valor en dos columnas. Los vacíos no se dibujan: un "—" en
 * un comprobante no dice nada.
 */
function datos(doc, pares) {
  const visibles = pares.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
  const col = (ancho(doc) - 20) / 2;
  const etiqueta = 92;
  for (let i = 0; i < visibles.length; i += 2) {
    const fila = visibles.slice(i, i + 2);
    const alto = Math.max(
      ...fila.map(([, v]) => doc.font('Helvetica').fontSize(10).heightOfString(String(v), { width: col - etiqueta }))
    );
    asegurar(doc, alto + 8);
    const y = doc.y;
    fila.forEach(([k, v], j) => {
      const x = MARGEN + j * (col + 20);
      doc.font('Helvetica').fontSize(9).fillColor(COLOR.tinta3).text(k, x, y + 1, { width: etiqueta - 8 });
      doc.font('Helvetica').fontSize(10).fillColor(COLOR.tinta).text(String(v), x + etiqueta, y, { width: col - etiqueta });
    });
    doc.y = y + alto + 7;
  }
  doc.x = MARGEN;
  doc.moveDown(0.5);
}

/** Cifras grandes en cajas (bultos, kilos…), como las del panel. */
function cifras(doc, lista) {
  const gap = 10;
  const w = (ancho(doc) - gap * (lista.length - 1)) / lista.length;
  const alto = 52;
  asegurar(doc, alto + 10);
  const y = doc.y;
  lista.forEach(([k, v], i) => {
    const x = MARGEN + i * (w + gap);
    doc.roundedRect(x, y, w, alto, 6).lineWidth(0.8).strokeColor(COLOR.borde).stroke();
    doc.font('Helvetica').fontSize(8.5).fillColor(COLOR.tinta3).text(k, x + 10, y + 9, { width: w - 20 });
    doc.font('Helvetica-Bold').fontSize(15).fillColor(COLOR.tinta).text(String(v), x + 10, y + 24, {
      width: w - 20,
      lineBreak: false,
      ellipsis: true,
    });
  });
  doc.y = y + alto + 14;
  doc.x = MARGEN;
}

/**
 * Una tabla. `columnas`: [{ titulo, ancho (proporción), alin: 'left'|'right' }].
 * `filas`: arreglos de textos. Si no cabe, sigue en la página siguiente con su
 * encabezado repetido. `total` (opcional) va al final, en negritas y con raya.
 */
function tabla(doc, columnas, filas, { total = null } = {}) {
  const w = ancho(doc);
  const suma = columnas.reduce((s, c) => s + c.ancho, 0);
  const anchos = columnas.map((c) => (c.ancho / suma) * w);
  const pad = 5;
  const tam = 9;

  // El encabezado crece si algún título necesita dos renglones; con alto fijo,
  // el segundo renglón se encimaba sobre la primera fila.
  const altoEnc = Math.max(
    20,
    ...columnas.map((c, i) => doc.font('Helvetica-Bold').fontSize(8.5).heightOfString(c.titulo, { width: anchos[i] - pad * 2 }) + 12)
  );
  const dibujarEncabezado = () => {
    const y = doc.y;
    doc.rect(MARGEN, y, w, altoEnc).fill(COLOR.fondo);
    let x = MARGEN;
    columnas.forEach((c, i) => {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLOR.tinta2)
        .text(c.titulo, x + pad, y + 6, { width: anchos[i] - pad * 2, align: c.alin ?? 'left' });
      x += anchos[i];
    });
    doc.y = y + altoEnc;
  };

  const altoDe = (fila, fuente) =>
    Math.max(
      ...fila.map((t, i) =>
        doc.font(fuente).fontSize(tam).heightOfString(String(t ?? ''), { width: anchos[i] - pad * 2 })
      )
    ) + pad * 2;

  const dibujarFila = (fila, { negrita = false, rayaArriba = false } = {}) => {
    const fuente = negrita ? 'Helvetica-Bold' : 'Helvetica';
    const alto = altoDe(fila, fuente);
    if (asegurar(doc, alto)) dibujarEncabezado();
    const y = doc.y;
    if (rayaArriba) {
      doc.moveTo(MARGEN, y).lineTo(MARGEN + w, y).lineWidth(0.8).strokeColor(COLOR.borde).stroke();
    }
    let x = MARGEN;
    fila.forEach((t, i) => {
      doc.font(fuente).fontSize(tam).fillColor(COLOR.tinta)
        .text(String(t ?? ''), x + pad, y + pad, { width: anchos[i] - pad * 2, align: columnas[i].alin ?? 'left' });
      x += anchos[i];
    });
    doc.y = y + alto;
    if (!rayaArriba) {
      doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + w, doc.y).lineWidth(0.5).strokeColor(COLOR.bordeSuave).stroke();
    }
  };

  asegurar(doc, altoEnc + 24);
  dibujarEncabezado();
  for (const fila of filas) dibujarFila(fila);
  if (total) dibujarFila(total, { negrita: true, rayaArriba: true });
  doc.x = MARGEN;
  doc.moveDown(1);
}

/** El pie de cada página: quién y cuándo, y "Página X de Y". */
function pie(doc, texto) {
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    // Sin margen inferior mientras se escribe el pie: si no, pdfkit cree que
    // se salió de la página y agrega una en blanco.
    const margenAntes = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGEN - 12;
    doc.moveTo(MARGEN, y - 8).lineTo(MARGEN + ancho(doc), y - 8).lineWidth(0.5).strokeColor(COLOR.borde).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(COLOR.tinta3);
    doc.text(texto, MARGEN, y, { width: ancho(doc) - 90, lineBreak: false });
    doc.text(`Página ${i + 1} de ${rango.count}`, MARGEN, y, { width: ancho(doc), align: 'right', lineBreak: false });
    doc.page.margins.bottom = margenAntes;
  }
}

/** Cierra el documento y devuelve sus bytes. */
function aBuffer(doc) {
  return new Promise((resolve, reject) => {
    const partes = [];
    doc.on('data', (p) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    doc.end();
  });
}

// ---- Formatos (iguales a los de la pantalla) ----

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2026-10-03 14:20:05' → '3 de octubre de 2026, 14:20'. Tal cual la guarda MySQL. */
function fecha(valor, { conHora = true } = {}) {
  if (!valor) return '';
  const [dia, hora = ''] = String(valor).replace('T', ' ').split(' ');
  const [a, m, d] = dia.split('-').map(Number);
  if (!a || !m || !d) return String(valor);
  const texto = `${d} de ${MESES[m - 1]} de ${a}`;
  return conHora && hora ? `${texto}, ${hora.slice(0, 5)}` : texto;
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Para tablas: '2026-07-01 09:00:00' → '1 jul 2026, 09:00'. */
function fechaCorta(valor) {
  if (!valor) return '';
  const [dia, hora = ''] = String(valor).replace('T', ' ').split(' ');
  const [a, m, d] = dia.split('-').map(Number);
  if (!a || !m || !d) return String(valor);
  return `${d} ${MESES_CORTOS[m - 1]} ${a}${hora ? ', ' + hora.slice(0, 5) : ''}`;
}

/** Kilos sin ceros de relleno y con miles: 1527.500 → '1,527.5 kg'. */
function kg(n) {
  return `${Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 3 })} kg`;
}

function numero(n) {
  return Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** Dinero con miles y dos decimales, el signo antes del símbolo. */
function dinero(n) {
  const v = Number(n ?? 0);
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

module.exports = {
  crear, encabezado, seccion, nota, datos, cifras, tabla, pie, aBuffer, linea,
  fecha, fechaCorta, kg, numero, dinero, COLOR,
};
