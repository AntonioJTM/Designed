'use strict';

/**
 * Comprobante de transferencia en PDF para los pedidos en línea de la muestra.
 *
 * Es un PDF mínimo escrito a mano (Helvetica, WinAnsi), sin dependencias. Va
 * rotulado como DEMOSTRACIÓN en grande: es un documento de prueba y no debe
 * poder confundirse con un comprobante bancario real.
 */

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const dinero = (n) =>
  '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MXN';

function comprobantePdf({ fecha, monto, ordenante, concepto, rastreo, banco, clabe, titular }) {
  const ops = [];
  // Franja de encabezado y recuadro del monto.
  ops.push('0.12 0.25 0.45 rg 0 762 595 80 re f');
  ops.push('0.95 0.96 0.98 rg 48 560 499 120 re f');
  ops.push('0.85 0.20 0.20 rg 48 96 499 34 re f');

  const textos = [
    // [fuente, tamaño, x, y, texto, color]
    ['F2', 20, 48, 800, 'Comprobante de transferencia SPEI', '1 1 1'],
    ['F1', 11, 48, 778, 'Documento de demostración generado por el sistema', '0.85 0.9 1'],
    ['F1', 11, 64, 655, 'Monto transferido', '0.35 0.38 0.42'],
    ['F2', 30, 64, 615, dinero(monto), '0.1 0.12 0.15'],
    ['F1', 11, 64, 585, `Fecha y hora: ${fecha}`, '0.35 0.38 0.42'],
  ];

  const filas = [
    ['Ordenante', ordenante],
    ['Banco destino', banco],
    ['Cuenta CLABE', clabe],
    ['Beneficiario', titular],
    ['Concepto', concepto],
    ['Clave de rastreo', rastreo],
    ['Estado', 'Liquidada'],
  ];
  let y = 520;
  for (const [k, v] of filas) {
    textos.push(['F1', 11, 48, y, k, '0.35 0.38 0.42']);
    textos.push(['F2', 12, 200, y, v, '0.1 0.12 0.15']);
    ops.push(`0.88 0.9 0.93 rg 48 ${y - 12} 499 0.8 re f`);
    y -= 34;
  }
  textos.push(['F2', 13, 64, 108, 'DEMOSTRACIÓN · NO ES UN COMPROBANTE BANCARIO REAL', '1 1 1']);

  ops.push('BT');
  for (const [f, tam, x, yy, t, color] of textos) {
    ops.push(`${color} rg /${f} ${tam} Tf 1 0 0 1 ${x} ${yy} Tm (${esc(t)}) Tj`);
  }
  ops.push('ET');
  const contenido = ops.join('\n');

  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(contenido, 'latin1')} >>\nstream\n${contenido}\nendstream`,
  ];

  // Todo es Latin-1 (los acentos del español caben), así que la longitud en
  // caracteres es la longitud en bytes y los offsets del xref salen exactos.
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objetos.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

module.exports = { comprobantePdf };
