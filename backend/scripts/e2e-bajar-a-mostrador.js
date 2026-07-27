'use strict';

/**
 * Prueba del flujo que pidió la tienda para pasar conos a mostrador: se ESCANEA
 * el paquete, el sistema dice cuántos conos trae, y al confirmar se deshace el
 * paquete y entran los conos. Sin configurar nada antes.
 *
 *   cd backend
 *   PORT=3231 node src/server.js &
 *   node scripts/e2e-bajar-a-mostrador.js
 *
 * Crea todo con prefijo ZZ y lo borra al terminar. Sale 1 si algo falla.
 */

const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const ARCHIVO = path.join(__dirname, '..', '..', 'muestras', 'ROJO 1-30.xlsx');
const B = process.env.BASE ?? 'http://localhost:3231/api/v1';
const t = jwt.sign({ sub: 1, tipo: 'usuario', rol_id: 1, rol: 'administrador' }, process.env.JWT_SECRET, { expiresIn: '1h' });

// Sufijo propio por corrida: los códigos de las muestras pueden estar ya en uso.
const SUF = '-D' + Date.now().toString(36);

const api = async (me, r, b) => {
  const x = await fetch(B + r, { method: me, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: x.status, ...(await x.json().catch(() => ({}))) };
};
let f = 0;
const ck = (n, ok, d) => { console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + d : '')); if (!ok) f++; };

