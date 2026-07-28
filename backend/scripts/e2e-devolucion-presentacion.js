'use strict';

/**
 * Prueba del cambio de presentación al devolver: se entrega el PAQUETE y el
 * cliente devuelve los CONOS (ya lo desarmó). La mercancía vuelve, pero no en la
 * forma en que salió, así que hay que reponer piezas en vez de kilos.
 *
 *   cd backend
 *   PORT=3221 node src/server.js &
 *   node scripts/e2e-devolucion-presentacion.js
 *
 * Crea todo con prefijo TMPD y lo borra al terminar. Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3221/api/v1';
const t = jwt.sign({ sub: 1, tipo: 'usuario', rol_id: 1, rol: 'administrador' }, process.env.JWT_SECRET, { expiresIn: '1h' });

const api = async (me, r, b) => {
  const x = await fetch(B + r, { method: me, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: x.status, ...(await x.json().catch(() => ({}))) };
};
let f = 0;
const ck = (n, ok, d) => { console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + d : '')); if (!ok) f++; };

(async () => {
  const db = await m.createConnection({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const foto = {};
  for (const x of ['productos', 'almacenes', 'pedidos', 'sesiones_caja', 'cajas']) foto[x] = new Set((await db.query('SELECT id FROM ' + x))[0].map((r) => r.id));
  const st = async (v, a) => Number(((await db.query('SELECT cantidad c FROM inventario WHERE variante_id=? AND almacen_id=?', [v, a]))[0][0] || { c: 0 }).c);
  const motivoUltimo = async (ped) => (await db.query("SELECT motivo FROM movimientos_inventario WHERE referencia_tipo='pedido' AND referencia_id=? AND tipo='entrada' ORDER BY id DESC LIMIT 1", [ped]))[0][0]?.motivo;

  try {
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const p = (await api('POST', '/productos', { categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPD Marino', multipresentacion: true })).data.id;
    const paq = (await api('POST', '/variantes', { producto_id: p, sku: 'TMPD-PAQ', presentacion: 'Paquete 19kg', tipo_presentacion: 'paquete', peso_kg: 19, precio: 200 })).data.id;
    const cono = (await api('POST', '/variantes', { producto_id: p, sku: 'TMPD-CONO', presentacion: 'Cono', tipo_presentacion: 'cono', origen_variante_id: paq, piezas_por_origen: 12, modo_precio: 'calculado' })).data.id;
    const alm = (await api('POST', '/almacenes', { nombre: 'TMPD Tienda', es_punto_venta: true })).data.id;
    const caja = (await api('POST', '/caja/cajas', { almacen_id: alm, nombre: 'TMPD Caja' })).data.id;
    await api('POST', '/inventario/movimientos', { variante_id: paq, almacen_id: alm, tipo: 'entrada', cantidad: 190, motivo: 'TMPD inicial' });
    const [met] = await db.query('SELECT id,nombre FROM metodos_pago');
    const efe = met.find((x) => /efectivo/i.test(x.nombre));
    const s = (await api('POST', '/caja/sesiones', { caja_id: caja, monto_inicial: 0 })).data;

    // Paga con holgura: el POS calcula el cambio. Los conos de precio calculado
    // dan importes con centavos (316.67 × 12 = 3,800.04).
    const vender = (variante, cantidad) => api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: s.id,
      items: [{ variante_id: variante, cantidad }],
      pagos: [{ metodo_pago_id: efe.id, monto: 10000 }],
    });

    console.log('=== 1. Vendo UN PAQUETE de 19 kg ===');
    let r = await vender(paq, 19);
    const ped = r.data.id;
    ck('el paquete salió', (await st(paq, alm)) === 171, (await st(paq, alm)) + ' kg');

    console.log('\n=== 2. El pedido dice en qué puede regresar ===');
    const linea = (await api('GET', '/pedidos/' + ped)).data.detalle[0];
    const alt = linea.alternativas_devolucion;
    ck('ofrece el cono', alt?.[0]?.variante_id === cono, alt?.[0]?.sku);
    // Paquete y cono se llevan los DOS en kilos: es el mismo hilo, solo enconado.
    ck('la equivalencia es 1:1 en kilos', alt[0].cantidad_equivalente === 19 && alt[0].unidad === 'kg',
      alt[0].cantidad_equivalente + ' ' + alt[0].unidad);

    console.log('\n=== 3. DEVUELVE CONEADO: entran conos, no el paquete ===');
    r = await api('PATCH', '/pedidos/' + ped + '/estado', { estado: 'devuelto', devoluciones: [{ detalle_id: linea.id, variante_id: cono, cantidad: 19 }] });
    ck('la devolución pasa', r.status === 200, r.data?.estado);
    ck('el PAQUETE no volvió', (await st(paq, alm)) === 171, (await st(paq, alm)) + ' kg');
    ck('entraron 19 kg como CONO', (await st(cono, alm)) === 19, (await st(cono, alm)) + ' kg');
    ck('el kardex explica el cambio', /regresó como TMPD-CONO/.test(await motivoUltimo(ped)), await motivoUltimo(ped));

    console.log('\n=== 4. No se reactiva: el paquete ya no existe ===');
    r = await api('PATCH', '/pedidos/' + ped + '/estado', { estado: 'pagado' });
    ck('409 DEVUELTO_EN_OTRA_PRESENTACION', r.status === 409 && r.error?.code === 'DEVUELTO_EN_OTRA_PRESENTACION', r.status + ' ' + r.error?.code);

    console.log('\n=== 5. Devolver MENOS kilos de los que salieron ===');
    r = await vender(paq, 19);
    const ped2 = r.data.id;
    const l2 = (await api('GET', '/pedidos/' + ped2)).data.detalle[0];
    r = await api('PATCH', '/pedidos/' + ped2 + '/estado', { estado: 'devuelto', devoluciones: [{ detalle_id: l2.id, variante_id: cono, cantidad: 15 }] });
    ck('acepta 15 kg de los 19', r.status === 200);
    ck('entraron solo 15 más', (await st(cono, alm)) === 34, (await st(cono, alm)) + ' kg');
    ck('el kardex asienta el equivalente', /equivalente 19/.test(await motivoUltimo(ped2)), await motivoUltimo(ped2));

    console.log('\n=== 6. Presentación incompatible se rechaza ===');
    r = await vender(paq, 19);
    const ped3 = r.data.id;
    const l3 = (await api('GET', '/pedidos/' + ped3)).data.detalle[0];
    const otroP = (await api('POST', '/productos', { categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPD Otro' })).data.id;
    const otraV = (await api('POST', '/variantes', { producto_id: otroP, sku: 'TMPD-OTRA', presentacion: 'Bolsa', tipo_presentacion: 'simple', precio: 50 })).data.id;
    const paqAntes6 = await st(paq, alm);
    r = await api('PATCH', '/pedidos/' + ped3 + '/estado', { estado: 'devuelto', devoluciones: [{ detalle_id: l3.id, variante_id: otraV, cantidad: 1 }] });
    ck('422 PRESENTACION_INCOMPATIBLE', r.status === 422 && r.error?.code === 'PRESENTACION_INCOMPATIBLE', r.status + ' ' + r.error?.code);
    console.log('        →', r.error?.message);
    ck('no movió el paquete', (await st(paq, alm)) === paqAntes6);
    ck('ni el pedido cambió de estado', (await db.query('SELECT estado e FROM pedidos WHERE id=?', [ped3]))[0][0].e !== 'devuelto');

    console.log('\n=== 7. Sin indicar nada, regresa como se vendió ===');
    await api('PATCH', '/pedidos/' + ped3 + '/estado', { estado: 'cancelado' });
    ck('el paquete vuelve entero', (await st(paq, alm)) === paqAntes6 + 19, (await st(paq, alm)) + ' kg');

    console.log('\n=== 8. Al revés: vendo cono y devuelven el PAQUETE ===');
    await api('POST', '/inventario/movimientos', { variante_id: cono, almacen_id: alm, tipo: 'entrada', cantidad: 24, motivo: 'TMPD conos' });
    r = await vender(cono, 19);
    const ped4 = r.data.id;
    const l4 = (await api('GET', '/pedidos/' + ped4)).data.detalle[0];
    ck('ofrece el paquete', l4.alternativas_devolucion?.[0]?.variante_id === paq,
      l4.alternativas_devolucion?.[0]?.sku + ' · ' + l4.alternativas_devolucion?.[0]?.cantidad_equivalente + ' kg');
    const paqAntes8 = await st(paq, alm);
    await api('PATCH', '/pedidos/' + ped4 + '/estado', { estado: 'devuelto', devoluciones: [{ detalle_id: l4.id, variante_id: paq, cantidad: 19 }] });
    ck('19 kg de cono regresan como 19 kg de paquete', (await st(paq, alm)) === paqAntes8 + 19, (await st(paq, alm)) + ' kg');
  } finally {
    console.log('\n=== Limpieza ===');
    await db.query('SET FOREIGN_KEY_CHECKS=0');
    const nuevos = async (x) => (await db.query('SELECT id FROM ' + x))[0].map((r) => r.id).filter((i) => !foto[x].has(i));
    for (const id of await nuevos('pedidos')) {
      await db.query('DELETE FROM pedido_detalle_bultos WHERE detalle_id IN (SELECT id FROM pedido_detalle WHERE pedido_id=?)', [id]);
      await db.query('DELETE FROM pedido_detalle WHERE pedido_id=?', [id]);
      await db.query('DELETE FROM pagos WHERE pedido_id=?', [id]);
      await db.query('DELETE FROM pedidos WHERE id=?', [id]);
    }
    for (const id of await nuevos('sesiones_caja')) { await db.query('DELETE FROM movimientos_caja WHERE sesion_caja_id=?', [id]); await db.query('DELETE FROM sesiones_caja WHERE id=?', [id]); }
    for (const id of await nuevos('cajas')) await db.query('DELETE FROM cajas WHERE id=?', [id]);
    for (const id of await nuevos('productos')) {
      const sub = '(SELECT id FROM producto_variantes WHERE producto_id=?)';
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario']) await db.query('DELETE FROM ' + tb + ' WHERE variante_id IN ' + sub, [id]);
      await db.query('UPDATE producto_variantes SET origen_variante_id=NULL WHERE producto_id=?', [id]);
      await db.query('DELETE FROM producto_variantes WHERE producto_id=?', [id]);
      await db.query('DELETE FROM productos WHERE id=?', [id]);
    }
    for (const id of await nuevos('almacenes')) await db.query('DELETE FROM almacenes WHERE id=?', [id]);
    await db.query('SET FOREIGN_KEY_CHECKS=1');
    ck('la base quedó como antes', (await db.query('SELECT COUNT(*) n FROM pedidos'))[0][0].n === foto.pedidos.size);
    await db.end();
  }
  console.log('\n' + (f === 0 ? 'OK · todo pasó' : 'FALLAS: ' + f));
  process.exit(f ? 1 : 0);
})();
