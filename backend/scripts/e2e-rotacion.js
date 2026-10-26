'use strict';

/**
 * Prueba de punta a punta de ROTACIÓN DE INVENTARIO (2026-10-22), contra el
 * servidor y la base de PRUEBAS.
 *
 *   cd backend
 *   DB_NAME=desarrollo PORT=3210 node src/server.js &      # en otra terminal
 *   DB_NAME=desarrollo E2E_ACEPTO_PRODUCCION=si node scripts/e2e-rotacion.js
 *
 * Revisa que:
 *   · lo vendido en 12 meses de cada hilo sea lo mismo que Reportes → Venta por
 *     color en el mismo rango, y lo que hay, lo mismo que el inventario;
 *   · «Qué pedir» cuadre: pedir = se acaba − (proveedor + colchón) semanas, cuánto
 *     de 10 en 10, y el archivo para el proveedor traiga esos hilos sin precios;
 *   · los ajustes validen y se guarden (y los regresa como estaban);
 *   · las ventas de años anteriores pasen por su vista previa, no carguen con
 *     errores, se carguen, cuenten en la historia y en Temporadas, y una segunda
 *     carga del mismo mes REEMPLACE;
 *   · quien no tiene «Rotación de inventario» no entre.
 * Usa el año 2021 (la base de pruebas no tiene ventas de entonces) y al terminar
 * borra lo que cargó. Sale con código 1 si alguna comprobación falla.
 */

