'use strict';

/**
 * Prueba de la cancelación de pedidos: la mercancía regresa al inventario DEL
 * ALMACÉN DONDE SE VENDIÓ, con su movimiento en el kardex, y los bultos
 * escaneados vuelven a estar disponibles.
 *
 *   cd backend
 *   PORT=3219 node src/server.js &
 *   node scripts/e2e-cancelacion.js       # BASE=http://localhost:3219/api/v1
 *
 * Usa DOS almacenes para comprobar que solo se toca el que vendió. Crea todo con
 * prefijo TMPC y lo borra al terminar. Sale 1 si algo falla.
 */

const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const RAIZ = path.join(__dirname, '..', '..');
const B = process.env.BASE ?? 'http://localhost:3219/api/v1';
const t = jwt.sign({ sub: 1, tipo: 'usuario', rol_id: 1, rol: 'administrador' }, process.env.JWT_SECRET, { expiresIn: '1h' });

const api = async (me, r, b) => {
  const x = await fetch(B + r, { method: me, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: x.status, ...(await x.json().catch(() => ({}))) };
};

// Los códigos del archivo real ya están en la base: la tienda lo cargó de verdad.
// Cada corrida les pone un sufijo propio para no chocar y para que la prueba no
// dependa del estado de la base. `cod()` traduce del código del archivo al de esta
// corrida.
const SUF = '-T' + Date.now().toString(36);
const _cod = new Map();
function marcar(bultos) {
  return bultos.map((b) => {
    const codigo = b.codigo + SUF;
    _cod.set(b.codigo, codigo);
    return { ...b, codigo };
  });
}
const cod = (original) => _cod.get(original) ?? original + SUF;

let f = 0;
const ck = (n, ok, d) => { console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + d : '')); if (!ok) f++; };
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001;

