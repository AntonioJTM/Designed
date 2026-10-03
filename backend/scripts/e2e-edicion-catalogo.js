'use strict';

/**
 * Prueba de lo que se corrigió en el catálogo el 2026-10-02:
 *
 *   · un producto dado de alta SIN precio por kilo se quedaba sin presentación
 *     y la pantalla decía que sí la tenía. Ahora la respuesta lo dice
 *     (`presentacion_pendiente`) y, en cuanto se le pone precio, se crea sola;
 *   · no había forma de cambiar el precio público ni el peso de una
 *     presentación que ya existía (`PATCH /variantes/:id`, solo jefes), y el
 *     cono de precio calculado tiene que seguir al paquete;
 *   · la búsqueda no encontraba "rojo 2/30": el calibre no estaba en el filtro,
 *     y el proveedor lo escribe con guion ("2-30");
 *   · el traspaso comparaba contra la existencia y no contra lo LIBRE.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   node scripts/e2e-edicion-catalogo.js   # BASE=http://localhost:3210/api/v1
 *
 * Crea todo con prefijo TMPED y lo borra al terminar. Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// Se niega a correr contra la base del servidor. Ver el módulo.
require('./_no-en-produccion');
const { soloPropios } = require('./_propios');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';
const firmar = (sub, rol_id, rol) =>
  jwt.sign({ sub, tipo: 'usuario', rol_id, rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
const tAdmin = firmar(1, 1, 'administrador');
const tCajero = firmar(3, 3, 'cajero');

const llamar = (token) => async (me, r, b) => {
  const x = await fetch(B + r, {
    method: me,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  return { status: x.status, ...(await x.json().catch(() => ({}))) };
};
const api = llamar(tAdmin);
const cajero = llamar(tCajero);

let f = 0;
const ck = (n, ok, d) => {
  console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + d : ''));
  if (!ok) f++;
};

(async () => {
  const db = await m.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const foto = {};
  for (const x of ['productos', 'almacenes']) {
    foto[x] = new Set((await db.query('SELECT id FROM ' + x))[0].map((r) => r.id));
  }
  // Un nombre propio por corrida, para que la búsqueda no encuentre restos.
  const SUF = Date.now().toString(36).toUpperCase();
  const NOMBRE = 'TMPED ROJO ' + SUF;

  try {
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;

    console.log('=== 1. Alta SIN precio por kilo ===');
    let r = await api('POST', '/productos', {
      categoria_id: cat, unidad_medida_id: kgu, nombre: NOMBRE, grosor_calibre: '2/30',
      multipresentacion: true,
    });
    const prod = r.data?.id;
    ck('el producto se guarda igual', r.status === 201, r.status);
    ck('sin presentación', (r.data?.variantes ?? []).length === 0, (r.data?.variantes ?? []).length);
    ck('Y LO DICE: presentacion_pendiente', !!r.data?.presentacion_pendiente, r.data?.presentacion_pendiente);

    console.log('\n=== 2. Al ponerle precio, la presentación se crea sola ===');
    r = await api('PUT', '/productos/' + prod, { precio_kg: 200 });
    const paquete = (r.data?.variantes ?? []).find((v) => v.tipo_presentacion === 'paquete');
    ck('ya tiene su paquete', !!paquete, paquete?.sku);
    ck('con el precio del producto', Number(paquete?.precio) === 200, '$' + paquete?.precio);
    r = await api('PUT', '/productos/' + prod, { descripcion: 'otra vez' });
    ck('editarlo otra vez no crea otra',
      (r.data?.variantes ?? []).filter((v) => v.tipo_presentacion !== 'cono').length === 1,
      (r.data?.variantes ?? []).length);

    console.log('\n=== 3. Cambiar precio y peso de la presentación ===');
    r = await api('PATCH', '/variantes/' + paquete.id, { peso_kg: 19 });
    ck('el peso se cambia', r.status === 200 && Number(r.data?.peso_kg) === 19, r.data?.peso_kg);
    const cono = (await api('POST', '/variantes', {
      producto_id: prod, sku: 'TMPED-CONO-' + SUF, tipo_presentacion: 'cono',
      origen_variante_id: paquete.id, piezas_por_origen: 12, modo_precio: 'calculado',
    })).data;
    ck('el cono arranca con el precio del paquete', Number(cono?.precio) === 200, '$' + cono?.precio);
    r = await api('PATCH', '/variantes/' + paquete.id, { precio: 250 });
    ck('el precio público se cambia', r.status === 200 && Number(r.data?.precio) === 250, '$' + r.data?.precio);
    const conoTras = (await api('GET', '/productos/' + prod)).data.variantes.find((v) => v.id === cono.id);
    ck('y el cono de precio calculado lo sigue', Number(conoTras?.precio) === 250, '$' + conoTras?.precio);
    r = await cajero('PATCH', '/variantes/' + paquete.id, { precio: 1 });
    ck('un cajero NO puede cambiarlo: 403', r.status === 403, r.status);
    r = await api('PATCH', '/variantes/' + paquete.id, {});
    ck('sin nada que cambiar: 422', r.status === 422, r.status);
    r = await api('PATCH', '/variantes/' + paquete.id, { sku: 'OTRO' });
    ck('el SKU no se toca aquí: 422', r.status === 422, r.status);

    console.log('\n=== 4. Buscar por color Y calibre ===');
    const palabra = 'TMPED';
    r = await api('GET', `/variantes?q=${encodeURIComponent(palabra + ' ' + SUF + ' 2/30')}`);
    ck('"color calibre" encuentra el paquete', r.data.items.some((v) => v.id === paquete.id), r.data.items.length);
    r = await api('GET', `/variantes?q=${encodeURIComponent(SUF + ' 2-30')}`);
    ck('con guion también ("2-30")', r.data.items.some((v) => v.id === paquete.id), r.data.items.length);
    r = await api('GET', `/variantes?q=${encodeURIComponent(SUF + ' 1/30')}`);
    ck('con otro calibre NO lo encuentra', !r.data.items.some((v) => v.id === paquete.id), r.data.items.length);
    r = await api('GET', `/productos?q=${encodeURIComponent(SUF + ' 2/30')}`);
    ck('el catálogo también busca por calibre', r.data.items.some((p) => p.id === prod), r.data.items.length);

    console.log('\n=== 5. El traspaso mira lo LIBRE ===');
    const alm = (await api('POST', '/almacenes', { nombre: 'TMPED Bodega ' + SUF })).data.id;
    await api('POST', '/inventario/movimientos', {
      variante_id: paquete.id, almacen_id: alm, tipo: 'entrada', cantidad: 100, motivo: 'TMPED',
    });
    await db.query('UPDATE inventario SET cantidad_reservada = 30 WHERE variante_id = ? AND almacen_id = ?',
      [paquete.id, alm]);
    r = await api('GET', `/inventario/equivalencia-paquetes?variante_id=${paquete.id}&almacen_id=${alm}`);
    const d = r.data?.disponible ?? {};
    ck('dice la existencia, lo apartado y lo libre',
      Number(d.kg_inventario) === 100 && Number(d.kg_apartado) === 30 && Number(d.kg_libre) === 70,
      `${d.kg_inventario} − ${d.kg_apartado} = ${d.kg_libre}`);

    console.log('\n=== 6. Solo se elimina un producto SIN nada cargado ===');
    // El del paso 5 ya tiene existencias y movimientos.
    r = await api('GET', `/productos/${prod}/eliminacion`);
    ck('con existencias y movimientos NO se puede', r.data?.se_puede === false, r.data?.mensaje);
    r = await api('DELETE', '/productos/' + prod);
    ck('y el borrado se rechaza: 409', r.status === 409 && r.error?.code === 'PRODUCTO_CON_MOVIMIENTOS', r.error?.message);
    r = await api('GET', '/productos/' + prod);
    ck('el producto sigue ahí', r.status === 200, r.status);

    // Recién dado de alta: solo su presentación vacía, que se crea sola.
    r = await api('POST', '/productos', {
      categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPED VACIO ' + SUF, grosor_calibre: '2/30',
      multipresentacion: true, precio_kg: 100,
    });
    const vacio = r.data?.id;
    const varVacio = (r.data?.variantes ?? [])[0]?.id;
    ck('el recién capturado trae su presentación vacía', !!varVacio, varVacio);
    r = await api('GET', `/productos/${vacio}/eliminacion`);
    ck('y SÍ se puede eliminar', r.data?.se_puede === true, JSON.stringify(r.data?.motivos));
    r = await cajero('DELETE', '/productos/' + vacio);
    ck('un cajero no lo borra: 403', r.status === 403, r.status);
    r = await api('DELETE', '/productos/' + vacio);
    ck('se borra', r.status === 200, r.status);
    const [[{ quedan }]] = await db.query('SELECT COUNT(*) quedan FROM producto_variantes WHERE id = ?', [varVacio]);
    ck('y su presentación vacía con él', Number(quedan) === 0, quedan);

    // Con un solo bulto capturado a mano (sin existencias ni kardex): antes la
    // cascada lo borraba sin avisar.
    r = await api('POST', '/productos', {
      categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPED BULTO ' + SUF, grosor_calibre: '2/30',
      multipresentacion: true, precio_kg: 100,
    });
    const conBulto = r.data?.id;
    const varBulto = (r.data?.variantes ?? [])[0]?.id;
    await api('POST', `/variantes/${varBulto}/codigos`, { codigo: 'TMPED-B-' + SUF, peso_kg: 19 });
    r = await api('GET', `/productos/${conBulto}/eliminacion`);
    ck('con un bulto ya NO se puede', r.data?.se_puede === false && /1 bulto/.test(r.data?.mensaje ?? ''), r.data?.mensaje);
    r = await api('DELETE', '/productos/' + conBulto);
    ck('el borrado se rechaza: 409', r.status === 409, r.status);
    const [[{ bultos }]] = await db.query('SELECT COUNT(*) bultos FROM variante_codigos WHERE variante_id = ?', [varBulto]);
    ck('y el bulto sigue ahí', Number(bultos) === 1, bultos);
  } catch (e) {
    console.error('\nERROR:', e.message);
    f++;
  } finally {
    console.log('\n=== Limpieza ===');
    // Solo lo NUEVO que sea de la prueba (prefijo TMP). Ver _propios.js.
    const nuevos = soloPropios(db, foto);
    await db.query('SET FOREIGN_KEY_CHECKS=0');
    for (const id of await nuevos('productos')) {
      const sub = '(SELECT id FROM producto_variantes WHERE producto_id=?)';
      for (const tb of ['variante_codigos', 'variante_precios', 'movimientos_inventario', 'inventario']) {
        await db.query('DELETE FROM ' + tb + ' WHERE variante_id IN ' + sub, [id]);
      }
      await db.query('DELETE FROM producto_variantes WHERE producto_id=?', [id]);
      await db.query('DELETE FROM productos WHERE id=?', [id]);
    }
    for (const id of await nuevos('almacenes')) await db.query('DELETE FROM almacenes WHERE id=?', [id]);
    await db.query('SET FOREIGN_KEY_CHECKS=1');
    const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM productos WHERE nombre LIKE 'TMPED%'");
    ck('no quedó nada de la prueba', Number(n) === 0, n);
    await db.end();
  }
  console.log('\n' + (f === 0 ? 'OK · todo pasó' : 'FALLAS: ' + f));
  process.exit(f ? 1 : 0);
})();