const path = require('node:path');
const zlib = require('node:zlib');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// Se niega a correr contra la base del servidor. Ver el módulo.
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const BASE = process.env.BASE ?? 'http://localhost:3210/api/v1';
const firmar = (sub, rol) => jwt.sign({ sub, tipo: 'usuario', rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
const ADMIN = firmar(1, 'administrador');
const ANIO = 2021;

let fallas = 0;
let total = 0;
function ck(nombre, ok, detalle) {
  total++;
  console.log(`${ok ? '  ok  ' : ' FALLA'} · ${nombre}${detalle !== undefined ? ` → ${detalle}` : ''}`);
  if (!ok) fallas++;
}

async function api(metodo, ruta, cuerpo, token = ADMIN) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

async function subir(ruta, buffer) {
  const r = await fetch(BASE + ruta, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/octet-stream' },
    body: buffer,
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

// ------------------------------------------------------------ un .xlsx mínimo
// (el mismo de e2e-carga-lista.js: un ZIP con el libro y una hoja, sin dependencias)

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

function xlsx(filas) {
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ventas" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', hojaXml(filas)],
  ]);
}

const sumarDias = (dia, n) => {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // Lo que hay antes, para dejarlo igual.
  const [ajustesAntes] = await db.query("SELECT clave, valor FROM configuracion WHERE clave LIKE 'rotacion\\_%'");
  const [[{ maxId }]] = await db.query('SELECT COALESCE(MAX(id), 0) AS maxId FROM ventas_anteriores');
  const [[{ yaHabia }]] = await db.query('SELECT COUNT(*) AS yaHabia FROM ventas_anteriores');

  try {
    // ------------------------------------------------------------ resumen
    console.log('\n— Resumen: lo vendido y lo que hay cuadran con Reportes e Inventario');
    const r = await api('GET', '/rotacion/resumen');
    ck('GET /rotacion/resumen', r.status === 200, r.status);
    const res = r.data;
    ck('trae su historia', ['poca', 'sin_temporada', 'completa', 'confiable'].includes(res.historia.nivel), res.historia.nivel);
    const hoy = res.hoy;

    const vpc = await api('GET', `/reportes/venta-por-color?desde=${sumarDias(hoy, -364)}&hasta=${hoy}`);
    ck('GET /reportes/venta-por-color', vpc.status === 200, vpc.status);
    const porColor = new Map((vpc.data?.hilos ?? vpc.data?.filas ?? []).map((f) => [Number(f.producto_id), Number(f.kg_vendidos)]));
    const difs = res.ranking.filter((h) => Math.abs((porColor.get(h.producto_id) ?? 0) - h.vendido_12m) > 0.5);
    ck(`lo vendido en 12 meses de los ${res.ranking.length} hilos = Venta por color`, porColor.size > 0 && difs.length === 0,
      difs.slice(0, 3).map((h) => `${h.hilo}: ${h.vendido_12m} vs ${porColor.get(h.producto_id)}`).join('; ') || 'igual');
    const suma = res.ranking.reduce((s, h) => s + h.vendido_12m, 0);
    ck('la cifra de arriba es la suma de la tabla', Math.abs(suma - res.cifras.vendido_12m) < 1, `${suma} / ${res.cifras.vendido_12m}`);

    const [inv] = await db.query(
      `SELECT pv.producto_id, SUM(i.cantidad) AS kg FROM inventario i
         JOIN producto_variantes pv ON pv.id = i.variante_id GROUP BY pv.producto_id`
    );
    const hayInv = new Map(inv.map((x) => [Number(x.producto_id), Number(x.kg)]));
    const difInv = res.ranking.filter((h) => Math.abs((hayInv.get(h.producto_id) ?? 0) - (h.hay.kg - h.hay.en_camino)) > 0.01);
    ck('lo que hay de cada hilo = el inventario (más lo que viene en camino)', difInv.length === 0,
      difInv.slice(0, 3).map((h) => `${h.hilo}: ${h.hay.kg - h.hay.en_camino} vs ${hayInv.get(h.producto_id)}`).join('; ') || 'igual');

    // ------------------------------------------------------------ qué pedir
    console.log('\n— Qué pedir');
    const q = await api('GET', '/rotacion/que-pedir');
    ck('GET /rotacion/que-pedir', q.status === 200, q.status);
    const aj = q.data.ajustes;
    const semanas = aj.semanas_proveedor + aj.semanas_colchon;
    const conFecha = q.data.hilos.filter((h) => h.se_acaba && h.pedir);
    const malPedir = conFecha.filter((h) => sumarDias(h.se_acaba, -semanas * 7) !== h.pedir);
    ck(`pedir = se acaba − ${semanas} semanas (${conFecha.length} hilos)`, conFecha.length > 0 && malPedir.length === 0,
      malPedir.slice(0, 2).map((h) => `${h.hilo}: ${h.se_acaba} → ${h.pedir}`).join('; ') || 'bien');
    const pedibles = q.data.hilos.filter((h) => h.pedido && h.pedido.kg > 0);
    ck('cuánto pedir va de 10 en 10', pedibles.every((h) => h.pedido.kg % 10 === 0), pedibles.length);
    const estados = new Set(['ya', 'pronto', 'calma', 'sobra', 'sin_datos']);
    ck('cada hilo trae un estado que se conoce', q.data.hilos.every((h) => estados.has(h.estado)));
    const enOrden = q.data.hilos.map((h) => ['ya', 'pronto', 'calma', 'sobra', 'sin_datos'].indexOf(h.estado));
    ck('van del más urgente al que puede esperar', enOrden.every((x, i) => i === 0 || x >= enOrden[i - 1]));
    const t = q.data.totales;
    const sumaYa = q.data.hilos.filter((h) => h.estado === 'ya').reduce((s, h) => s + (h.pedido?.kg ?? 0), 0);
    ck('«Pedir ya» suma lo de sus hilos', Math.abs(sumaYa - t.ya.kg) < 1, `${sumaYa} / ${t.ya.kg}`);

    if (pedibles.length) {
      const ids = pedibles.slice(0, 2).map((h) => h.producto_id);
      const csvR = await fetch(`${BASE}/rotacion/que-pedir.csv?hilos=${ids.join(',')}`, { headers: { Authorization: `Bearer ${ADMIN}` } });
      // Los bytes en crudo: `text()` se come el BOM al decodificar.
      const bytes = Buffer.from(await csvR.arrayBuffer());
      const csv = bytes.toString('utf8');
      const lineas = csv.replace(/^﻿/, '').trim().split(/\r\n/);
      ck('el archivo para el proveedor abre en Excel (BOM UTF-8)', csvR.status === 200 && bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), csvR.status);
      ck('trae un renglón por hilo elegido', lineas.length === ids.length + 1, lineas.length);
      ck('sin precios', !/precio|\$/i.test(csv) && lineas[0] === 'Hilo,Calibre,Material,Kilos a pedir,Paquetes aprox.,Pedir a más tardar', lineas[0]);
    }

    // ------------------------------------------------------------ por hilo
    console.log('\n— Por hilo');
    const top = res.ranking[0];
    const h1 = await api('GET', `/rotacion/hilo/${top.producto_id}`);
    ck('GET /rotacion/hilo/:id', h1.status === 200 && h1.data.hilo.producto_id === top.producto_id, h1.status);
    ck('lo vendido es lo mismo que en el Resumen', h1.data.hilo.vendido_12m === top.vendido_12m);
    const semanasP = h1.data.proyeccion.semanas;
    ck('la proyección nunca va en negativo', semanasP.every((s) => s.sin_pedido >= 0 && s.con_pedido >= 0));
    const p = h1.data.pedido_hoy;
    if (p && h1.data.proyeccion.llega_semana != null) {
      const k = h1.data.proyeccion.llega_semana;
      // Lo que no hay no se vende: el hueco antes de que llegue no se come el pedido.
      ck('el pedido llega completo', semanasP[k].con_pedido >= p.kg - 1, `semana ${k}: ${semanasP[k].con_pedido} con +${p.kg}`);
    }
    const sinId = await api('GET', '/rotacion/hilo');
    ck('sin id abre el que más se vende', sinId.status === 200 && sinId.data.hilo.producto_id === top.producto_id);
    const no = await api('GET', '/rotacion/hilo/999999999');
    ck('un hilo que no existe: 404', no.status === 404, no.status);

    // ------------------------------------------------------------ ajustes
    console.log('\n— Ajustes');
    const mal = await api('PUT', '/rotacion/ajustes', { semanas_proveedor: 0, semanas_colchon: 3, meses_cubre: 4, kg_contenedor: null });
    ck('proveedor en 0 semanas: 422', mal.status === 422, mal.status);
    const mal2 = await api('PUT', '/rotacion/ajustes', { semanas_proveedor: 10, semanas_colchon: 13, meses_cubre: 4, kg_contenedor: null });
    ck('colchón de 13 semanas: 422', mal2.status === 422, mal2.status);
    const bien = await api('PUT', '/rotacion/ajustes', { semanas_proveedor: 12, semanas_colchon: 2, meses_cubre: 5, kg_contenedor: 18000 });
    ck('se guardan y quedan confirmados', bien.status === 200 && bien.data.confirmados === true && bien.data.semanas_proveedor === 12 && bien.data.kg_contenedor === 18000, bien.status);
    const conf = await api('PUT', '/configuracion', { rotacion_semanas_proveedor: '4' });
    ck('desde Configuración no se cambian (sin sus reglas): 422', conf.status === 422 && conf.error?.code === 'CLAVE_DE_ROTACION', `${conf.status} ${conf.error?.code}`);
    const q2 = await api('GET', '/rotacion/que-pedir');
    const conFecha2 = q2.data.hilos.filter((h) => h.se_acaba && h.pedir);
    ck('«Qué pedir» ya usa los nuevos (14 semanas)', conFecha2.length > 0 && conFecha2.every((h) => sumarDias(h.se_acaba, -14 * 7) === h.pedir));

    // ------------------------------------------------------------ ventas anteriores
    console.log(`\n— Ventas de años anteriores (${ANIO})`);
    const [[prod]] = await db.query(
      `SELECT p.nombre, p.grosor_calibre AS calibre FROM productos p WHERE p.id = ?`, [top.producto_id]
    );
    const ENC = ['Hilo', 'Calibre', 'Año', 'Mes', 'Kilos', 'Tienda'];
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const kgMes = [300, 320, 410, 380, 350, 330, 300, 520, 610, 560, 340, 310];
    const buenas = kgMes.map((kg, i) => [prod.nombre.toLowerCase(), prod.calibre.replace('/', '-'), ANIO, i % 2 ? meses[i] : i + 1, kg, '']);
    const conErrores = xlsx([['Ventas de años anteriores'], ENC, ...buenas,
      ['TMPNOEXISTE', '2/30', ANIO, 3, 100, ''],
      [prod.nombre, prod.calibre, ANIO, 13, 100, ''],
      [prod.nombre, prod.calibre, ANIO, 'marzo', '', '']]);
    const pv = await subir('/rotacion/ventas-anteriores/previa', conErrores);
    ck('vista previa', pv.status === 200, pv.status);
    ck('dice los 3 renglones que no se entienden', pv.data?.errores === 3 && pv.data?.se_puede === false, pv.data?.errores);
    ck('y los 12 buenos (mayúsculas, "2-30" y meses por nombre)', pv.data?.validos === 12, pv.data?.validos);
    const noCarga = await subir('/rotacion/ventas-anteriores', conErrores);
    ck('con errores no carga nada: 422', noCarga.status === 422 && noCarga.error?.code === 'ARCHIVO_CON_ERRORES', `${noCarga.status} ${noCarga.error?.code}`);

    const archivo = xlsx([ENC, ...buenas]);
    const ok = await subir('/rotacion/ventas-anteriores', archivo);
    const sumaKg = kgMes.reduce((s, x) => s + x, 0);
    ck('se cargan los 12', ok.status === 200 && ok.data.cargados === 12 && Math.round(ok.data.kg) === sumaKg, `${ok.status} ${ok.data?.cargados}`);
    const re = await api('GET', '/rotacion/ventas-anteriores');
    ck('el resumen las cuenta', re.data.renglones === Number(yaHabia) + 12, re.data.renglones);

    const r2 = await api('GET', '/rotacion/resumen');
    ck('la historia ya empieza en ' + ANIO, r2.data.historia.hay_anteriores === true && r2.data.historia.desde.startsWith(`${ANIO}-01`), r2.data.historia.desde);
    ck('lo de hace 12 meses no cambia', r2.data.cifras.vendido_12m === res.cifras.vendido_12m);
    const tp = await api('GET', `/rotacion/temporadas?anio=${ANIO}`);
    const fila = tp.data?.hilos?.find((x) => x.producto_id === top.producto_id);
    ck(`Temporadas de ${ANIO} trae el hilo con sus kilos`, tp.status === 200 && fila && Math.round(fila.total) === sumaKg, fila?.total);
    ck('septiembre es su mejor mes', fila?.mejor_mes === 9, fila?.mejor_mes);

    const otra = xlsx([ENC, [prod.nombre, prod.calibre, ANIO, 1, 999, '']]);
    const ok2 = await subir('/rotacion/ventas-anteriores', otra);
    const [[ene]] = await db.query(
      'SELECT COUNT(*) AS n, MAX(kg) AS kg FROM ventas_anteriores WHERE producto_id = ? AND anio = ? AND mes = 1 AND almacen_id IS NULL',
      [top.producto_id, ANIO]
    );
    ck('cargar el mismo mes otra vez lo REEMPLAZA', ok2.status === 200 && Number(ene.n) === 1 && Number(ene.kg) === 999, `${ene.n} · ${ene.kg}`);

    // ------------------------------------------------------------ permisos
    console.log('\n— Permisos');
    const [[sin]] = await db.query(
      `SELECT u.id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.activo = 1 AND r.nombre <> 'administrador' AND r.entra_al_sistema = 1
          AND NOT EXISTS (SELECT 1 FROM usuario_roles ur WHERE ur.usuario_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM rol_permisos rp JOIN permisos pe ON pe.id = rp.permiso_id
                           WHERE rp.rol_id = u.rol_id AND pe.clave = 'ver:rotacion')
        LIMIT 1`
    );
    if (sin) {
      const tk = firmar(sin.id, sin.rol);
      const n1 = await api('GET', '/rotacion/resumen', undefined, tk);
      ck(`un ${sin.rol} sin el permiso no entra: 403`, n1.status === 403, n1.status);
      const n2 = await api('GET', '/rotacion/ventas-anteriores', undefined, tk);
      ck('ni a las ventas anteriores', n2.status === 403, n2.status);
    } else {
      console.log('  (se salta: no hay nadie sin el permiso)');
    }
    // Quien SÍ la ve (todas las tiendas) pero no tiene los dos permisos de escribir.
    const [[ve]] = await db.query(
      `SELECT u.id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.activo = 1 AND u.todas_las_tiendas = 1 AND r.nombre <> 'administrador'
          AND NOT EXISTS (SELECT 1 FROM usuario_roles ur WHERE ur.usuario_id = u.id)
          AND EXISTS (SELECT 1 FROM rol_permisos rp JOIN permisos pe ON pe.id = rp.permiso_id
                       WHERE rp.rol_id = u.rol_id AND pe.clave = 'ver:rotacion')
          AND NOT EXISTS (SELECT 1 FROM rol_permisos rp JOIN permisos pe ON pe.id = rp.permiso_id
                           WHERE rp.rol_id = u.rol_id AND pe.clave IN ('hacer:ajustes_rotacion', 'hacer:cargar_ventas_anteriores'))
        LIMIT 1`
    );
    if (ve) {
      const tk = firmar(ve.id, ve.rol);
      const v1 = await api('GET', '/rotacion/que-pedir', undefined, tk);
      ck(`un ${ve.rol} con la pantalla la ve`, v1.status === 200, v1.status);
      const v2 = await api('PUT', '/rotacion/ajustes', { semanas_proveedor: 4, semanas_colchon: 1, meses_cubre: 2, kg_contenedor: null }, tk);
      ck('…pero sin «Tiempos para pedir» no los cambia: 403', v2.status === 403 && v2.error?.code === 'SIN_PERMISO', `${v2.status} ${v2.error?.code}`);
      const v3 = await fetch(`${BASE}/rotacion/ventas-anteriores/previa`, {
        method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/octet-stream' }, body: Buffer.from('x'),
      });
      ck('…ni sube ventas anteriores: 403', v3.status === 403, v3.status);
    } else {
      console.log('  (se salta: nadie más que el administrador ve la pantalla)');
    }
    const anon = await fetch(`${BASE}/rotacion/resumen`);
    ck('sin sesión: 401', anon.status === 401, anon.status);

    if (Number(yaHabia) === 0) {
      const b = await api('DELETE', '/rotacion/ventas-anteriores');
      const [[{ quedan }]] = await db.query('SELECT COUNT(*) AS quedan FROM ventas_anteriores');
      ck('«Borrar lo cargado» las quita todas', b.status === 200 && Number(quedan) === 0, `${b.status} quedan ${quedan}`);
    } else {
      console.log('  (no se prueba «Borrar lo cargado»: ya había ventas anteriores de alguien más)');
    }
  } catch (e) {
    ck('sin errores inesperados', false, e.stack);
  } finally {
    // Lo suyo, y los ajustes como estaban.
    await db.query('DELETE FROM ventas_anteriores WHERE id > ? AND anio = ?', [maxId, ANIO]);
    for (const a of ajustesAntes) await db.query('UPDATE configuracion SET valor = ? WHERE clave = ?', [a.valor, a.clave]);
    const [[{ quedan }]] = await db.query('SELECT COUNT(*) AS quedan FROM ventas_anteriores WHERE id > ?', [maxId]);
    ck('quedó limpio', Number(quedan) === 0, quedan);
    await db.end();
    console.log(`\n${total - fallas} de ${total} comprobaciones bien${fallas ? `, ${fallas} FALLAS` : ''}.`);
    process.exit(fallas ? 1 : 0);
  }
})();
