'use strict';

/**
 * Prueba de punta a punta de la LISTA COMPLETA del proveedor (varios hilos en
 * un archivo), contra el servidor y la base reales.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &        # en otra terminal
 *   node scripts/e2e-carga-lista.js       # BASE=http://localhost:3210/api/v1
 *
 * Arma su propio Excel con el formato del inventario del proveedor (hojas
 * GLOBAL, RESUMEN y DOCUMENTO) y nombres TMP, lo carga, revisa lo que creó —
 * hilos sin precio, presentación, bultos, inventario, kardex, aviso de la
 * campana, candado de venta, PDF— y al terminar borra todo lo suyo. Sale con
 * código 1 si alguna comprobación falla.
 */

const path = require('node:path');
const zlib = require('node:zlib');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// Se niega a correr contra la base del servidor. Ver el módulo.
require('./_no-en-produccion');
const { soloPropios } = require('./_propios');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const BASE = process.env.BASE ?? 'http://localhost:3210/api/v1';
const token = jwt.sign(
  { sub: 1, tipo: 'usuario', rol_id: 1, rol: 'administrador' },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

// Cada corrida usa códigos propios para no chocar con otra ni con lo real.
const SUF = Date.now().toString(36).toUpperCase();
const cod = (n) => `TMPL${SUF}${String(n).padStart(3, '0')}`;

let fallas = 0;
function ck(nombre, ok, detalle) {
  console.log(`${ok ? '  ok  ' : ' FALLA'} · ${nombre}${detalle !== undefined ? ` → ${detalle}` : ''}`);
  if (!ok) fallas++;
}

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

async function subir(buffer, nombre) {
  const r = await fetch(`${BASE}/remesas/lista/previa`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'X-Nombre-Archivo': nombre,
    },
    body: buffer,
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

// ------------------------------------------------------------ un .xlsx mínimo
//
// Lo justo para armar el archivo de prueba sin dependencias: un ZIP con el
// libro, sus relaciones y una hoja por tabla. Las celdas de texto van como
// inlineStr (como las escribe el programa que arma el inventario) y los
// números como número; `{ n: '626842' }` escribe un código como NÚMERO, para
// probar el que perdió los ceros.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const letra = (i) => String.fromCharCode(65 + i);

function hojaXml(filas) {
  const rows = filas
    .map((fila, r) => {
      const celdas = fila
        .map((v, c) => {
          const ref = `${letra(c)}${r + 1}`;
          if (v === null || v === undefined || v === '') return '';
          if (typeof v === 'number') return `<c r="${ref}" t="n"><v>${v}</v></c>`;
          if (typeof v === 'object' && v.n !== undefined) return `<c r="${ref}"><v>${v.n}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${celdas}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

function zip(entradas) {
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

/** Un libro con varias hojas: `{ GLOBAL: filas, RESUMEN: filas, … }`. */
function libro(hojas) {
  const nombres = Object.keys(hojas);
  const entradas = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    [
      'xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        nombres.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    ],
    [
      'xl/_rels/workbook.xml.rels',
      // Una relativa y las demás absolutas, como mezclan los programas reales.
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        nombres
          .map((n, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="${i === 0 ? '' : '/xl/'}worksheets/sheet${i + 1}.xml"/>`)
          .join('') +
        '</Relationships>',
    ],
    ...nombres.map((n, i) => [`xl/worksheets/sheet${i + 1}.xml`, hojaXml(hojas[n])]),
  ];
  return zip(entradas);
}

const ENCABEZADO = ['BOX NO', 'COLOR', 'CALIBRE', 'LOT', 'GROSS', 'TARE', 'NET', 'CONOS', 'CODIGO COLOR', 'ARTICULO', 'NOTA'];
const ART = '%100 ACRYLIC 2\\36x30 Nm HB';

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const antes = {};
  for (const t of ['productos', 'almacenes', 'remesas']) {
    antes[t] = new Set((await db.query(`SELECT id FROM ${t}`))[0].map((r) => r.id));
  }

  try {
    // ------------------------------------------------------------ preparación
    const [[acrilan]] = await db.query("SELECT id, calibres FROM categorias WHERE nombre = 'ACRILAN'");
    const [[turco]] = await db.query("SELECT id FROM lineas WHERE nombre = 'Turco'");
    const [[kg]] = await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg'");
    const alm = (await api('POST', '/almacenes', { nombre: 'TMP Bodega Lista' })).data.id;
    // Un hilo que YA existe (con precio): la lista le agrega bultos.
    const azul = await api('POST', '/productos', {
      categoria_id: acrilan.id, unidad_medida_id: kg.id, nombre: 'TMPL AZUL', grosor_calibre: '2/30',
      precio_kg: 150, multipresentacion: true,
    });
    const azulId = azul.data.id;

    // El archivo, con el formato del inventario del proveedor.
    const global = [
      ['TOTAL', '', '', '', '', '', '', '', '', '', ''],
      ENCABEZADO,
      [cod(1), 'TMPL ROJO', '2/30', 'TL1', 19.8, 0.8, 19, 12, 'L1/ROJO', ART, ''],
      [cod(2), 'TMPL ROJO', '2/30', 'TL1', 20.3, 0.8, 19.5, 12, 'L1/ROJO', ART, 'AVISO: NET releído'],
      // Escrito distinto (minúsculas, calibre con guion): es el MISMO hilo.
      [cod(3), 'tmpl rojo', '2-30', 'TL1', 19.0, 0.8, 18.2, 12, 'L1/ROJO', ART, ''],
      // Bruto − tara no da el neto: solo avisa.
      [cod(4), 'TMPL ROJO', '2/30', 'TL1', 20.0, 0.8, 18.0, 12, 'L1/ROJO', ART, ''],
      [],
      // El mismo color en otro calibre: OTRO hilo.
      [cod(5), 'TMPL ROJO', '1/30', 'TL2', 15.8, 0.8, 15, 7, 'L1/ROJO', ART, ''],
      [cod(6), 'TMPL ROJO', '1/30', 'TL2', 16.8, 0.8, 16, 12, 'L1/ROJO', ART, ''],
      // Al hilo que ya existe.
      [cod(7), 'TMPL AZUL', '2/30', 'TL3', 20.8, 0.8, 20, 12, 'L2/AZUL', ART, ''],
    ];
    const resumen = [
      ['LOT', 'COLOR', 'CALIBRE', 'CAJAS', 'CONOS', 'NET KG'],
      ['TL1', 'TMPL ROJO', '2/30', 4, 48, 74.7],
      ['TL2', 'TMPL ROJO', '1/30', 2, 19, 31],
      ['TL3', 'TMPL AZUL', '2/30', 1, 12, 20],
      ['TOTAL', '', '', 7, 79, 125.7],
    ];
    const documento = [
      ['DATOS DEL DOCUMENTO'],
      ['Proveedor', 'TMP Proveedor'],
      ['Belge No', 'TMP123'],
      ['Belge Tarihi', '01.10.2026'],
    ];
    const archivo = libro({ GLOBAL: global, RESUMEN: resumen, DOCUMENTO: documento, INCIDENCIAS: [['TIPO', 'DETALLE']] });

    // ------------------------------------------------------------ 1. vista previa
    console.log('=== 1. Vista previa de la lista ===');
    let r = await subir(archivo, 'TMP INVENTARIO.xlsx');
    ck('lee la hoja GLOBAL', r.status === 200 && r.data?.hoja === 'GLOBAL', r.data?.hoja ?? JSON.stringify(r.error));
    const p = r.data;
    ck('3 hilos: color + calibre, sin importar cómo se escribió', p.resumen.num_hilos === 3,
      p.hilos.map((h) => `${h.nombre} ${h.calibre} (${h.num_bultos})`).join(' · '));
    const rojo2 = p.hilos.find((h) => h.calibre === '2/30' && /ROJO/i.test(h.nombre));
    const rojo1 = p.hilos.find((h) => h.calibre === '1/30');
    const az = p.hilos.find((h) => /AZUL/.test(h.nombre));
    ck('el ROJO 2/30 junta los 4 bultos (también el "tmpl rojo 2-30")', rojo2?.num_bultos === 4, rojo2?.num_bultos);
    ck('el nombre del hilo es el del Excel, tal cual', rojo2?.nombre === 'TMPL ROJO', rojo2?.nombre);
    ck('ROJO 2/30 y 1/30 son nuevos', rojo2?.estado === 'nuevo' && rojo1?.estado === 'nuevo');
    ck('el AZUL ya existe y tiene precio', az?.estado === 'existe' && az?.producto?.tiene_precio === true,
      JSON.stringify(az?.producto));
    ck('se carga el NETO', rojo2?.kg_total === 74.7, rojo2?.kg_total);
    ck('peso promedio real', rojo2?.peso_promedio === 18.675, rojo2?.peso_promedio);
    ck('lee proveedor, número y fecha', p.documento?.proveedor === 'TMP Proveedor' && p.documento?.numero === 'TMP123',
      JSON.stringify(p.documento));
    ck('cuadra con el resumen por lote', p.control?.cuadra === true, JSON.stringify(p.control));
    ck('avisa la NOTA del proveedor', p.avisos.some((a) => /NET releído/.test(a.mensaje)));
    ck('avisa cuando bruto − tara no da el neto', p.avisos.some((a) => /bruto 20 − tara 0.8/.test(a.mensaje)),
      p.avisos.map((a) => a.mensaje).join(' | '));
    ck('sugiere el material por el ARTÍCULO (ACRYLIC → ACRILAN)', p.material_sugerido_id === acrilan.id, p.material_sugerido_id);
    ck('se puede cargar', p.se_puede_cargar === true && p.errores.length === 0, JSON.stringify(p.errores));

    // ------------------------------------------------------------ 2. lo que impide cargar
    console.log('\n=== 2. Lo que impide cargar ===');
    const malo = libro({
      GLOBAL: [
        ENCABEZADO,
        [cod(11), 'TMPL MAL', '2/30', 'X', '', '', 19, 12, '', ART, ''],
        [cod(11), 'TMPL MAL', '2/30', 'X', '', '', 19, 12, '', ART, ''],
        [cod(12), 'TMPL MAL', '2/30', 'X', '', '', '', 12, '', ART, ''],
        [cod(13), '', '2/30', 'X', '', '', 19, 12, '', ART, ''],
        // Un código guardado como número: perdió los ceros de la izquierda.
        [{ n: '626842' }, 'TMPL MAL', '2/30', 'X', '', '', 19, 12, '', ART, ''],
      ],
    });
    r = await subir(malo, 'TMP MALO.xlsx');
    const errs = (r.data?.errores ?? []).map((e) => e.mensaje);
    ck('no se puede cargar', r.data?.se_puede_cargar === false, errs.length);
    ck('código repetido', errs.some((e) => /ya venía en el renglón 2/.test(e)));
    ck('peso vacío', errs.some((e) => /peso neto está vacío/.test(e)));
    ck('falta el COLOR', errs.some((e) => /falta el COLOR/.test(e)));
    ck('código que perdió los ceros', errs.some((e) => /perdió los ceros/.test(e)), errs.join(' | '));

    r = await subir(libro({ HOJA1: [['CODIGO', 'PESO']] }), 'TMP OTRO.xlsx');
    ck('otro formato: dice qué columna falta', r.status === 422 && /COLOR/.test(r.error?.message ?? ''), r.error?.message);

    // ------------------------------------------------------------ 3. guardas al confirmar
    console.log('\n=== 3. Guardas al confirmar (no crean nada) ===');
    const hilos = p.hilos.map((h) => ({ nombre: h.nombre, calibre: h.calibre, bultos: h.bultos }));
    const cuantos = async () => (await db.query('SELECT COUNT(*) n FROM productos'))[0][0].n;
    const n0 = await cuantos();
    r = await api('POST', '/remesas/lista', { almacen_id: alm, hilos });
    ck('hilos nuevos sin material: 422 FALTA_MATERIAL', r.status === 422 && r.error?.code === 'FALTA_MATERIAL', r.error?.code);
    r = await api('POST', '/remesas/lista', {
      almacen_id: alm, categoria_id: acrilan.id,
      hilos: [{ nombre: 'TMPL RARO', calibre: '9/99', bultos: [{ codigo: cod(20), peso_kg: 10 }] }],
    });
    ck('calibre que el material no tiene: 422', r.status === 422 && r.error?.code === 'CALIBRE_NO_DEL_MATERIAL', r.error?.message);
    r = await api('POST', '/remesas/lista', {
      almacen_id: alm, categoria_id: acrilan.id,
      hilos: [
        { nombre: 'TMPL DOBLE', calibre: '2/30', bultos: [{ codigo: cod(21), peso_kg: 10 }] },
        { nombre: 'TMPL DOBLE', calibre: '1/30', bultos: [{ codigo: cod(21), peso_kg: 10 }] },
      ],
    });
    ck('código repetido entre hilos: 422', r.status === 422 && r.error?.code === 'CODIGOS_REPETIDOS', r.error?.code);
    ck('ninguna guarda dejó productos', (await cuantos()) === n0);

    // ------------------------------------------------------------ 4. la carga
    console.log('\n=== 4. Carga de la lista ===');
    r = await api('POST', '/remesas/lista', {
      almacen_id: alm, categoria_id: acrilan.id, linea_id: turco.id, archivo: 'TMP INVENTARIO.xlsx',
      documento: p.documento,
      hilos: hilos.map((h) => (h.calibre === '2/30' && /ROJO/i.test(h.nombre) ? { ...h, costo_kg: 95 } : h)),
    });
    ck('carga 201', r.status === 201, JSON.stringify(r.error));
    const res = r.data;
    ck('3 cargas, 2 hilos nuevos, 7 bultos', res.num_hilos === 3 && res.nuevos === 2 && res.num_bultos === 7,
      `${res.num_hilos} · ${res.nuevos} · ${res.num_bultos}`);
    ck('125.7 kg en total', res.kg_total === 125.7, res.kg_total);
    ck('dice cuáles quedaron sin precio (los 2 nuevos)', res.sin_precio.length === 2,
      res.sin_precio.map((s) => s.hilo).join(', '));

    const cRojo2 = res.cargas.find((c) => c.hilo === 'TMPL ROJO 2/30');
    const [[prod]] = await db.query(
      `SELECT p.*, pv.id vid, pv.sku, pv.codigo_barras, pv.precio, pv.peso_kg, pv.tipo_presentacion, pv.costo
         FROM productos p JOIN producto_variantes pv ON pv.producto_id = p.id WHERE p.id = ?`, [cRojo2.producto_id]);
    ck('el hilo se creó con el nombre y el calibre del Excel', prod.nombre === 'TMPL ROJO' && prod.grosor_calibre === '2/30');
    ck('con el material y la línea elegidos', prod.categoria_id === acrilan.id && prod.linea_id === turco.id);
    ck('multipresentación y sin precio por kilo', prod.multipresentacion === 1 && prod.precio_kg === null);
    ck('su paquete en $0 con el peso promedio real', prod.tipo_presentacion === 'paquete' && Number(prod.precio) === 0 &&
      Number(prod.peso_kg) === 18.675, `${prod.precio} · ${prod.peso_kg}`);
    ck('SKU = nombre + calibre', prod.sku === 'TMPL-ROJO-2-30' && prod.codigo_barras === prod.sku, prod.sku);
    ck('el precio de compra entró al costo', Number(prod.costo) === 95, prod.costo);

    const [bultos] = await db.query('SELECT codigo, peso_kg, lote, conos, almacen_id, estado FROM variante_codigos WHERE variante_id = ? ORDER BY codigo', [prod.vid]);
    ck('4 bultos con su lote, conos y almacén', bultos.length === 4 && bultos.every((b) => b.lote === 'TL1' && b.almacen_id === alm && b.estado === 'disponible'),
      bultos.map((b) => `${b.codigo}:${b.peso_kg}`).join(' '));
    const [[inv]] = await db.query('SELECT cantidad FROM inventario WHERE variante_id = ? AND almacen_id = ?', [prod.vid, alm]);
    ck('el inventario recibe la suma', Number(inv?.cantidad) === 74.7, inv?.cantidad);
    const [[rem]] = await db.query('SELECT notas, num_bultos FROM remesas WHERE id = ?', [cRojo2.id]);
    ck('la carga anota proveedor y lista', /TMP Proveedor · lista TMP123 del 01\.10\.2026/.test(rem.notas ?? ''), rem.notas);
    const [[mov]] = await db.query("SELECT COUNT(*) n FROM movimientos_inventario WHERE referencia_tipo = 'remesa' AND referencia_id IN (?)", [res.ids]);
    ck('una entrada de kardex por carga', mov.n === 3, mov.n);

    const [[azulVar]] = await db.query('SELECT pv.id, pv.precio FROM producto_variantes pv WHERE pv.producto_id = ?', [azulId]);
    const [[invAz]] = await db.query('SELECT cantidad FROM inventario WHERE variante_id = ? AND almacen_id = ?', [azulVar.id, alm]);
    ck('el hilo que ya existía recibió sus bultos y conserva su precio', Number(invAz?.cantidad) === 20 && Number(azulVar.precio) === 150);

    r = await api('POST', '/remesas/lista', { almacen_id: alm, categoria_id: acrilan.id, hilos });
    ck('la misma lista otra vez: 409, no entra nada', r.status === 409 && r.error?.code === 'CODIGOS_DUPLICADOS', r.error?.code);

    // ------------------------------------------------------------ 5. el aviso y el candado
    console.log('\n=== 5. Aviso de precio y candado de venta ===');
    r = await api('GET', '/notificaciones');
    const sp = r.data?.sin_precio;
    ck('la campana avisa de los hilos sin precio', sp?.num >= 2 && sp.hilos.some((h) => h.nombre === 'TMPL ROJO'),
      `${sp?.num} · ${sp?.hilos.map((h) => h.nombre + ' ' + h.calibre).join(', ')}`);
    r = await api('GET', `/productos/${cRojo2.producto_id}`);
    ck('el producto dice que le falta precio y cuándo llegó', !!r.data?.sin_precio && !!r.data?.primera_carga,
      `${r.data?.sin_precio} · ${r.data?.primera_carga}`);

    const cotizar = () =>
      api('POST', '/pedidos/cotizacion', { canal: 'tienda_linea', almacen_id: alm, items: [{ variante_id: prod.vid, cantidad: 1 }] });
    r = await cotizar();
    ck('no se puede vender sin precio: 422 SIN_PRECIO', r.status === 422 && r.error?.code === 'SIN_PRECIO', r.error?.message);

    r = await api('PUT', `/productos/${cRojo2.producto_id}`, { precio_kg: 210 });
    const [[despues]] = await db.query('SELECT precio FROM producto_variantes WHERE id = ?', [prod.vid]);
    ck('al ponerle precio por kilo, su paquete lo toma', r.status === 200 && Number(despues.precio) === 210, despues.precio);
    r = await cotizar();
    ck('ya se puede vender', r.status === 200 && Number(r.data?.lineas?.[0]?.precio_unitario) === 210,
      r.status === 200 ? r.data.lineas[0].precio_unitario : r.error?.code);
    r = await api('GET', '/notificaciones');
    ck('y sale del aviso de la campana', !r.data.sin_precio.hilos.some((h) => h.nombre === 'TMPL ROJO' && h.calibre === '2/30'));

    // ------------------------------------------------------------ 6. el PDF de la lista
    console.log('\n=== 6. PDF de toda la lista ===');
    const pdf = await fetch(`${BASE}/remesas/pdf?ids=${res.ids.join(',')}`, { headers: { Authorization: `Bearer ${token}` } });
    const bytes = Buffer.from(await pdf.arrayBuffer());
    const paginas = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    ck('es un PDF', pdf.status === 200 && bytes.subarray(0, 4).toString() === '%PDF', pdf.headers.get('content-type'));
    ck('el resumen y una página por hilo', paginas >= 4, `${paginas} páginas`);
    r = await api('GET', '/remesas/pdf?ids=abc');
    ck('sin ids válidos: 422', r.status === 422, r.error?.code);

    // ------------------------------------------------------------ 7. con avance
    // Lo que usa la pantalla: la respuesta llega POR PARTES (un JSON por
    // renglón) y dice qué hilo va y cuántos bultos van. 150 bultos de un hilo
    // nuevo = dos tandas de inserción (100 + 50), más 30 de uno que ya existe.
    console.log('\n=== 7. Carga con avance (la que usa la pantalla) ===');
    const verde = Array.from({ length: 150 }, (_, i) => ({ codigo: cod(100 + i), peso_kg: 19, lote: 'TV1', conos: 12 }));
    const rojoMas = Array.from({ length: 30 }, (_, i) => ({ codigo: cod(300 + i), peso_kg: 18.5, lote: 'TR9', conos: 12 }));
    const resp = await fetch(`${BASE}/remesas/lista?progreso=1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        almacen_id: alm, categoria_id: acrilan.id, archivo: 'TMP AVANCE.xlsx',
        hilos: [{ nombre: 'TMPL VERDE', calibre: '2/30', bultos: verde }, { nombre: 'TMPL ROJO', calibre: '2/30', bultos: rojoMas }],
      }),
    });
    ck('contesta por partes (NDJSON), sin que nginx las junte',
      resp.status === 200 && /ndjson/.test(resp.headers.get('content-type') ?? '') && resp.headers.get('x-accel-buffering') === 'no',
      resp.headers.get('content-type'));
    // Se lee como lo lee el navegador: trozo por trozo, conforme llega.
    let texto = '';
    let trozos = 0;
    const lector = resp.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      trozos++;
      texto += Buffer.from(value).toString('utf8');
    }
    const ev = texto.trim().split('\n').map((l) => JSON.parse(l));
    const tipos = ev.map((e) => e.tipo);
    ck('llega en varios trozos, no todo al final', trozos >= 2, `${trozos} trozos`);
    ck('dice qué hace: revisa, cada hilo, los bultos, guarda y termina',
      tipos[0] === 'paso' && tipos.at(-1) === 'fin' && tipos.filter((t) => t === 'hilo').length === 2 &&
        tipos.filter((t) => t === 'hilo_listo').length === 2,
      tipos.join(' > '));
    const hilosEv = ev.filter((e) => e.tipo === 'hilo');
    ck('distingue el hilo nuevo del que ya existe', hilosEv[0].nuevo === true && hilosEv[1].nuevo === false,
      hilosEv.map((e) => `${e.hilo}: ${e.nuevo ? 'nuevo' : 'existe'}`).join(', '));
    const cuenta = ev.filter((e) => e.tipo === 'bultos').map((e) => e.hechos);
    ck('los bultos van de cien en cien y suman todo', JSON.stringify(cuenta) === '[100,150,180]', cuenta.join(', '));
    const fin = ev.at(-1).data;
    ck('el final trae el resultado de la carga', fin?.num_bultos === 180 && fin?.num_hilos === 2 && fin?.nuevos === 1,
      `${fin?.num_bultos} bultos · ${fin?.num_hilos} hilos · ${fin?.nuevos} nuevo`);
    const [[nv]] = await db.query(
      'SELECT COUNT(*) n, SUM(peso_kg) kg FROM variante_codigos WHERE codigo LIKE ? AND lote = ?', [`TMPL${SUF}%`, 'TV1']);
    ck('los 150 bultos del hilo nuevo quedaron guardados', nv.n === 150 && Number(nv.kg) === 2850, `${nv.n} · ${nv.kg} kg`);

    // Un error dentro de la carga llega como renglón "error" y no deja nada.
    const n1 = await cuantos();
    const conError = await fetch(`${BASE}/remesas/lista?progreso=1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ almacen_id: alm, categoria_id: acrilan.id, hilos: [{ nombre: 'TMPL OTRA', calibre: '2/30', bultos: verde.slice(0, 1) }] }),
    });
    const evErr = (await conError.text()).trim().split('\n').map((l) => JSON.parse(l));
    ck('un código ya cargado llega como "error" con su motivo', evErr.at(-1).tipo === 'error' &&
      evErr.at(-1).error.code === 'CODIGOS_DUPLICADOS', evErr.at(-1).error?.message);
    ck('y no deja nada a medias', (await cuantos()) === n1);
    r = await api('POST', '/remesas/lista?progreso=1', { almacen_id: alm, hilos: [] });
    ck('un cuerpo inválido sigue contestando 422 en JSON', r.status === 422 && r.error?.code === 'VALIDACION', r.error?.code);
  } catch (e) {
    console.error('\nERROR:', e.message, e.stack);
    fallas++;
  } finally {
    console.log('\n=== Limpieza ===');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    // Solo lo NUEVO que sea de la prueba (prefijo TMP). Ver _propios.js.
    const nuevos = soloPropios(db, antes);
    for (const id of await nuevos('productos')) {
      const sub = '(SELECT id FROM producto_variantes WHERE producto_id = ?)';
      for (const tabla of ['variante_codigos', 'movimientos_inventario', 'inventario']) {
        await db.query(`DELETE FROM ${tabla} WHERE variante_id IN ${sub}`, [id]);
      }
      await db.query(`DELETE FROM remesas WHERE variante_id IN ${sub}`, [id]);
      await db.query('DELETE FROM producto_variantes WHERE producto_id = ?', [id]);
      await db.query('DELETE FROM productos WHERE id = ?', [id]);
    }
    for (const id of await nuevos('remesas')) await db.query('DELETE FROM remesas WHERE id = ?', [id]);
    for (const id of await nuevos('almacenes')) await db.query('DELETE FROM almacenes WHERE id = ?', [id]);
    await db.query('DELETE FROM variante_codigos WHERE codigo LIKE ?', [`TMPL${SUF}%`]);
    await db.query('SET FOREIGN_KEY_CHECKS = 1');

    const [[{ pr }]] = await db.query('SELECT COUNT(*) pr FROM productos');
    const [[{ rr }]] = await db.query('SELECT COUNT(*) rr FROM remesas');
    const [[{ aa }]] = await db.query('SELECT COUNT(*) aa FROM almacenes');
    ck('la base quedó como antes',
      pr === antes.productos.size && rr === antes.remesas.size && aa === antes.almacenes.size,
      `${pr} productos · ${rr} remesas · ${aa} almacenes`);
    await db.end();
    console.log(fallas ? `\n${fallas} comprobación(es) fallaron.` : '\nTodo bien.');
    process.exit(fallas ? 1 : 0);
  }
})();
