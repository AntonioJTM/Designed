'use strict';

/**
 * Prueba de SURTIR INVENTARIO (antes "Recibir remesa"), lo del 2026-10-06:
 *   · la carga guarda proveedor (de una lista), factura, pedimento, contenedor y
 *     fecha de ingreso, y se pueden completar o corregir después;
 *   · el costo por kilo solo lo capturan y lo ven administración y contabilidad;
 *   · poner o corregir el costo después rehace el costo promedio del hilo igual
 *     que si se hubiera capturado a tiempo;
 *   · las cargas de una lista con varios colores se corrigen de una vez.
 *
 *   cd backend && PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si BASE=http://localhost:3210/api/v1 node scripts/e2e-surtir-inventario.js
 *
 * Crea todo con prefijo TMPSI y lo borra al terminar. Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';
// El servidor decide qué puede alguien por QUIÉN es (sus puestos en la base,
// 2026-10-06), no por el puesto que diga el token: cada token es de una persona
// real de ese puesto.
const firmar = (id, rolId, rol) => jwt.sign({ sub: id, tipo: 'usuario', rol_id: rolId, rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
const SUF = '-S' + Date.now().toString(36);

const llamar = (token) => async (me, r, b) => {
  const x = await fetch(B + r, { method: me, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: x.status, ...(await x.json().catch(() => ({}))) };
};
let api;

let f = 0;
const ck = (n, ok, d) => { console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + d : '')); if (!ok) f++; };
const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;
const hoy = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const dias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

(async () => {
  const db = await m.createConnection({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const antes = {};
  for (const t of ['productos', 'almacenes', 'remesas', 'proveedores']) antes[t] = new Set((await db.query(`SELECT id FROM ${t}`))[0].map((r) => r.id));
  const costoDe = async (v) => Number((await db.query('SELECT costo FROM producto_variantes WHERE id=?', [v]))[0][0].costo);

  const [[admin]] = await db.query(
    `SELECT u.id, u.rol_id FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = 'administrador' AND u.activo = 1 ORDER BY u.id LIMIT 1`
  );
  api = llamar(firmar(admin.id, admin.rol_id, 'administrador'));
  // Un puesto sin costo pero que sí surte (el almacenista) y Contabilidad: un
  // empleado TMPSI de cada uno, que se borra al final.
  const [[alm]] = await db.query("SELECT id FROM roles WHERE nombre='almacenista'");
  const [[conta]] = await db.query("SELECT id FROM roles WHERE nombre='contabilidad'");
  const empleado = async (rolId, quien) => (await db.query(
    `INSERT INTO usuarios (rol_id, nombre, correo, contrasena_hash) VALUES (?, ?, ?, 'no-entra')`,
    [rolId, `TMPSI ${quien}`, `tmpsi.${quien}${SUF}@prueba.local`.toLowerCase()]
  ))[0].insertId;
  const comoAlmacen = llamar(firmar(await empleado(alm.id, 'almacen'), alm.id, 'almacenista'));
  const comoConta = llamar(firmar(await empleado(conta.id, 'conta'), conta.id, 'contabilidad'));

  try {
    console.log('=== 1. Proveedores: se eligen de una lista y no se repiten ===');
    let r = await api('POST', '/proveedores', { nombre: 'TMPSI  Canan   Tekstil' });
    ck('se da de alta con solo el nombre', r.status === 201 && r.data.nombre === 'TMPSI Canan Tekstil', `${r.status} «${r.data?.nombre}»`);
    const prov = r.data.id;
    r = await api('POST', '/proveedores', { nombre: 'tmpsi canan tekstil' });
    ck('escrito distinto es el mismo: 409 PROVEEDOR_REPETIDO', r.status === 409 && r.error?.code === 'PROVEEDOR_REPETIDO', `${r.status} ${r.error?.message}`);
    r = await api('GET', '/proveedores');
    ck('aparece en la lista', r.data.some((p) => p.id === prov));

    console.log('\n=== 2. Una carga con sus datos ===');
    const cat = (await api('GET', '/categorias')).data.items.find((c) => c.calibres) ?? (await api('GET', '/categorias')).data.items[0];
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const bod = (await api('POST', '/almacenes', { nombre: 'TMPSI Bodega' })).data.id;
    const p = (await api('POST', '/productos', { categoria_id: cat.id, unidad_medida_id: kgu, nombre: 'TMPSI MARINO', precio_kg: 180, multipresentacion: true })).data.id;
    // Los bultos se arman aquí (no dependen de un archivo de muestras): 26
    // paquetes de 18 a 20 kg, como llegan.
    const todos = Array.from({ length: 26 }, (_, i) => ({
      codigo: `TMPSI${SUF}-${String(i + 1).padStart(2, '0')}`,
      peso_kg: r3(18 + ((i * 37) % 200) / 100),
      lote: i < 13 ? 'TMPSI-L1' : 'TMPSI-L2',
      conos: 12,
    }));
    const tandaA = todos.slice(0, 10);
    const tandaB = todos.slice(10, 20);
    const kgA = r3(tandaA.reduce((s, b) => s + b.peso_kg, 0));
    const kgB = r3(tandaB.reduce((s, b) => s + b.peso_kg, 0));
    const datos = { proveedor_id: prov, factura: 'F-TMPSI-1', pedimento: '26 07 3456 6001234', contenedor: 'MSCU1234567', fecha_ingreso: dias(-1) };

    const nRemesas = async () => (await db.query('SELECT COUNT(*) n FROM remesas'))[0][0].n;
    const n0 = await nRemesas();
    r = await comoAlmacen('POST', '/remesas', { producto_id: p, almacen_id: bod, bultos: tandaA, ...datos, costo_kg: 100 });
    ck('quien no ve costos no puede mandar el costo: 403', r.status === 403 && r.error?.code === 'SIN_PERMISO', `${r.status} ${r.error?.message}`);
    ck('y no se cargó nada', (await nRemesas()) === n0);
    r = await api('POST', '/remesas', { producto_id: p, almacen_id: bod, bultos: tandaA, ...datos, fecha_ingreso: dias(1) });
    ck('una fecha de ingreso futura: 422 FECHA_FUTURA', r.status === 422 && r.error?.code === 'FECHA_FUTURA', `${r.status} ${r.error?.code}`);

    r = await api('POST', '/remesas', { producto_id: p, almacen_id: bod, bultos: tandaA, ...datos, costo_kg: 100 });
    ck('administración carga con sus datos y su costo', r.status === 201, `${r.status} ${r.data?.folio ?? r.error?.message}`);
    const cargaA = r.data.id;
    const variante = (await api('GET', '/productos/' + p)).data.variantes[0].id;
    let fila = (await api('GET', `/remesas?producto_id=${p}`)).data.items.find((x) => x.id === cargaA);
    ck('el historial trae proveedor, factura, pedimento, contenedor y fecha',
      fila.proveedor === 'TMPSI Canan Tekstil' && fila.factura === 'F-TMPSI-1' && fila.pedimento === datos.pedimento
        && fila.contenedor === 'MSCU1234567' && fila.fecha_ingreso === dias(-1),
      `${fila.proveedor} · ${fila.factura} · ${fila.pedimento} · ${fila.contenedor} · ${fila.fecha_ingreso}`);
    ck('el costo, para administración', Number(fila.costo_kg) === 100, fila.costo_kg);
    fila = (await comoAlmacen('GET', `/remesas?producto_id=${p}`)).data.items.find((x) => x.id === cargaA);
    ck('al almacenista no le llega el costo', fila && !('costo_kg' in fila), JSON.stringify(Object.keys(fila ?? {}).filter((k) => /costo/.test(k))));
    fila = (await comoConta('GET', `/remesas?producto_id=${p}`)).data.items.find((x) => x.id === cargaA);
    ck('a contabilidad sí', Number(fila?.costo_kg) === 100, fila?.costo_kg);
    ck('el costo del hilo es el de su primera compra', (await costoDe(variante)) === 100, await costoDe(variante));

    console.log('\n=== 3. El costo se pone o se corrige después ===');
    // Se va una merma de 5 kg y llega otra carga SIN costo (contabilidad lo pone luego).
    await api('POST', '/inventario/movimientos', { variante_id: variante, almacen_id: bod, tipo: 'merma', cantidad: 5, motivo: 'TMPSI merma' });
    r = await api('POST', '/remesas', { variante_id: variante, almacen_id: bod, bultos: tandaB, proveedor_id: prov, factura: 'F-TMPSI-2' });
    const cargaB = r.data.id;
    ck('una carga sin costo no mueve el del hilo', (await costoDe(variante)) === 100, await costoDe(variante));
    {
      const fb = (await api('GET', `/remesas?producto_id=${p}`)).data.items.find((x) => x.id === cargaB);
      ck('sin fecha de ingreso, es la de hoy', fb.fecha_ingreso === hoy(), fb.fecha_ingreso);
    }
    r = await comoAlmacen('PATCH', `/remesas/${cargaB}`, { costo_kg: 130 });
    ck('el almacenista no pone el costo: 403', r.status === 403, `${r.status} ${r.error?.code}`);
    r = await comoAlmacen('PATCH', `/remesas/${cargaB}`, { pedimento: '26 07 3456 6009999' });
    ck('pero sí completa los papeles', r.status === 200 && r.data.pedimento === '26 07 3456 6009999' && !('costo_kg' in r.data),
      `${r.status} ${r.data?.pedimento}`);
    r = await comoConta('PATCH', `/remesas/${cargaB}`, { costo_kg: 130 });
    // Promedio ponderado móvil con lo que había ANTES de la carga B: kgA − 5 a $100.
    const esperado = r2(((kgA - 5) * 100 + kgB * 130) / (kgA - 5 + kgB));
    ck('contabilidad pone el costo y el promedio queda como si se hubiera capturado a tiempo',
      r.status === 200 && (await costoDe(variante)) === esperado, `${await costoDe(variante)} = ${esperado}`);
    r = await api('PATCH', `/remesas/${cargaA}`, { costo_kg: 90 });
    const esperado2 = r2(((kgA - 5) * 90 + kgB * 130) / (kgA - 5 + kgB));
    ck('corregir el costo de la primera rehace el promedio en orden', (await costoDe(variante)) === esperado2, `${await costoDe(variante)} = ${esperado2}`);
    r = await api('PATCH', `/remesas/${cargaA}`, { fecha_ingreso: null });
    ck('borrar la fecha la regresa al día de la captura', r.data?.fecha_ingreso === hoy(), r.data?.fecha_ingreso);

    console.log('\n=== 4. Una lista con varios colores: sus datos se corrigen de una vez ===');
    const calibre = String(cat.calibres ?? '').split(',').map((x) => x.trim()).filter(Boolean)[0];
    if (!calibre) {
      ck('hay un material con calibres para probar la lista', false, cat.nombre);
    } else {
      const otros = todos.slice(20, 26).map((b) => ({ ...b, codigo: b.codigo + 'L' }));
      r = await api('POST', '/remesas/lista', {
        almacen_id: bod, categoria_id: cat.id, ...datos, factura: 'F-TMPSI-3',
        hilos: [
          { nombre: 'TMPSI ROJO', calibre, bultos: otros.slice(0, 3) },
          { nombre: 'TMPSI VERDE', calibre, bultos: otros.slice(3, 6) },
        ],
      });
      ck('la lista entra con sus datos', r.status === 201 && r.data.cargas.length === 2, `${r.status} ${r.error?.message ?? ''}`);
      const [c1, c2] = r.data.cargas.map((c) => c.id);
      const de = async (id) => (await db.query("SELECT factura, lista, DATE_FORMAT(fecha_ingreso,'%Y-%m-%d') f, costo_kg FROM remesas WHERE id=?", [id]))[0][0];
      ck('las dos cargas comparten la marca de su lista y su factura', (await de(c1)).lista && (await de(c1)).lista === (await de(c2)).lista && (await de(c2)).factura === 'F-TMPSI-3');
      r = await api('PATCH', `/remesas/${c1}`, { factura: 'F-TMPSI-9', toda_la_lista: true, costo_kg: 77 });
      ck('corregir la factura de una con "toda la lista" corrige las dos', (await de(c1)).factura === 'F-TMPSI-9' && (await de(c2)).factura === 'F-TMPSI-9');
      ck('pero el costo es de cada hilo: solo cambia el de la suya', Number((await de(c1)).costo_kg) === 77 && (await de(c2)).costo_kg == null);
      r = await api('GET', `/remesas/${c1}/pdf`);
      ck('el PDF de la carga sale', r.status === 200);
    }
  } catch (e) {
    f++;
    console.error('  ✗ la prueba se detuvo con un error →', e.message);
  } finally {
    console.log('\n=== Limpieza ===');
    await db.query('SET FOREIGN_KEY_CHECKS=0');
    const nuevos = async (t) => (await db.query(`SELECT id FROM ${t}`))[0].map((r) => r.id).filter((id) => !antes[t].has(id));
    const prods = [];
    for (const id of await nuevos('productos')) {
      const [[pr]] = await db.query('SELECT nombre FROM productos WHERE id=?', [id]);
      if (String(pr?.nombre).startsWith('TMPSI')) prods.push(id);
    }
    for (const id of prods) {
      const sub = '(SELECT id FROM producto_variantes WHERE producto_id=?)';
      for (const t of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios', 'remesas']) {
        await db.query(`DELETE FROM ${t} WHERE variante_id IN ${sub}`, [id]);
      }
      await db.query('DELETE FROM producto_variantes WHERE producto_id=?', [id]);
      await db.query('DELETE FROM productos WHERE id=?', [id]);
    }
    await db.query("DELETE FROM almacenes WHERE nombre LIKE 'TMPSI %'");
    await db.query("DELETE FROM proveedores WHERE nombre LIKE 'TMPSI %'");
    await db.query("DELETE FROM usuarios WHERE nombre LIKE 'TMPSI %' AND correo LIKE 'tmpsi.%@prueba.local'");
    await db.query('SET FOREIGN_KEY_CHECKS=1');
    const [[resto]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPSI%')
            + (SELECT COUNT(*) FROM proveedores WHERE nombre LIKE 'TMPSI%')
            + (SELECT COUNT(*) FROM almacenes WHERE nombre LIKE 'TMPSI%')
            + (SELECT COUNT(*) FROM usuarios WHERE nombre LIKE 'TMPSI%') AS n`
    );
    ck('no quedó basura (TMPSI)', Number(resto.n) === 0, resto.n);
    await db.end();
  }
  console.log('\n' + (f === 0 ? 'TODO OK' : f + ' FALLO(S)'));
  process.exit(f ? 1 : 0);
})();
