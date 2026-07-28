'use strict';

/**
 * Prueba del traspaso por PAQUETES con pesos reales.
 *
 * El problema que resuelve: quien surte pide "5 paquetes de blanco", no kilos,
 * porque los paquetes son cerrados y cada uno pesa distinto. Antes se descontaba
 * paquetes × peso NOMINAL y eso nunca cuadraba. Ahora se toman los bultos que de
 * verdad hay en el origen (los más antiguos, FIFO) y se descuenta su peso real.
 *
 *   cd backend
 *   PORT=3234 node src/server.js &
 *   node scripts/e2e-traspaso-paquetes.js
 *
 * Crea todo con prefijo PP y lo borra al terminar. Sale 1 si algo falla.
 */

const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const ARCHIVO = path.join(__dirname, '..', '..', 'muestras', 'BLANCO 2-30.xlsx');
const B = process.env.BASE ?? 'http://localhost:3234/api/v1';
const t = jwt.sign({ sub: 1, tipo: 'usuario', rol_id: 1, rol: 'administrador' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const SUF = '-P' + Date.now().toString(36);

const api = async (me, r, b) => {
  const x = await fetch(B + r, { method: me, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: x.status, ...(await x.json().catch(() => ({}))) };
};
let f = 0;
const ck = (n, ok, d) => { console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + d : '')); if (!ok) f++; };
const r3 = (n) => Math.round(n * 1000) / 1000;

(async () => {
  const db = await m.createConnection({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const antes = new Set((await db.query('SELECT id FROM productos'))[0].map((r) => r.id));
  const st = async (v, a) => Number(((await db.query('SELECT cantidad c FROM inventario WHERE variante_id=? AND almacen_id=?', [v, a]))[0][0] || { c: 0 }).c);
  const cuenta = async (v, a) => (await db.query('SELECT COUNT(*) n FROM variante_codigos WHERE variante_id=? AND almacen_id=?', [v, a]))[0][0].n;

  try {
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const bod = (await api('POST', '/almacenes', { nombre: 'PP Bodega' })).data.id;
    const tda = (await api('POST', '/almacenes', { nombre: 'PP Tienda', es_punto_venta: true })).data.id;
    const p = (await api('POST', '/productos', { categoria_id: cat, unidad_medida_id: kgu, nombre: 'PP BLANCO', precio_kg: 180, multipresentacion: true, por_lotes: true })).data.id;
    const previa = await (await fetch(B + '/remesas/previa', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(ARCHIVO) })).json();
    const bultos = previa.data.bultos.map((b) => ({ ...b, codigo: b.codigo + SUF }));
    await api('POST', '/remesas', { producto_id: p, almacen_id: bod, bultos });
    const pv = (await api('GET', '/productos/' + p)).data.variantes[0];

    console.log('=== 1. "Quiero 100 kg": ¿cuántos paquetes son? ===');
    let r = await api('GET', `/inventario/equivalencia-paquetes?variante_id=${pv.id}&almacen_id=${bod}&kg=100`);
    ck('cuenta los paquetes del origen', r.data.disponible.paquetes === 80, `${r.data.disponible.paquetes} paquetes · ${r.data.disponible.kg_en_bultos} kg`);
    ck('usa el peso REAL, no el nominal', !r.data.referencia_nominal, `promedio ${r.data.peso_referencia} kg`);
    ck('da las dos opciones (por debajo y por arriba)', r.data.sugerencia.opciones.length === 2,
      r.data.sugerencia.opciones.map((o) => `${o.paquetes}→${o.kg_aprox}kg (${o.diferencia > 0 ? '+' : ''}${o.diferencia})`).join(' · '));

    console.log('\n=== 2. Mando 5 paquetes: se descuenta su peso REAL ===');
    const cinco = bultos.slice(0, 5);
    const real = r3(cinco.reduce((s, b) => s + b.peso_kg, 0));
    const nominal = r3(5 * Number(pv.peso_kg));
    const kgAntes = await st(pv.id, bod);
    r = await api('POST', '/inventario/traspasos', { almacen_origen_id: bod, almacen_destino_id: tda, items: [{ variante_id: pv.id, paquetes: 5 }] });
    const l = r.data.lineas[0];
    ck('el traspaso pasa', r.status === 201, r.data.folio);
    ck('descuenta el peso REAL', Number(l.cantidad) === real, `${l.cantidad} kg`);
    ck('y NO el nominal', Number(l.cantidad) !== nominal, `el nominal habría sido ${nominal} kg`);
    ck('dice qué bultos salieron', l.bultos?.length === 5, l.bultos.map((b) => b.peso_kg).join(' + '));
    ck('marca que el peso no es estimado', l.peso_estimado === false);
    ck('la bodega baja exactamente eso', Math.abs(kgAntes - (await st(pv.id, bod)) - real) < 0.001, `${kgAntes} → ${await st(pv.id, bod)}`);
    ck('la tienda recibe exactamente eso', Math.abs((await st(pv.id, tda)) - real) < 0.001, (await st(pv.id, tda)) + ' kg');

    console.log('\n=== 3. Los bultos viajaron con la mercancía ===');
    ck('5 bultos en la tienda', (await cuenta(pv.id, tda)) === 5);
    ck('75 siguen en la bodega', (await cuenta(pv.id, bod)) === 75);
    const [cuales] = await db.query('SELECT codigo FROM variante_codigos WHERE almacen_id=? ORDER BY id', [tda]);
    ck('son los más antiguos (FIFO)', cuales.map((c) => c.codigo).join() === cinco.map((b) => b.codigo).join());

    console.log('\n=== 4. La cuenta cuadra en los dos almacenes ===');
    for (const [alm, nombre] of [[tda, 'tienda'], [bod, 'bodega']]) {
      const [[sum]] = await db.query('SELECT COALESCE(SUM(peso_kg),0) kg FROM variante_codigos WHERE variante_id=? AND almacen_id=?', [pv.id, alm]);
      ck(`suma de bultos = saldo de la ${nombre}`, Math.abs(Number(sum.kg) - (await st(pv.id, alm))) < 0.001,
        `${Number(sum.kg)} = ${await st(pv.id, alm)}`);
    }

    console.log('\n=== 5. Desde la tienda ya se puede bajar a mostrador ===');
    r = await api('GET', '/inventario/desarmes/previa/' + cinco[0].codigo);
    ck('el bulto se ubica donde llegó', r.status === 200,
      r.data.existencias.map((e) => `${e.almacen} (${e.cantidad} kg)`).join(' · '));

    console.log('\n=== 6. Pedir más de lo que hay ===');
    r = await api('POST', '/inventario/traspasos', { almacen_origen_id: bod, almacen_destino_id: tda, items: [{ variante_id: pv.id, paquetes: 500 }] });
    ck('409 STOCK_INSUFICIENTE', r.status === 409, `${r.status} ${r.error?.code}`);
    ck('y no movió nada', (await cuenta(pv.id, tda)) === 5);
  } finally {
    console.log('\n=== Limpieza ===');
    await db.query('SET FOREIGN_KEY_CHECKS=0');
    for (const id of (await db.query('SELECT id FROM productos'))[0].map((r) => r.id).filter((i) => !antes.has(i))) {
      const sub = '(SELECT id FROM producto_variantes WHERE producto_id=?)';
      await db.query('DELETE FROM traspaso_detalle WHERE variante_id IN ' + sub, [id]);
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) await db.query('DELETE FROM ' + tb + ' WHERE variante_id IN ' + sub, [id]);
      await db.query('DELETE FROM remesas WHERE variante_id IN ' + sub, [id]);
      await db.query('UPDATE producto_variantes SET origen_variante_id=NULL WHERE producto_id=?', [id]);
      await db.query('DELETE FROM producto_variantes WHERE producto_id=?', [id]);
      await db.query('DELETE FROM productos WHERE id=?', [id]);
    }
    await db.query("DELETE FROM traspasos WHERE almacen_origen_id IN (SELECT id FROM almacenes WHERE nombre LIKE 'PP %')");
    await db.query("DELETE FROM almacenes WHERE nombre LIKE 'PP %'");
    await db.query('SET FOREIGN_KEY_CHECKS=1');
    ck('los datos de la tienda intactos', (await db.query('SELECT COUNT(*) n FROM productos'))[0][0].n === antes.size, antes.size + ' productos');
    await db.end();
  }
  console.log('\n' + (f === 0 ? 'OK · todo pasó' : 'FALLAS: ' + f));
  process.exit(f ? 1 : 0);
})();
