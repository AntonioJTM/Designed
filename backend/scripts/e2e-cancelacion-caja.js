'use strict';

/**
 * Prueba del dinero al cancelar una venta de mostrador: el efectivo SALE de la
 * caja con un movimiento 'devolucion', para que el corte no siga contándolo.
 *
 *   cd backend
 *   PORT=3220 node src/server.js &
 *   node scripts/e2e-cancelacion-caja.js   # BASE=http://localhost:3220/api/v1
 *
 * Cubre lo delicado: que el turno YA CERRADO no se toque (su corte está
 * cuadrado), que la tarjeta no mueva el cajón, y que si no hay turno abierto la
 * cancelación se rechace COMPLETA en vez de perder el registro del dinero.
 *
 * Crea todo con prefijo TMPK y lo borra al terminar. Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3220/api/v1';
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

  // Neto de efectivo del turno, con el mismo signo que usa el corte.
  const neto = async (sid) => {
    const [r] = await db.query('SELECT tipo,monto FROM movimientos_caja WHERE sesion_caja_id=?', [sid]);
    const S = { venta: 1, ingreso: 1, retiro: -1, devolucion: -1 };
    return Math.round(r.reduce((a, x) => a + S[x.tipo] * Number(x.monto), 0) * 100) / 100;
  };
  const estadoPago = async (ped) => (await db.query('SELECT estado e FROM pagos WHERE pedido_id=?', [ped]))[0][0].e;
  const stock = async (v, a) => Number((await db.query('SELECT cantidad c FROM inventario WHERE variante_id=? AND almacen_id=?', [v, a]))[0][0].c);

  try {
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const p = (await api('POST', '/productos', { categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPK Hilo' })).data.id;
    const v = (await api('POST', '/variantes', { producto_id: p, sku: 'TMPK-1', presentacion: 'Bolsa', tipo_presentacion: 'simple', precio: 100 })).data.id;
    const alm = (await api('POST', '/almacenes', { nombre: 'TMPK Tienda', es_punto_venta: true })).data.id;
    const caja = (await api('POST', '/caja/cajas', { almacen_id: alm, nombre: 'TMPK Caja' })).data.id;
    await api('POST', '/inventario/movimientos', { variante_id: v, almacen_id: alm, tipo: 'entrada', cantidad: 500, motivo: 'TMPK inicial' });
    const [met] = await db.query('SELECT id,nombre FROM metodos_pago');
    const efe = met.find((x) => /efectivo/i.test(x.nombre));
    const tarj = met.find((x) => !/efectivo/i.test(x.nombre));

    const s = (await api('POST', '/caja/sesiones', { caja_id: caja, monto_inicial: 0 })).data;

    console.log('=== 1. Venta en EFECTIVO de $1,000 ===');
    let r = await api('POST', '/pedidos', { canal: 'punto_venta', sesion_caja_id: s.id, items: [{ variante_id: v, cantidad: 10 }], pagos: [{ metodo_pago_id: efe.id, monto: 1000 }] });
    const ped = r.data.id;
    ck('entra a la caja', (await neto(s.id)) === 1000, '$' + (await neto(s.id)));
    r = await api('GET', '/caja/sesiones/' + s.id);
    ck('el corte espera $1,000', Number(r.data.esperado_actual) === 1000, '$' + r.data.esperado_actual);

    console.log('\n=== 2. CANCELAR saca el efectivo de la caja ===');
    r = await api('PATCH', '/pedidos/' + ped + '/estado', { estado: 'cancelado' });
    ck('se cancela', r.status === 200, r.data?.estado);
    ck('la caja vuelve a 0', (await neto(s.id)) === 0, '$' + (await neto(s.id)));
    const [mc] = await db.query('SELECT tipo,monto,motivo FROM movimientos_caja WHERE sesion_caja_id=? ORDER BY id', [s.id]);
    ck('con su movimiento de devolución', mc[1]?.tipo === 'devolucion' && Number(mc[1].monto) === 1000, mc[1]?.tipo + ' $' + mc[1]?.monto + ' · ' + mc[1]?.motivo);
    ck('el pago quedó reembolsado', (await estadoPago(ped)) === 'reembolsado');
    r = await api('GET', '/caja/sesiones/' + s.id);
    ck('EL CORTE YA NO CUENTA ESE DINERO', Number(r.data.esperado_actual) === 0, 'esperado $' + r.data.esperado_actual);

    console.log('\n=== 3. Reactivar reingresa el dinero ===');
    await api('PATCH', '/pedidos/' + ped + '/estado', { estado: 'pagado' });
    ck('vuelve el efectivo', (await neto(s.id)) === 1000, '$' + (await neto(s.id)));
    const [mc2] = await db.query('SELECT tipo FROM movimientos_caja WHERE sesion_caja_id=? ORDER BY id DESC LIMIT 1', [s.id]);
    ck('entra como ingreso, no como venta nueva', mc2[0].tipo === 'ingreso', mc2[0].tipo);
    ck('el pago vuelve a completado', (await estadoPago(ped)) === 'completado');

    console.log('\n=== 4. La TARJETA no toca el cajón ===');
    r = await api('POST', '/pedidos', { canal: 'punto_venta', sesion_caja_id: s.id, items: [{ variante_id: v, cantidad: 5 }], pagos: [{ metodo_pago_id: tarj.id, monto: 500 }] });
    const pedT = r.data.id;
    const antes = await neto(s.id);
    await api('PATCH', '/pedidos/' + pedT + '/estado', { estado: 'cancelado' });
    ck('el efectivo no se mueve', (await neto(s.id)) === antes, '$' + (await neto(s.id)));
    ck('pero el pago sí se reembolsa', (await estadoPago(pedT)) === 'reembolsado', '(lo devuelve el banco)');

    console.log('\n=== 5. Caja CERRADA: se rechaza, no se pierde el dinero ===');
    r = await api('POST', '/pedidos', { canal: 'punto_venta', sesion_caja_id: s.id, items: [{ variante_id: v, cantidad: 3 }], pagos: [{ metodo_pago_id: efe.id, monto: 300 }] });
    const ped3 = r.data.id;
    const netoFinal = await neto(s.id);
    const stockAntes = await stock(v, alm);
    await api('POST', '/caja/sesiones/' + s.id + '/cerrar', { monto_final: netoFinal });
    ck('el turno se cerró', (await db.query('SELECT estado e FROM sesiones_caja WHERE id=?', [s.id]))[0][0].e === 'cerrada');
    r = await api('PATCH', '/pedidos/' + ped3 + '/estado', { estado: 'cancelado' });
    ck('409 CAJA_CERRADA', r.status === 409 && r.error?.code === 'CAJA_CERRADA', r.status + ' ' + r.error?.code);
    console.log('        →', r.error?.message);
    // Todo o nada: si el dinero no se puede registrar, no se cancela NADA.
    ck('el pedido NO se canceló', (await db.query('SELECT estado e FROM pedidos WHERE id=?', [ped3]))[0][0].e !== 'cancelado');
    ck('ni se repuso el inventario', (await stock(v, alm)) === stockAntes, (await stock(v, alm)) + ' kg (sin cambio)');

    console.log('\n=== 6. Con un turno nuevo, el dinero sale de ahí ===');
    const s2 = (await api('POST', '/caja/sesiones', { caja_id: caja, monto_inicial: 0 })).data;
    r = await api('PATCH', '/pedidos/' + ped3 + '/estado', { estado: 'cancelado' });
    ck('ahora sí se cancela', r.status === 200, r.data?.estado);
    ck('el turno CERRADO no se tocó', (await neto(s.id)) === netoFinal, '$' + (await neto(s.id)) + ' (su corte sigue cuadrado)');
    ck('el dinero salió del turno NUEVO', (await neto(s2.id)) === -300, '$' + (await neto(s2.id)));
    ck('y ahora sí se repuso el inventario', (await stock(v, alm)) === stockAntes + 3, (await stock(v, alm)) + ' kg');
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
