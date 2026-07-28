'use strict';

/**
 * Genera listas de empaque de prueba con el MISMO formato que manda el
 * proveedor, para poder capturar varios colores sin esperar mercancía real.
 *
 *   cd backend
 *   node scripts/generar-muestras-xlsx.js          # a ../muestras/
 *   node scripts/generar-muestras-xlsx.js ../otra  # a otra carpeta
 *
 * Escribe el .xlsx a mano (ZIP + XML), igual que `utils/xlsx.js` lo lee: sin
 * dependencias. Se copió la forma exacta del archivo real:
 *   A  código  → texto compartido (así conserva los ceros: "00531332")
 *   B  peso    → número
 *   C  lote    → texto compartido
 *   D,E fechas → la celda NO existe (vienen vacías)
 *   F  conos   → número
 *   G  paquete → número, siempre 1
 *
 * Los códigos de cada color van en un rango propio para que no choquen entre sí
 * ni con el archivo original: el sistema rechaza un código ya registrado.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// ---------------------------------------------------------------- ZIP mínimo
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf);
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Arma un ZIP (deflate) con las entradas dadas: [{nombre, datos}]. */
function zip(entradas) {
  const locales = [];
  const central = [];
  let offset = 0;

  for (const { nombre, datos } of entradas) {
    const crudo = Buffer.from(datos, 'utf8');
    const comprimido = zlib.deflateRawSync(crudo);
    const nombreBuf = Buffer.from(nombre, 'utf8');
    const suma = crc32(crudo);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // firma
    local.writeUInt16LE(20, 4); // versión
    local.writeUInt16LE(0, 6); // banderas
    local.writeUInt16LE(8, 8); // método: deflate
    local.writeUInt16LE(0, 10); // hora
    local.writeUInt16LE(0x21, 12); // fecha (1 ene 1980: fija, para que el archivo sea reproducible)
    local.writeUInt32LE(suma, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(crudo.length, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locales.push(local, nombreBuf, comprimido);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(suma, 16);
    dir.writeUInt32LE(comprimido.length, 20);
    dir.writeUInt32LE(crudo.length, 24);
    dir.writeUInt16LE(nombreBuf.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nombreBuf);

    offset += local.length + nombreBuf.length + comprimido.length;
  }

  const cuerpo = Buffer.concat(locales);
  const directorio = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(cuerpo.length, 16);
  return Buffer.concat([cuerpo, directorio, fin]);
}

// ------------------------------------------------------------------- .xlsx
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Construye el .xlsx. `filas` es una lista de bultos (o `null` para dejar un
 * renglón VACÍO, que el lector debe ignorar).
 */
function construirXlsx(filas) {
  // Cadenas compartidas: el encabezado y todos los textos (códigos y lotes).
  const compartidas = [];
  const idx = new Map();
  const texto = (v) => {
    if (!idx.has(v)) {
      idx.set(v, compartidas.length);
      compartidas.push(v);
    }
    return idx.get(v);
  };

  const encabezado = [
    'Código presentación*', 'Cantidad *', 'Lote',
    'Fecha produccion', 'Fecha caducidad', 'CONO', 'PAQUETE',
  ];
  const celdasEnc = encabezado
    .map((h, i) => `<c r="${'ABCDEFG'[i]}1" t="s"><v>${texto(h)}</v></c>`)
    .join('');

  const renglones = [`<row r="1">${celdasEnc}</row>`];
  let r = 2;
  for (const f of filas) {
    if (!f) {
      // Renglón en blanco: se salta el número de fila sin escribir celdas.
      r++;
      continue;
    }
    const c = [
      `<c r="A${r}" t="s"><v>${texto(f.codigo)}</v></c>`,
      `<c r="B${r}"><v>${f.peso}</v></c>`,
    ];
    // D y E no se escriben: así vienen en el archivo real.
    if (f.lote) c.push(`<c r="C${r}" t="s"><v>${texto(f.lote)}</v></c>`);
    if (f.conos) c.push(`<c r="F${r}"><v>${f.conos}</v></c>`);
    c.push(`<c r="G${r}"><v>1</v></c>`);
    renglones.push(`<row r="${r}">${c.join('')}</row>`);
    r++;
  }

  const sst =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `count="${compartidas.length}" uniqueCount="${compartidas.length}">` +
    compartidas.map((s) => `<si><t>${esc(s)}</t></si>`).join('') +
    `</sst>`;

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${renglones.join('')}</sheetData></worksheet>`;

  return zip([
    {
      nombre: '[Content_Types].xml',
      datos:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
        `</Types>`,
    },
    {
      nombre: '_rels/.rels',
      datos:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      nombre: 'xl/workbook.xml',
      datos:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="Presentaciones" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      datos:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
        `</Relationships>`,
    },
    { nombre: 'xl/worksheets/sheet1.xml', datos: sheet },
    { nombre: 'xl/sharedStrings.xml', datos: sst },
  ]);
}

// -------------------------------------------------------------- los colores
/**
 * Cada muestra varía a propósito para que las pruebas no sean todas iguales:
 * distinto número de bultos, distinto peso nominal, uno o varios lotes, y algún
 * caso raro (bultos que rinden menos conos, renglones vacíos).
 */
const MUESTRAS = [
  { color: 'BLANCO', calibre: '2-30', base: 610000, nominal: 19.1, bultos: 80, lotes: ['0101204', '0101318'], conos: 12 },
  { color: 'NEGRO', calibre: '2-30', base: 620000, nominal: 19.0, bultos: 40, lotes: ['0102550'], conos: 12 },
  { color: 'ROJO', calibre: '1-30', base: 630000, nominal: 22.4, bultos: 60, lotes: ['0103001', '0103115', '0103240'], conos: 16 },
  { color: 'VERDE BOTELLA', calibre: '2-30', base: 640000, nominal: 18.8, bultos: 24, lotes: ['0104780'], conos: 12, menores: 2 },
  { color: 'AMARILLO', calibre: '1-30', base: 650000, nominal: 22.6, bultos: 12, lotes: ['0105410'], conos: 16 },
  { color: 'ROSA MEXICANO', calibre: '2-30', base: 660000, nominal: 19.2, bultos: 100, lotes: ['0106100', '0106233', '0106350', '0106477'], conos: 12 },
  { color: 'GRIS PERLA', calibre: '2-30', base: 670000, nominal: 19.05, bultos: 36, lotes: ['0107620'], conos: 12, vacias: true },
  { color: 'BEIGE', calibre: '1-30', base: 680000, nominal: 22.0, bultos: 8, lotes: ['0108900'], conos: 16, dispersos: true },
];

/** Generador simple y determinista: las muestras salen iguales cada vez. */
function aleatorio(semilla) {
  let s = semilla;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function filasDe(mu) {
  const rnd = aleatorio(mu.base);
  const filas = [];
  for (let i = 0; i < mu.bultos; i++) {
    // Los pesos varían alrededor del nominal, como en el archivo real.
    const rango = mu.dispersos ? 3.5 : 0.6;
    const peso = Math.round((mu.nominal + (rnd() - 0.5) * rango) * 100) / 100;
    const lote = mu.lotes[Math.floor((i / mu.bultos) * mu.lotes.length)];
    filas.push({
      codigo: String(mu.base + i * 7).padStart(8, '0'),
      peso,
      lote,
      conos: mu.conos,
    });
    // Un renglón vacío cada 12, para comprobar que se ignoran.
    if (mu.vacias && i > 0 && i % 12 === 0) filas.push(null);
  }
  // Bultos que rinden menos conos: vienen así de fábrica.
  if (mu.menores) {
    for (let k = 0; k < mu.menores; k++) {
      const f = filas[filas.length - 1 - k];
      f.conos = mu.conos - 5;
      f.peso = Math.round(((f.peso * (mu.conos - 5)) / mu.conos) * 100) / 100;
    }
  }
  return filas;
}

const destino = path.resolve(process.argv[2] ?? path.join(__dirname, '..', '..', 'muestras'));
fs.mkdirSync(destino, { recursive: true });

console.log(`Generando en ${destino}\n`);
let totalKg = 0;
let totalBultos = 0;
for (const mu of MUESTRAS) {
  const filas = filasDe(mu);
  const reales = filas.filter(Boolean);
  const kg = Math.round(reales.reduce((s, f) => s + f.peso, 0) * 1000) / 1000;
  const nombre = `${mu.color} ${mu.calibre}.xlsx`;
  fs.writeFileSync(path.join(destino, nombre), construirXlsx(filas));
  totalKg += kg;
  totalBultos += reales.length;
  const extra = [
    mu.lotes.length > 1 ? `${mu.lotes.length} lotes` : '1 lote',
    mu.menores ? `${mu.menores} rinden menos conos` : null,
    mu.vacias ? `${filas.length - reales.length} renglones vacíos` : null,
    mu.dispersos ? 'pesos muy dispersos' : null,
  ].filter(Boolean);
  console.log(
    `  ${nombre.padEnd(26)} ${String(reales.length).padStart(3)} bultos · ` +
    `${String(kg).padStart(9)} kg · ${extra.join(' · ')}`
  );
}
console.log(`\n  TOTAL: ${totalBultos} bultos · ${Math.round(totalKg * 1000) / 1000} kg en ${MUESTRAS.length} archivos`);
