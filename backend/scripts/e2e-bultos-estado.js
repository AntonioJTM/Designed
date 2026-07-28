'use strict';

/**
 * Prueba del estado del bulto: disponible / vendido / desarmado.
 * Un bulto es una pieza física única y solo se puede consumir una vez.
 *
 *   cd backend
 *   PORT=3218 node src/server.js &
 *   node scripts/e2e-bultos-estado.js     # BASE=http://localhost:3218/api/v1
 *
 * Crea todo con prefijo TMPE y lo borra al terminar. Sale 1 si algo falla.
 */

const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const RAIZ = path.join(__dirname, '..', '..');
const B = process.env.BASE ?? 'http://localhost:3218/api/v1';
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

(async () => {
  const db = await m.createConnection({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const foto = {};
  for (const x of ['productos', 'almacenes', 'pedidos', 'sesiones_caja', 'cajas']) foto[x] = new Set((await db.query('SELECT id FROM ' + x))[0].map((r) => r.id));
  const estadoDe = async (cod) => (await db.query('SELECT estado FROM variante_codigos WHERE codigo=?', [cod]))[0][0]?.estado;

  try {
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const p = (await api('POST', '/productos', { categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPE Marino', multipresentacion: true, por_lotes: true })).data.id;
    const paq = (await api('POST', '/variantes', { producto_id: p, sku: 'TMPE-PAQ', presentacion: 'Paquete', tipo_presentacion: 'paquete', peso_kg: 19.094, precio: 200 })).data.id;
    const cono = (await api('POST', '/variantes', { producto_id: p, sku: 'TMPE-CONO', presentacion: 'Cono', tipo_presentacion: 'cono', origen_variante_id: paq, piezas_por_origen: 12, modo_precio: 'calculado' })).data.id;
    const alm = (await api('POST', '/almacenes', { nombre: 'TMPE Bodega', es_punto_venta: true })).data.id;
    const caja = (await api('POST', '/caja/cajas', { almacen_id: alm, nombre: 'TMPE Caja' })).data.id;
    const buf = fs.readFileSync(path.join(RAIZ, 'MARINO OSCURO 2-30.xlsx'));
    const pr = await (await fetch(B + '/remesas/previa', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/octet-stream' }, body: buf })).json();
    await api('POST', '/remesas', { variante_id: paq, almacen_id: alm, bultos: marcar(pr.data.bultos) });
    const s = (await api('POST', '/caja/sesiones', { caja_id: caja, monto_inicial: 0 })).data;

    console.log('=== 1. Al llegar, los bultos están disponibles ===');
    let r = await api('GET', `/variantes/resolver/${cod('00531332')}`);
    ck('el bulto nace disponible', r.data.bulto?.estado === 'disponible', r.data.bulto?.estado);
    const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM variante_codigos WHERE variante_id=? AND estado='disponible'", [paq]);
    ck('los 80 disponibles', n === 80, n);

    console.log('\n=== 2. Vender un bulto lo marca vendido ===');
    const b1 = r.data.bulto;
    r = await api('POST', '/pedidos', { canal: 'punto_venta', sesion_caja_id: s.id,
      items: [{ variante_id: paq, cantidad: Number(b1.peso_kg), bultos: [{ codigo: b1.codigo, peso_kg: Number(b1.peso_kg), lote: b1.lote }] }],
      pagos: [{ metodo_pago_id: 1, monto: Number(b1.peso_kg) * 200 }] });
    ck('la venta pasa', r.status === 201, r.data?.numero_pedido);
    const ped = r.data.id;
    ck('el bulto quedó vendido', (await estadoDe(b1.codigo)) === 'vendido');
    r = await api('GET', '/variantes/resolver/' + b1.codigo);
    ck('y dice en qué pedido se fue', !!r.data.bulto?.consumido_folio, r.data.bulto?.consumido_folio);

    console.log('\n=== 3. No se puede vender el MISMO bulto otra vez ===');
    r = await api('POST', '/pedidos', { canal: 'punto_venta', sesion_caja_id: s.id,
      items: [{ variante_id: paq, cantidad: Number(b1.peso_kg), bultos: [{ codigo: b1.codigo, peso_kg: Number(b1.peso_kg) }] }],
      pagos: [{ metodo_pago_id: 1, monto: Number(b1.peso_kg) * 200 }] });
    ck('409 BULTO_NO_DISPONIBLE', r.status === 409 && r.error?.code === 'BULTO_NO_DISPONIBLE', r.status + ' ' + r.error?.code);
    const [[{ np }]] = await db.query('SELECT COUNT(*) np FROM pedidos');
    ck('y NO quedó un pedido a medias', np === foto.pedidos.size + 1, np + ' pedidos');

    console.log('\n=== 4. Ni desarmar un bulto ya vendido ===');
    r = await api('POST', '/inventario/desarmes', { cono_variante_id: cono, almacen_origen_id: alm, almacen_destino_id: alm, paquetes: 1, kg: 18.65, codigo_bulto: b1.codigo });
    ck('409 al desarmarlo', r.status === 409 && r.error?.code === 'BULTO_NO_DISPONIBLE', r.status + ' ' + r.error?.code);

    console.log('\n=== 5. Desarmar marca desarmado ===');
    const inc = (await api('GET', `/variantes/resolver/${cod('00548087')}`)).data.bulto;
    r = await api('POST', '/inventario/desarmes', { cono_variante_id: cono, almacen_origen_id: alm, almacen_destino_id: alm, paquetes: 1, kg: Number(inc.peso_kg), conos: inc.conos, codigo_bulto: inc.codigo });
    ck('el desarme pasa', r.status === 201, '+' + r.data?.piezas_generadas + ' conos');
    ck('el bulto quedó desarmado', (await estadoDe(inc.codigo)) === 'desarmado');
    r = await api('POST', '/inventario/desarmes', { cono_variante_id: cono, almacen_origen_id: alm, almacen_destino_id: alm, paquetes: 1, kg: 10.75, codigo_bulto: inc.codigo });
    ck('no se desarma dos veces', r.status === 409, r.status + ' ' + r.error?.code);
    r = await api('POST', '/pedidos', { canal: 'punto_venta', sesion_caja_id: s.id,
      items: [{ variante_id: paq, cantidad: 10.75, bultos: [{ codigo: inc.codigo, peso_kg: 10.75 }] }],
      pagos: [{ metodo_pago_id: 1, monto: 2150 }] });
    ck('ni se vende un bulto desarmado', r.status === 409, r.status + ' ' + r.error?.code);

    console.log('\n=== 6. Cancelar el pedido libera el bulto ===');
    r = await api('PATCH', '/pedidos/' + ped + '/estado', { estado: 'cancelado' });
    ck('el pedido se cancela', r.status === 200, r.data?.estado);
    ck('el bulto volvió a disponible', (await estadoDe(b1.codigo)) === 'disponible', await estadoDe(b1.codigo));
    r = await api('POST', '/pedidos', { canal: 'punto_venta', sesion_caja_id: s.id,
      items: [{ variante_id: paq, cantidad: Number(b1.peso_kg), bultos: [{ codigo: b1.codigo, peso_kg: Number(b1.peso_kg) }] }],
      pagos: [{ metodo_pago_id: 1, monto: Number(b1.peso_kg) * 200 }] });
    ck('y se puede volver a vender', r.status === 201, r.data?.numero_pedido);
    const ped2 = r.data.id;

    console.log('\n=== 7. Reactivar un pedido cancelado retoma sus bultos ===');
    const b3 = (await api('GET', `/variantes/resolver/${cod('00531527')}`)).data.bulto;
    r = await api('POST', '/pedidos', { canal: 'punto_venta', sesion_caja_id: s.id,
      items: [{ variante_id: paq, cantidad: Number(b3.peso_kg), bultos: [{ codigo: b3.codigo, peso_kg: Number(b3.peso_kg) }] }],
      pagos: [{ metodo_pago_id: 1, monto: Number(b3.peso_kg) * 200 }] });
    const ped3 = r.data.id;
    await api('PATCH', '/pedidos/' + ped3 + '/estado', { estado: 'cancelado' });
    ck('cancelado → disponible', (await estadoDe(b3.codigo)) === 'disponible');
    await api('PATCH', '/pedidos/' + ped3 + '/estado', { estado: 'pagado' });
    ck('reactivado → vendido otra vez', (await estadoDe(b3.codigo)) === 'vendido', await estadoDe(b3.codigo));

    console.log('\n=== 8. Dos cajas peleando por el mismo bulto ===');
    const b4 = (await api('GET', `/variantes/resolver/${cod('00531532')}`)).data.bulto;
    const venta = () => api('POST', '/pedidos', { canal: 'punto_venta', sesion_caja_id: s.id,
      items: [{ variante_id: paq, cantidad: Number(b4.peso_kg), bultos: [{ codigo: b4.codigo, peso_kg: Number(b4.peso_kg) }] }],
      pagos: [{ metodo_pago_id: 1, monto: Number(b4.peso_kg) * 200 }] });
    const [r1, r2] = await Promise.all([venta(), venta()]);
    const oks = [r1, r2].filter((x) => x.status === 201).length;
    ck('solo UNA de las dos pasa', oks === 1, `una ${r1.status}, otra ${r2.status}`);
    ck('el bulto quedó vendido una vez', (await estadoDe(b4.codigo)) === 'vendido');
    const [[{ v }]] = await db.query("SELECT COUNT(*) v FROM pedido_detalle_bultos WHERE codigo=?", [b4.codigo]);
    ck('y con un solo rastro de venta', v === 1, v);

    console.log('\n=== 9. Un pedido sin bultos sigue funcionando ===');
    r = await api('POST', '/pedidos', { canal: 'punto_venta', sesion_caja_id: s.id,
      items: [{ variante_id: paq, cantidad: 5 }], pagos: [{ metodo_pago_id: 1, monto: 1000 }] });
    ck('venta a granel sin escanear', r.status === 201, r.data?.numero_pedido);
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
      await db.query('DELETE FROM variante_conversiones WHERE variante_origen_id IN ' + sub + ' OR variante_destino_id IN ' + sub, [id, id]);
      await db.query('DELETE FROM remesas WHERE variante_id IN ' + sub, [id]);
      await db.query('UPDATE producto_variantes SET origen_variante_id=NULL WHERE producto_id=?', [id]);
      await db.query('DELETE FROM producto_variantes WHERE producto_id=?', [id]);
      await db.query('DELETE FROM productos WHERE id=?', [id]);
    }
    for (const id of await nuevos('almacenes')) await db.query('DELETE FROM almacenes WHERE id=?', [id]);
    await db.query('SET FOREIGN_KEY_CHECKS=1');
    const [[{ np2 }]] = await db.query('SELECT COUNT(*) np2 FROM pedidos');
    ck('la base quedó como antes', np2 === foto.pedidos.size, np2 + ' pedidos');
    await db.end();
  }
  console.log('\n' + (f === 0 ? 'OK · todo pasó' : 'FALLAS: ' + f));
  process.exit(f ? 1 : 0);
})();
