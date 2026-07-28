'use strict';

/**
 * Prueba del flujo que pidió la tienda: se guarda el producto SIN presentaciones
 * y el Excel del proveedor las llena y mete la mercancía al inventario.
 *
 *   cd backend
 *   PORT=3226 node src/server.js &
 *   node scripts/e2e-carga-por-producto.js
 *
 * Crea todo con prefijo TMPM y lo borra al terminar. Sale 1 si algo falla.
 */

const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const RAIZ = path.join(__dirname, '..', '..');
const ARCHIVO = path.join(RAIZ, 'MARINO OSCURO 2-30.xlsx');
const B = process.env.BASE ?? 'http://localhost:3226/api/v1';
const t = jwt.sign({ sub: 1, tipo: 'usuario', rol_id: 1, rol: 'administrador' }, process.env.JWT_SECRET, { expiresIn: '1h' });

const api = async (me, r, b) => {
  const x = await fetch(B + r, { method: me, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: x.status, ...(await x.json().catch(() => ({}))) };
};
const subir = async () => {
  const x = await fetch(B + '/remesas/previa', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/octet-stream', 'X-Nombre-Archivo': path.basename(ARCHIVO) },
    body: fs.readFileSync(ARCHIVO),
  });
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
  for (const x of ['productos', 'almacenes', 'remesas']) foto[x] = new Set((await db.query('SELECT id FROM ' + x))[0].map((r) => r.id));

  try {
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const alm = (await api('POST', '/almacenes', { nombre: 'TMPM Bodega' })).data.id;

    console.log('=== 1. El producto se guarda con su presentación ya creada ===');
    let r = await api('POST', '/productos', {
      categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPM MARINO OSCURO 2/30',
      precio_kg: 200, multipresentacion: true, por_lotes: true,
    });
    const prod = r.data.id;
    ck('se crea', r.status === 201, r.data?.nombre);
    // La presentación nace con el producto: paquete, SKU del nombre, sin peso.
    const inicial = (await api('GET', '/productos/' + prod)).data.variantes;
    ck('ya trae su presentación', inicial.length === 1, `${inicial[0]?.sku} (${inicial[0]?.tipo_presentacion})`);
    ck('sin peso todavía', inicial[0]?.peso_kg === null, String(inicial[0]?.peso_kg));

    console.log('\n=== 2. La vista previa del Excel (nada se guarda) ===');
    r = await subir();
    const s = r.data.resumen;
    ck('lee los 80 bultos', s.num_bultos === 80, s.num_bultos);
    ck('1,527.500 kg', s.kg_total === 1527.5, s.kg_total + ' kg');
    ck('2 lotes del mismo hilo', s.lotes.length === 2, s.lotes.map((l) => l.lote).join(' · '));
    ck('la presentación sigue sin peso', (await api('GET', '/productos/' + prod)).data.variantes[0].peso_kg === null);
    const bultos = marcar(r.data.bultos);

    console.log('\n=== 3. Cargar POR PRODUCTO usa esa presentación y le pone el peso ===');
    r = await api('POST', '/remesas', { producto_id: prod, almacen_id: alm, archivo: 'MARINO OSCURO 2-30.xlsx', bultos });
    ck('la carga pasa', r.status === 201, r.data?.folio);
    ck('80 bultos y 1,527.5 kg', r.data?.num_bultos === 80 && Number(r.data?.kg_total) === 1527.5);
    const det = (await api('GET', '/productos/' + prod)).data;
    ck('sigue habiendo UNA presentación', det.variantes.length === 1, det.variantes[0]?.sku);
    const v = det.variantes[0];
    ck('es de tipo paquete', v.tipo_presentacion === 'paquete', v.tipo_presentacion);
    ck('el SKU sale del nombre', v.sku === 'TMPM-MARINO-OSCURO-2-30', v.sku);
    ck('heredó el precio de lista ($200)', Number(v.precio) === 200, '$' + v.precio);
    ck('su peso es el PROMEDIO de los bultos', Number(v.peso_kg) === 19.094, v.peso_kg + ' kg');

    console.log('\n=== 4. Y la mercancía entró al inventario ===');
    const [[inv]] = await db.query('SELECT cantidad c FROM inventario WHERE variante_id=? AND almacen_id=?', [v.id, alm]);
    ck('1,527.500 kg en el almacén', Number(inv.c) === 1527.5, inv.c + ' kg');
    const [[mv]] = await db.query("SELECT tipo, cantidad, motivo FROM movimientos_inventario WHERE referencia_tipo='remesa' ORDER BY id DESC LIMIT 1");
    ck('con su movimiento en el kardex', mv.tipo === 'entrada', mv.motivo);
    const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM variante_codigos WHERE variante_id=?', [v.id]);
    ck('los 80 bultos quedaron registrados', n === 80, n);

    console.log('\n=== 5. Una segunda remesa NO duplica la presentación ===');
    // Se reutiliza la misma presentación: solo cambian los códigos.
    const otros = bultos.slice(0, 3).map((b, i) => ({ ...b, codigo: 'TMPM-2DA-' + i }));
    r = await api('POST', '/remesas', { producto_id: prod, almacen_id: alm, bultos: otros });
    ck('la segunda carga pasa', r.status === 201, r.data?.folio);
    ck('sigue habiendo UNA presentación', (await api('GET', '/productos/' + prod)).data.variantes.length === 1);
    const [[inv2]] = await db.query('SELECT cantidad c FROM inventario WHERE variante_id=? AND almacen_id=?', [v.id, alm]);
    const suma = 1527.5 + otros.reduce((a, b) => a + Number(b.peso_kg), 0);
    ck('el inventario acumula', Math.abs(Number(inv2.c) - suma) < 0.001, inv2.c + ' kg');

    console.log('\n=== 6. Filas y columnas vacías: no cuentan ===');
    ck('ninguno de los 80 bultos salió sin código', bultos.every((b) => b.codigo));
    ck('ninguno sin peso', bultos.every((b) => b.peso_kg > 0));
    ck('las fechas (D y E) no aparecen en el resultado',
      !('fecha_produccion' in bultos[0]) && !('fecha_caducidad' in bultos[0]),
      Object.keys(bultos[0]).join(', '));
    // El bulto sin conos en el archivo queda en null, no en 0 ni en error.
    ck('el lote vacío quedaría en null, no en cadena vacía',
      bultos.every((b) => b.lote === null || (typeof b.lote === 'string' && b.lote.length > 0)));

    console.log('\n=== 7. Producto sin multipresentación → su presentación es simple ===');
    const prod2 = (await api('POST', '/productos', { categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPM SIMPLE', precio_kg: 150 })).data.id;
    const otros2 = bultos.slice(0, 2).map((b, i) => ({ ...b, codigo: 'TMPM-SIM-' + i }));
    r = await api('POST', '/remesas', { producto_id: prod2, almacen_id: alm, bultos: otros2 });
    ck('carga sobre producto simple', r.status === 201, r.data?.folio);
    const d2 = (await api('GET', '/productos/' + prod2)).data;
    ck('creó una presentación simple', d2.variantes[0]?.tipo_presentacion === 'simple', d2.variantes[0]?.tipo_presentacion);
    ck('con el precio del producto', Number(d2.variantes[0]?.precio) === 150, '$' + d2.variantes[0]?.precio);

    console.log('\n=== 8. Sin producto ni presentación se rechaza ===');
    r = await api('POST', '/remesas', { almacen_id: alm, bultos: otros2 });
    ck('422', r.status === 422, r.status + ' ' + (r.error?.code ?? ''));
  } finally {
    console.log('\n=== Limpieza ===');
    await db.query('SET FOREIGN_KEY_CHECKS=0');
    const nuevos = async (x) => (await db.query('SELECT id FROM ' + x))[0].map((r) => r.id).filter((i) => !foto[x].has(i));
    for (const id of await nuevos('productos')) {
      const sub = '(SELECT id FROM producto_variantes WHERE producto_id=?)';
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) await db.query('DELETE FROM ' + tb + ' WHERE variante_id IN ' + sub, [id]);
      await db.query('DELETE FROM remesas WHERE variante_id IN ' + sub, [id]);
      await db.query('UPDATE producto_variantes SET origen_variante_id=NULL WHERE producto_id=?', [id]);
      await db.query('DELETE FROM producto_variantes WHERE producto_id=?', [id]);
      await db.query('DELETE FROM productos WHERE id=?', [id]);
    }
    for (const id of await nuevos('almacenes')) await db.query('DELETE FROM almacenes WHERE id=?', [id]);
    await db.query('SET FOREIGN_KEY_CHECKS=1');
    ck('la base quedó como antes', (await db.query('SELECT COUNT(*) n FROM productos'))[0][0].n === foto.productos.size);
    await db.end();
  }
  console.log('\n' + (f === 0 ? 'OK · todo pasó' : 'FALLAS: ' + f));
  process.exit(f ? 1 : 0);
})();