(async () => {
  const db = await m.createConnection({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const antes = new Set((await db.query('SELECT id FROM productos'))[0].map((r) => r.id));
  const stock = async (v, a) => Number(((await db.query('SELECT cantidad c FROM inventario WHERE variante_id=? AND almacen_id=?', [v, a]))[0][0] || { c: 0 }).c);

  try {
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const bodega = (await api('POST', '/almacenes', { nombre: 'ZZ Bodega' })).data.id;
    const most = (await api('POST', '/almacenes', { nombre: 'ZZ Mostrador', es_punto_venta: true })).data.id;
    const p = (await api('POST', '/productos', { categoria_id: cat, unidad_medida_id: kgu, nombre: 'ZZ ROJO', grosor_calibre: '1/30', precio_kg: 200, multipresentacion: true, por_lotes: true })).data.id;

    const previa = await (await fetch(B + '/remesas/previa', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/octet-stream' },
      body: fs.readFileSync(ARCHIVO),
    })).json();
    const bultos = previa.data.bultos.map((b) => ({ ...b, codigo: b.codigo + SUF }));
    await api('POST', '/remesas', { producto_id: p, almacen_id: bodega, bultos });

    const det = (await api('GET', '/productos/' + p)).data;
    const paq = det.variantes[0];
    ck('el producto tiene SOLO su paquete', det.variantes.length === 1, `${paq.sku} (${paq.tipo_presentacion})`);
    ck('NO hay cono configurado', !det.variantes.some((v) => v.tipo_presentacion === 'cono'));
    const b1 = bultos[0];

    console.log('\n=== 1. Escaneo el paquete: me dice qué trae ===');
    let r = await api('GET', '/inventario/desarmes/previa/' + b1.codigo);
    ck('lo resuelve', r.status === 200, `${r.data.paquete.producto} · bulto ${r.data.bulto.codigo}`);
    ck('dice sus kilos REALES', Number(r.data.bulto.peso_kg) === b1.peso_kg, r.data.bulto.peso_kg + ' kg');
    ck('DICE CUÁNTOS CONOS TRAE', r.data.conos_a_generar === 16, r.data.conos_a_generar + ' conos');
    ck('avisa que el cono aún no existe', r.data.cono === null);
    ck('y dónde está la mercancía', r.data.existencias.length === 1, `${r.data.existencias[0].almacen} · ${r.data.existencias[0].cantidad} kg`);
    ck('con su lote', !!r.data.bulto.lote, 'lote ' + r.data.bulto.lote);

    console.log('\n=== 2. Confirmo: se baja y el cono se crea solo ===');
    const kgAntes = await stock(paq.id, bodega);
    r = await api('POST', '/inventario/desarmes', { codigo_bulto: b1.codigo, almacen_origen_id: bodega, almacen_destino_id: most });
    ck('el desarme pasa SIN configurar nada', r.status === 201, `−${r.data.kg_consumidos} kg → +${r.data.piezas_generadas} conos`);
    ck('consumió el peso real del bulto', Number(r.data.kg_consumidos) === b1.peso_kg);
    ck('deja constancia de los 16 conos', Number(r.data.piezas_generadas) === 16);
    const cono = (await api('GET', '/productos/' + p)).data.variantes.find((v) => v.tipo_presentacion === 'cono');
    ck('el cono se creó solo', !!cono, `${cono?.sku} · $${cono?.precio} por pieza`);
    // El cono se vende por kilo, al MISMO precio del paquete: es el mismo hilo.
    ck('al mismo precio por kilo del paquete', Number(cono.precio) === Number(paq.precio),
      `$${cono.precio}/kg (paquete $${paq.precio})`);
    ck('bajó el paquete de la bodega', Math.abs(kgAntes - (await stock(paq.id, bodega)) - b1.peso_kg) < 0.001,
      `${kgAntes} → ${await stock(paq.id, bodega)}`);
    ck('y entraron los KILOS al mostrador', Math.abs((await stock(cono.id, most)) - b1.peso_kg) < 0.001,
      (await stock(cono.id, most)) + ' kg');
    ck('el bulto quedó desarmado',
      (await db.query('SELECT estado e FROM variante_codigos WHERE codigo=?', [b1.codigo]))[0][0].e === 'desarmado');

    console.log('\n=== 3. El segundo bulto reutiliza el cono ===');
    r = await api('POST', '/inventario/desarmes', { codigo_bulto: bultos[1].codigo, almacen_origen_id: bodega, almacen_destino_id: most });
    ck('se baja igual', r.status === 201, '+' + r.data.piezas_generadas + ' conos');
    ck('sigue habiendo UN solo cono',
      (await api('GET', '/productos/' + p)).data.variantes.filter((v) => v.tipo_presentacion === 'cono').length === 1);
    ck('los kilos se acumulan', Math.abs((await stock(cono.id, most)) - (b1.peso_kg + bultos[1].peso_kg)) < 0.001,
      (await stock(cono.id, most)) + ' kg');

    console.log('\n=== 4. Guardas ===');
    r = await api('GET', '/inventario/desarmes/previa/' + b1.codigo);
    ck('un bulto ya desarmado no se vuelve a bajar', r.status === 409, `${r.status} ${r.error?.code}`);
    r = await api('GET', '/inventario/desarmes/previa/NO-EXISTE');
    ck('404 si el código no existe', r.status === 404, `${r.status} ${r.error?.code}`);
    r = await api('POST', '/inventario/desarmes', { almacen_origen_id: bodega, almacen_destino_id: most });
    ck('sin bulto ni cono da 422', r.status === 422, r.status);
  } finally {
    console.log('\n=== Limpieza ===');
    await db.query('SET FOREIGN_KEY_CHECKS=0');
    for (const id of (await db.query('SELECT id FROM productos'))[0].map((r) => r.id).filter((i) => !antes.has(i))) {
      const sub = '(SELECT id FROM producto_variantes WHERE producto_id=?)';
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) await db.query('DELETE FROM ' + tb + ' WHERE variante_id IN ' + sub, [id]);
      await db.query('DELETE FROM variante_conversiones WHERE variante_origen_id IN ' + sub + ' OR variante_destino_id IN ' + sub, [id, id]);
      await db.query('DELETE FROM remesas WHERE variante_id IN ' + sub, [id]);
      await db.query('UPDATE producto_variantes SET origen_variante_id=NULL WHERE producto_id=?', [id]);
      await db.query('DELETE FROM producto_variantes WHERE producto_id=?', [id]);
      await db.query('DELETE FROM productos WHERE id=?', [id]);
    }
    await db.query("DELETE FROM almacenes WHERE nombre LIKE 'ZZ %'");
    await db.query('SET FOREIGN_KEY_CHECKS=1');
    ck('los datos de la tienda intactos', (await db.query('SELECT COUNT(*) n FROM productos'))[0][0].n === antes.size, antes.size + ' productos');
    await db.end();
  }
  console.log('\n' + (f === 0 ? 'OK · todo pasó' : 'FALLAS: ' + f));
  process.exit(f ? 1 : 0);
})();