(async () => {
  const db = await m.createConnection({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const foto = {};
  for (const x of ['productos', 'almacenes', 'pedidos', 'sesiones_caja', 'cajas']) foto[x] = new Set((await db.query('SELECT id FROM ' + x))[0].map((r) => r.id));
  const saldo = async (v, a) => Number(((await db.query('SELECT cantidad c FROM inventario WHERE variante_id=? AND almacen_id=?', [v, a]))[0][0] || { c: 0 }).c);

  try {
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const p = (await api('POST', '/productos', { categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPC Marino', multipresentacion: true, por_lotes: true })).data.id;
    const paq = (await api('POST', '/variantes', { producto_id: p, sku: 'TMPC-PAQ', presentacion: 'Paquete', tipo_presentacion: 'paquete', peso_kg: 19.094, precio: 200 })).data.id;
    const almA = (await api('POST', '/almacenes', { nombre: 'TMPC Tienda A', es_punto_venta: true })).data.id;
    const almB = (await api('POST', '/almacenes', { nombre: 'TMPC Tienda B', es_punto_venta: true })).data.id;
    const cajaA = (await api('POST', '/caja/cajas', { almacen_id: almA, nombre: 'TMPC Caja A' })).data.id;
    const buf = fs.readFileSync(path.join(RAIZ, 'MARINO OSCURO 2-30.xlsx'));
    const pr = await (await fetch(B + '/remesas/previa', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/octet-stream' }, body: buf })).json();
    await api('POST', '/remesas', { variante_id: paq, almacen_id: almA, bultos: marcar(pr.data.bultos) });
    // Stock en B, para comprobar que la cancelación NO lo toca.
    await api('POST', '/inventario/movimientos', { variante_id: paq, almacen_id: almB, tipo: 'entrada', cantidad: 100, motivo: 'TMPC inicial B' });
    const s = (await api('POST', '/caja/sesiones', { caja_id: cajaA, monto_inicial: 0 })).data;

    const antesA = await saldo(paq, almA), antesB = await saldo(paq, almB);
    console.log(`=== Antes de vender ===\n   Tienda A: ${antesA} kg  ·  Tienda B: ${antesB} kg`);

    console.log('\n=== 1. Vender descuenta de A ===');
    const b1 = (await api('GET', `/variantes/resolver/${cod('00531332')}`)).data.bulto;
    let r = await api('POST', '/pedidos', { canal: 'punto_venta', sesion_caja_id: s.id,
      items: [{ variante_id: paq, cantidad: Number(b1.peso_kg), bultos: [{ codigo: b1.codigo, peso_kg: Number(b1.peso_kg), lote: b1.lote }] }],
      pagos: [{ metodo_pago_id: 1, monto: Number(b1.peso_kg) * 200 }] });
    const ped = r.data.id;
    ck(`A bajó ${b1.peso_kg} kg`, cerca(await saldo(paq, almA), antesA - Number(b1.peso_kg)), (await saldo(paq, almA)) + ' kg');
    ck('B no se movió', (await saldo(paq, almB)) === antesB, (await saldo(paq, almB)) + ' kg');

    console.log('\n=== 2. CANCELAR regresa la mercancía a A ===');
    r = await api('PATCH', '/pedidos/' + ped + '/estado', { estado: 'cancelado' });
    ck('el pedido se cancela', r.status === 200, r.data?.estado);
    ck('A volvió a su saldo original', cerca(await saldo(paq, almA), antesA), (await saldo(paq, almA)) + ' kg');
    ck('B sigue intacto', (await saldo(paq, almB)) === antesB, (await saldo(paq, almB)) + ' kg');
    ck('el bulto volvió a disponible', (await db.query('SELECT estado e FROM variante_codigos WHERE codigo=?', [b1.codigo]))[0][0].e === 'disponible');

    console.log('\n=== 3. El kardex lo explica ===');
    const [mv] = await db.query("SELECT tipo,cantidad,motivo,almacen_id FROM movimientos_inventario WHERE referencia_tipo='pedido' AND referencia_id=? ORDER BY id", [ped]);
    ck('las dos patas: salida y entrada', mv.length === 2 && mv[0].tipo === 'salida' && mv[1].tipo === 'entrada', mv.map((x) => x.tipo + ' ' + x.cantidad).join(' · '));
    ck('la entrada dice que fue cancelación', /Cancelación/.test(mv[1]?.motivo || ''), mv[1]?.motivo);
    ck('y entró al almacén donde se vendió', mv[1]?.almacen_id === almA, 'almacen ' + mv[1]?.almacen_id + ' (A=' + almA + ')');

    console.log('\n=== 4. Cancelar dos veces no repone doble ===');
    await api('PATCH', '/pedidos/' + ped + '/estado', { estado: 'cancelado' });
    ck('sigue en el mismo saldo', cerca(await saldo(paq, almA), antesA), (await saldo(paq, almA)) + ' kg');

    console.log('\n=== 5. Reactivar vuelve a descontar ===');
    r = await api('PATCH', '/pedidos/' + ped + '/estado', { estado: 'pagado' });
    ck('se reactiva', r.status === 200, r.data?.estado);
    ck('A bajó otra vez', cerca(await saldo(paq, almA), antesA - Number(b1.peso_kg)), (await saldo(paq, almA)) + ' kg');

    console.log('\n=== 6. DEVOLUCIÓN también regresa ===');
    await api('PATCH', '/pedidos/' + ped + '/estado', { estado: 'devuelto' });
    ck('A recuperó la mercancía', cerca(await saldo(paq, almA), antesA), (await saldo(paq, almA)) + ' kg');
    const [mv2] = await db.query("SELECT motivo FROM movimientos_inventario WHERE referencia_tipo='pedido' AND referencia_id=? ORDER BY id DESC LIMIT 1", [ped]);
    ck('y el kardex dice devolución', /Devolución/.test(mv2[0]?.motivo || ''), mv2[0]?.motivo);

    console.log('\n=== 7. No se reactiva si ya no hay existencias ===');
    await db.query('UPDATE inventario SET cantidad=0 WHERE variante_id=? AND almacen_id=?', [paq, almA]);
    r = await api('PATCH', '/pedidos/' + ped + '/estado', { estado: 'pagado' });
    ck('409 STOCK_INSUFICIENTE', r.status === 409 && r.error?.code === 'STOCK_INSUFICIENTE', r.status + ' ' + r.error?.code);
    const [[pe]] = await db.query('SELECT estado FROM pedidos WHERE id=?', [ped]);
    ck('el pedido NO cambió de estado', pe.estado === 'devuelto', pe.estado);
    ck('ni se movió el inventario', (await saldo(paq, almA)) === 0, (await saldo(paq, almA)) + ' kg');
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
      await db.query('DELETE FROM remesas WHERE variante_id IN ' + sub, [id]);
      await db.query('UPDATE producto_variantes SET origen_variante_id=NULL WHERE producto_id=?', [id]);
      await db.query('DELETE FROM producto_variantes WHERE producto_id=?', [id]);
      await db.query('DELETE FROM productos WHERE id=?', [id]);
    }
    for (const id of await nuevos('almacenes')) await db.query('DELETE FROM almacenes WHERE id=?', [id]);
    await db.query('SET FOREIGN_KEY_CHECKS=1');
    const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM pedidos');
    ck('la base quedó como antes', n === foto.pedidos.size, n + ' pedidos');
    await db.end();
  }
  console.log('\n' + (f === 0 ? 'OK · todo pasó' : 'FALLAS: ' + f));
  process.exit(f ? 1 : 0);
})();
