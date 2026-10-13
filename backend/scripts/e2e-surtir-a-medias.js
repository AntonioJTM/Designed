'use strict';

/**
 * Prueba de SURTIR UNA SUCURSAL A MEDIAS (2026-10-07): "que se puedan escanear
 * una parte, se guarden esos códigos de barras pero que ya no se puedan vender
 * hasta que cancele el pedido; que haya un como en espera hasta que terminen de
 * escanear los demás".
 *
 *   · se guarda lo escaneado: esos paquetes quedan APARTADOS para el envío (la
 *     caja los rechaza, no se bajan a conos, otro envío no los toma) y el
 *     traspaso sigue por enviar, con lo guardado a la vista;
 *   · se vuelve a guardar con otra lista: lo que ya no viene queda libre;
 *   · al enviar salen lo guardado y lo nuevo, y quedan disponibles en la
 *     sucursal; lo que se guardó y no se mandó queda libre;
 *   · cancelar una solicitud con paquetes guardados los deja libres;
 *   · ya enviado, no se guarda nada (409).
 *
 * Crea "TMPSM …" y lo borra al final.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-surtir-a-medias.js   # contra la base de pruebas
 *
 * Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';
const SUF = Date.now().toString(36).toUpperCase();

let f = 0;
const ck = (n, ok, d) => {
  console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + JSON.stringify(d) : ''));
  if (!ok) f++;
};

(async () => {
  const db = await m.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const [[admin]] = await db.query(
    `SELECT u.id, u.rol_id FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = 'administrador' AND u.activo = 1 ORDER BY u.id LIMIT 1`
  );
  const t = jwt.sign({ sub: admin.id, tipo: 'usuario', rol_id: admin.rol_id, rol: 'administrador' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const api = async (me, r, b) => {
    const x = await fetch(B + r, {
      method: me,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };
  const estados = async (codigos) => {
    const [rows] = await db.query('SELECT codigo, estado, consumido_tipo, almacen_id FROM variante_codigos WHERE codigo IN (?)', [codigos]);
    return Object.fromEntries(rows.map((r) => [r.codigo, r]));
  };
  const traspasos = [];

  try {
    const [[origen]] = await db.query('SELECT id, nombre FROM almacenes WHERE activo = 1 AND es_punto_venta = 0 ORDER BY id LIMIT 1');
    const [[destino]] = await db.query('SELECT id, nombre FROM almacenes WHERE activo = 1 AND es_punto_venta = 1 AND id <> ? ORDER BY id LIMIT 1', [origen.id]);
    const [[cat]] = await db.query('SELECT id FROM categorias ORDER BY id LIMIT 1');
    const [[kg]] = await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");
    const p = (await api('POST', '/productos', {
      categoria_id: cat.id, unidad_medida_id: kg.id, nombre: `TMPSM NEGRO ${SUF}`, precio_kg: 100, multipresentacion: true,
    })).data;
    const v = (await api('GET', `/productos/${p.id}`)).data.variantes[0];
    const cod = [1, 2, 3, 4, 5].map((i) => `TMPSM-${SUF}-${i}`);
    for (const c of cod) {
      await api('POST', `/variantes/${v.id}/codigos`, { codigo: c, peso_kg: 19, almacen_id: origen.id });
    }
    ck(`5 paquetes de 19 kg en ${origen.nombre}`, (await estados(cod))[cod[4]]?.almacen_id === origen.id);

    let r = await api('POST', '/inventario/traspasos', {
      almacen_origen_id: origen.id, almacen_destino_id: destino.id, notas: 'TMPSM', items: [{ variante_id: v.id, paquetes: 3 }],
    });
    const tra = r.data;
    traspasos.push(tra?.id);
    ck(`se pide un traspaso de 3 paquetes a ${destino.nombre}`, r.status === 201 && tra?.estado === 'solicitado', r.error);

    console.log('\n=== 1. Se escanean 2 y se guarda: quedan apartados ===');
    r = await api('PUT', `/inventario/traspasos/${tra.id}/escaneos`, { codigos: [cod[0], cod[1]] });
    ck('se guardan 2 (38 kg)', r.status === 200 && r.data?.guardados === 2 && r.data?.kg === 38, r.error ?? r.data);
    let e = await estados(cod);
    ck('quedan APARTADOS para el envío', e[cod[0]].estado === 'apartado' && e[cod[0]].consumido_tipo === 'traspaso' && e[cod[1]].estado === 'apartado');
    r = await api('GET', `/inventario/traspasos/${tra.id}`);
    ck('el traspaso sigue por enviar, con lo guardado a la vista', r.data?.estado === 'solicitado' &&
      r.data?.lineas?.[0]?.guardados?.map((g) => g.codigo).join() === `${cod[0]},${cod[1]}`, r.data?.lineas?.[0]?.guardados);
    r = await api('GET', `/variantes/resolver/${cod[0]}`);
    ck('la caja lo ve apartado para ese envío (y no lo vende)', r.data?.bulto?.estado === 'apartado' && r.data?.bulto?.consumido_folio === tra.folio,
      r.data?.bulto && [r.data.bulto.estado, r.data.bulto.consumido_folio]);
    r = await api('GET', `/inventario/desarmes/previa/${cod[0]}`);
    ck('no se baja a conos (409)', r.status === 409 && r.error?.code === 'BULTO_NO_DISPONIBLE', r.error?.code);
    r = await api('POST', '/inventario/traspasos', {
      almacen_origen_id: origen.id, almacen_destino_id: destino.id, notas: 'TMPSM otro', items: [{ variante_id: v.id, paquetes: 1 }],
    });
    const otro = r.data;
    traspasos.push(otro?.id);
    r = await api('PUT', `/inventario/traspasos/${otro.id}/escaneos`, { codigos: [cod[0]] });
    ck('otro envío no lo toma: 409 que dice para cuál está', r.status === 409 && r.error?.code === 'BULTO_NO_DISPONIBLE' &&
      r.error.message.includes(tra.folio), r.error);

    console.log('\n=== 2. Se cambia lo guardado: lo que ya no viene queda libre ===');
    r = await api('PUT', `/inventario/traspasos/${tra.id}/escaneos`, { codigos: [cod[1], cod[2]] });
    e = await estados(cod);
    ck('el 1 queda libre y el 3 se aparta', r.status === 200 && e[cod[0]].estado === 'disponible' && e[cod[0]].consumido_tipo === null &&
      e[cod[2]].estado === 'apartado', [e[cod[0]].estado, e[cod[2]].estado]);

    console.log('\n=== 3. Se termina de escanear y se envía ===');
    r = await api('POST', `/inventario/traspasos/${tra.id}/enviar`, { codigos: [cod[1], cod[2], cod[3]] });
    ck('sale con lo guardado y lo nuevo: 3 paquetes, 57 kg', r.status === 200 && r.data?.estado === 'en_transito' &&
      r.data?.lineas?.[0]?.paquetes === 3 && Number(r.data?.lineas?.[0]?.cantidad) === 57, r.error ?? r.data?.lineas);
    e = await estados(cod);
    ck(`esos 3 quedan disponibles y apuntan a ${destino.nombre}`, [1, 2, 3].every((i) => e[cod[i]].estado === 'disponible' &&
      e[cod[i]].consumido_tipo === null && e[cod[i]].almacen_id === destino.id), [1, 2, 3].map((i) => e[cod[i]]));
    const [[{ n }]] = await db.query(
      'SELECT COUNT(*) AS n FROM traspaso_bultos tb JOIN traspaso_detalle d ON d.id = tb.detalle_id WHERE d.traspaso_id = ?', [tra.id]
    );
    ck('y quedan anotados los 3 que viajaron (sin repetirse)', Number(n) === 3, n);
    r = await api('PUT', `/inventario/traspasos/${tra.id}/escaneos`, { codigos: [cod[4]] });
    ck('ya enviado, no se guarda nada (409)', r.status === 409 && r.error?.code === 'ESTADO_INVALIDO', r.error?.code);

    console.log('\n=== 4. Cancelar una solicitud con paquetes guardados los suelta ===');
    r = await api('PUT', `/inventario/traspasos/${otro.id}/escaneos`, { codigos: [cod[4]] });
    ck('el otro envío guarda el 5', r.status === 200 && (await estados([cod[4]]))[cod[4]].estado === 'apartado', r.error);
    r = await api('POST', `/inventario/traspasos/${otro.id}/cancelar`, { motivo: 'TMPSM' });
    e = await estados(cod);
    ck('se cancela y el 5 queda libre otra vez', r.status === 200 && e[cod[4]].estado === 'disponible' && e[cod[4]].consumido_tipo === null,
      r.error ?? e[cod[4]]);
    const [[{ n2 }]] = await db.query(
      'SELECT COUNT(*) AS n2 FROM traspaso_bultos tb JOIN traspaso_detalle d ON d.id = tb.detalle_id WHERE d.traspaso_id = ?', [otro.id]
    );
    ck('y no le quedan paquetes anotados', Number(n2) === 0, n2);
  } catch (err) {
    console.error(err);
    f++;
  } finally {
    const ids = traspasos.filter(Boolean);
    if (ids.length) {
      await db.query("DELETE FROM movimientos_inventario WHERE referencia_tipo = 'traspaso' AND referencia_id IN (?)", [ids]);
      await db.query('DELETE FROM traspasos WHERE id IN (?)', [ids]);
    }
    const [prods] = await db.query('SELECT id FROM productos WHERE nombre LIKE ?', [`TMPSM %${SUF}`]);
    const pr = prods.map((x) => x.id);
    const [vs] = pr.length ? await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [pr]) : [[]];
    const vids = vs.map((x) => x.id);
    if (vids.length) {
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) {
        await db.query(`DELETE FROM ${tb} WHERE variante_id IN (?)`, [vids]);
      }
      await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
    }
    if (pr.length) await db.query('DELETE FROM productos WHERE id IN (?)', [pr]);
    const [[{ q }]] = await db.query("SELECT COUNT(*) AS q FROM traspasos WHERE notas LIKE 'TMPSM%'");
    ck('no quedó basura (TMPSM)', Number(q) === 0, q);
    await db.end();
  }
  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
