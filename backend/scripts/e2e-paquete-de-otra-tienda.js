'use strict';

/**
 * Prueba de "EN LA CAJA SOLO SE VENDEN LOS PAQUETES DE ESA TIENDA" (2026-10-07:
 * "si está en Tienda Principal solo se venden los paquetes que están ahí; no
 * tiene por qué tomar los de almacén. Que diga que sí existe pero está en
 * almacén, que tome uno que sí esté registrado con la tienda").
 *
 *   · vender, apartar o tomar un pedido con un paquete que el sistema tiene en
 *     la bodega: 409 PAQUETE_EN_OTRA_SUCURSAL, dice dónde está, y no se mueve
 *     nada (ni kilos ni el paquete);
 *   · modificar un pedido escaneando ese paquete: lo mismo;
 *   · uno que viene EN CAMINO a la tienda: 409 PAQUETE_EN_CAMINO; ya recibido,
 *     se vende;
 *   · el de la tienda se vende; el capturado a mano sin almacén, también;
 *   · el lector dice dónde está cada paquete.
 *   · AL SURTIR (el usuario eligió "avisar y, si confirman que sí está aquí,
 *     pasarlo con sus kilos"): escanear uno que el sistema tiene en otro
 *     almacén sin confirmar es 409 PAQUETE_EN_OTRO_ALMACEN y no se mueve nada;
 *     confirmado (al guardar a medias o al enviar), el paquete y sus kilos
 *     pasan al almacén que surte (kardex "Paquete encontrado en otro
 *     almacén") y sale; si aquel almacén no tiene esos kilos, 409.
 *
 * Crea "TMPOT …" (hilo, cliente, caja y turno) y lo borra al final.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-paquete-de-otra-tienda.js   # contra la base de pruebas
 *
 * Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');
const { borrarTurnosPropios, borrarCajasSinTurnos } = require('./_propios');

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
  /** "almacén:kilos" de cada renglón de inventario de la presentación. */
  const inventario = async (v) => {
    const [rows] = await db.query('SELECT almacen_id, cantidad FROM inventario WHERE variante_id = ? ORDER BY almacen_id', [v]);
    return rows.map((x) => `${x.almacen_id}:${Number(x.cantidad)}`).join(',');
  };
  const paquete = async (c) => {
    const [[x]] = await db.query('SELECT estado, almacen_id FROM variante_codigos WHERE codigo = ?', [c]);
    return x ? `${x.estado}@${x.almacen_id}` : null;
  };
  /** Lo mismo que `inventario`, armado de {almacén: kilos} (en orden de almacén). */
  const saldos = (o) => Object.entries(o).sort((x, y) => x[0] - y[0]).map(([a, k]) => `${a}:${k}`).join(',');
  const traspasos = [];

  try {
    const [[bodega]] = await db.query('SELECT id, nombre FROM almacenes WHERE activo = 1 AND es_punto_venta = 0 ORDER BY id LIMIT 1');
    const [[tienda]] = await db.query('SELECT id, nombre FROM almacenes WHERE activo = 1 AND es_punto_venta = 1 ORDER BY id LIMIT 1');
    const [[cat]] = await db.query('SELECT id FROM categorias ORDER BY id LIMIT 1');
    const [[kg]] = await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");
    const [[efectivo]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Efectivo%' ORDER BY id LIMIT 1");

    const p = (await api('POST', '/productos', {
      categoria_id: cat.id, unidad_medida_id: kg.id, nombre: `TMPOT PERLA ${SUF}`, precio_kg: 100, multipresentacion: true,
    })).data;
    const v = (await api('GET', `/productos/${p.id}`)).data.variantes[0];
    const cod = [1, 2, 3, 4].map((i) => `TMPOT-${SUF}-${i}`);
    // 1 y 3 en la bodega; 2 y 4 en la tienda (el 4 luego queda sin almacén).
    await api('POST', `/variantes/${v.id}/codigos`, { codigo: cod[0], peso_kg: 19.95, almacen_id: bodega.id });
    await api('POST', `/variantes/${v.id}/codigos`, { codigo: cod[1], peso_kg: 19.5, almacen_id: tienda.id });
    await api('POST', `/variantes/${v.id}/codigos`, { codigo: cod[2], peso_kg: 20, almacen_id: bodega.id });
    await api('POST', `/variantes/${v.id}/codigos`, { codigo: cod[3], peso_kg: 18.6, almacen_id: tienda.id });
    const cj = (await api('POST', '/caja/cajas', { almacen_id: tienda.id, nombre: 'TMPOT Caja ' + SUF })).data;
    const sesion = (await api('POST', '/caja/sesiones', { caja_id: cj.id, monto_inicial: 0 })).data;
    const cli = (await api('POST', '/clientes', { nombre: 'TMPOT Cliente ' + SUF })).data;
    const antes = saldos({ [bodega.id]: 39.95, [tienda.id]: 38.1 });
    ck(`2 paquetes en ${bodega.nombre} (39.95 kg) y 2 en ${tienda.nombre} (38.1 kg), caja y turno en la tienda`,
      (await inventario(v.id)) === antes && !!sesion?.id && !!cli?.id, await inventario(v.id));

    const venta = (c, peso, extra = {}) => api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, pagos: [{ metodo_pago_id: efectivo.id, monto: 5000 }],
      items: [{ variante_id: v.id, cantidad: peso, bultos: [{ codigo: c, peso_kg: peso }] }], ...extra,
    });

    console.log(`\n=== 1. En la caja de ${tienda.nombre}, un paquete que está en ${bodega.nombre} ===`);
    let r = await api('GET', `/variantes/resolver/${cod[0]}`);
    ck('el lector dice dónde está', Number(r.data?.bulto?.almacen_id) === bodega.id && r.data?.bulto?.almacen === bodega.nombre, r.data?.bulto);
    r = await venta(cod[0], 19.95);
    ck('venderlo: 409 PAQUETE_EN_OTRA_SUCURSAL', r.status === 409 && r.error?.code === 'PAQUETE_EN_OTRA_SUCURSAL', r.error?.code);
    ck('el mensaje dice que sí existe, dónde está y que tome uno de la tienda',
      r.error?.message === `El paquete ${cod[0]} sí existe, pero está en «${bodega.nombre}», no en «${tienda.nombre}»: toma uno que esté en esta tienda.`,
      r.error?.message);
    ck('…y no se movió nada: ni kilos, ni el paquete, ni dinero',
      (await inventario(v.id)) === antes && (await paquete(cod[0])) === `disponible@${bodega.id}` &&
      Number((await db.query('SELECT COUNT(*) AS n FROM movimientos_caja WHERE sesion_caja_id = ?', [sesion.id]))[0][0].n) === 0,
      [await inventario(v.id), await paquete(cod[0])]);
    r = await venta(cod[0], 19.95, { apartado: true, cliente_id: cli.id, pagos: [] });
    ck('apartarlo: tampoco (409)', r.status === 409 && r.error?.code === 'PAQUETE_EN_OTRA_SUCURSAL', r.error?.code);
    r = await venta(cod[0], 19.95, { encargo: true, cliente_id: cli.id, pagos: [] });
    ck('tomar un pedido con él: tampoco (409)', r.status === 409 && r.error?.code === 'PAQUETE_EN_OTRA_SUCURSAL', r.error?.code);

    console.log('\n=== 2. Modificar un pedido escaneando ese paquete ===');
    r = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, encargo: true, cliente_id: cli.id, items: [{ variante_id: v.id, cantidad: 19 }],
    });
    const ped = r.data;
    ck('se toma un pedido de ≈ 19 kg (sin paquetes)', r.status === 201 && ped?.estado === 'en_preparacion', r.error);
    r = await api('PUT', `/pedidos/${ped.id}/encargo`, { lineas: [{ detalle_id: ped.detalle[0].id, codigos: [cod[0]] }] });
    ck('escanear el de la bodega: 409 PAQUETE_EN_OTRA_SUCURSAL', r.status === 409 && r.error?.code === 'PAQUETE_EN_OTRA_SUCURSAL', r.error?.code);
    ck('…y el paquete sigue libre en la bodega', (await paquete(cod[0])) === `disponible@${bodega.id}`, await paquete(cod[0]));
    r = await api('PUT', `/pedidos/${ped.id}/encargo`, { lineas: [{ detalle_id: ped.detalle[0].id, codigos: [cod[1]] }] });
    ck('el de la tienda sí: queda apartado para el pedido', r.status === 200 && (await paquete(cod[1])) === `apartado@${tienda.id}`, r.error ?? await paquete(cod[1]));
    await api('PATCH', `/pedidos/${ped.id}/estado`, { estado: 'cancelado' });
    ck('(se cancela el pedido y el paquete queda libre otra vez)', (await paquete(cod[1])) === `disponible@${tienda.id}`, await paquete(cod[1]));

    console.log('\n=== 3. Uno que viene EN CAMINO a la tienda ===');
    r = await api('POST', '/inventario/traspasos', {
      almacen_origen_id: bodega.id, almacen_destino_id: tienda.id, notas: 'TMPOT', items: [{ variante_id: v.id, paquetes: 1 }],
    });
    traspasos.push(r.data?.id);
    const tra = r.data;
    r = await api('POST', `/inventario/traspasos/${tra.id}/enviar`, { codigos: [cod[2]] });
    ck('se manda el paquete 3 de la bodega a la tienda', r.status === 200, r.error);
    r = await api('GET', `/variantes/resolver/${cod[2]}`);
    ck('el lector dice que viene en camino', r.data?.bulto?.en_camino_folio === tra.folio, r.data?.bulto);
    r = await venta(cod[2], 20);
    ck('venderlo antes de recibirlo: 409 PAQUETE_EN_CAMINO', r.status === 409 && r.error?.code === 'PAQUETE_EN_CAMINO' &&
      r.error.message.includes(tra.folio), r.error);
    r = await api('POST', `/inventario/traspasos/${tra.id}/recibir`, {});
    ck('se recibe en la tienda', r.status === 200, r.error);
    r = await venta(cod[2], 20);
    ck('ya recibido, se vende', r.status === 201 && (await paquete(cod[2])) === `vendido@${tienda.id}`, r.error ?? await paquete(cod[2]));

    console.log('\n=== 4. Lo que sí se vende ===');
    r = await venta(cod[1], 19.5);
    ck('el de la tienda: se vende y sale de la tienda', r.status === 201 && (await paquete(cod[1])) === `vendido@${tienda.id}`, r.error);
    await db.query('UPDATE variante_codigos SET almacen_id = NULL WHERE codigo = ?', [cod[3]]);
    r = await venta(cod[3], 18.6);
    ck('el capturado a mano sin almacén: se vende y queda apuntado en la tienda', r.status === 201 &&
      (await paquete(cod[3])) === `vendido@${tienda.id}`, r.error ?? await paquete(cod[3]));
    ck(`al final: ${bodega.nombre} con su paquete 1 (19.95 kg), la tienda en 0`,
      (await inventario(v.id)) === saldos({ [bodega.id]: 19.95, [tienda.id]: 0 }) && (await paquete(cod[0])) === `disponible@${bodega.id}`,
      await inventario(v.id));

    console.log(`\n=== 5. Al SURTIR desde ${bodega.nombre}, paquetes que el sistema tiene en ${tienda.nombre} ===`);
    const cod5 = `TMPOT-${SUF}-5`;
    const cod6 = `TMPOT-${SUF}-6`;
    await api('POST', `/variantes/${v.id}/codigos`, { codigo: cod5, peso_kg: 18, almacen_id: tienda.id });
    await api('POST', `/variantes/${v.id}/codigos`, { codigo: cod6, peso_kg: 17.5, almacen_id: tienda.id });
    ck(`dos paquetes más en ${tienda.nombre} (35.5 kg)`, (await inventario(v.id)) === saldos({ [bodega.id]: 19.95, [tienda.id]: 35.5 }),
      await inventario(v.id));
    r = await api('POST', '/inventario/traspasos', {
      almacen_origen_id: bodega.id, almacen_destino_id: tienda.id, notas: 'TMPOT', items: [{ variante_id: v.id, paquetes: 1 }],
    });
    traspasos.push(r.data?.id);
    const tra2 = r.data;
    r = await api('PUT', `/inventario/traspasos/${tra2.id}/escaneos`, { codigos: [cod5] });
    ck('guardar a medias uno de la tienda sin confirmar: 409 PAQUETE_EN_OTRO_ALMACEN', r.status === 409 &&
      r.error?.code === 'PAQUETE_EN_OTRO_ALMACEN' && r.error.message.includes(tienda.nombre), r.error);
    ck('…y no se movió nada', (await inventario(v.id)) === saldos({ [bodega.id]: 19.95, [tienda.id]: 35.5 }) &&
      (await paquete(cod5)) === `disponible@${tienda.id}`, [await inventario(v.id), await paquete(cod5)]);
    r = await api('PUT', `/inventario/traspasos/${tra2.id}/escaneos`, { codigos: [cod5], encontrados: [cod5] });
    ck('confirmado: se guarda, y el paquete pasa a la bodega con sus 18 kg', r.status === 200 &&
      (await paquete(cod5)) === `apartado@${bodega.id}` &&
      (await inventario(v.id)) === saldos({ [bodega.id]: 37.95, [tienda.id]: 17.5 }), r.error ?? [await paquete(cod5), await inventario(v.id)]);
    r = await api('POST', `/inventario/traspasos/${tra2.id}/enviar`, { codigos: [cod5, cod6] });
    ck('enviar con otro de la tienda sin confirmar: 409, dice cuál', r.status === 409 &&
      r.error?.code === 'PAQUETE_EN_OTRO_ALMACEN' && r.error.message.includes(cod6), r.error);
    r = await api('POST', `/inventario/traspasos/${tra2.id}/enviar`, { codigos: [cod5, cod6], encontrados: [cod6] });
    ck('confirmado: salen los dos (35.5 kg) y van en camino', r.status === 200 && Number(r.data?.lineas?.[0]?.cantidad) === 35.5, r.error ?? r.data);
    ck('la bodega queda con lo suyo (19.95) y la tienda espera el envío (0)',
      (await inventario(v.id)) === saldos({ [bodega.id]: 19.95, [tienda.id]: 0 }), await inventario(v.id));
    r = await api('GET', `/inventario/movimientos?variante_id=${v.id}&limit=50`);
    const encontrados = (r.data?.items ?? []).filter((x) => x.concepto === 'Paquete encontrado en otro almacén');
    ck('el kardex dice "Paquete encontrado en otro almacén" (salida allá y entrada aquí, de cada uno)',
      encontrados.length === 4 && encontrados.some((x) => x.codigo_bulto === cod6 && Number(x.cantidad) === -17.5 && x.almacen_id === tienda.id) &&
      encontrados.some((x) => x.codigo_bulto === cod6 && Number(x.cantidad) === 17.5 && x.almacen_id === bodega.id),
      encontrados.map((x) => [x.codigo_bulto, x.almacen_id, x.cantidad]));
    await api('POST', `/inventario/traspasos/${tra2.id}/recibir`, {});
    ck('al recibir, los dos paquetes y sus kilos quedan en la tienda: todo cuadra',
      (await inventario(v.id)) === saldos({ [bodega.id]: 19.95, [tienda.id]: 35.5 }) &&
      (await paquete(cod5)) === `disponible@${tienda.id}` && (await paquete(cod6)) === `disponible@${tienda.id}`,
      [await inventario(v.id), await paquete(cod5), await paquete(cod6)]);

    const [[otro]] = await db.query('SELECT id, nombre FROM almacenes WHERE activo = 1 AND id NOT IN (?, ?) ORDER BY id LIMIT 1', [bodega.id, tienda.id]);
    if (otro) {
      const cod7 = `TMPOT-${SUF}-7`;
      await api('POST', `/variantes/${v.id}/codigos`, { codigo: cod7, peso_kg: 10, almacen_id: tienda.id });
      // El sistema lo tiene en un almacén que no tiene kilos de este hilo.
      await db.query('UPDATE variante_codigos SET almacen_id = ? WHERE codigo = ?', [otro.id, cod7]);
      r = await api('POST', '/inventario/traspasos', {
        almacen_origen_id: bodega.id, almacen_destino_id: tienda.id, notas: 'TMPOT', items: [{ variante_id: v.id, paquetes: 1 }],
      });
      traspasos.push(r.data?.id);
      r = await api('POST', `/inventario/traspasos/${r.data.id}/enviar`, { codigos: [cod7], encontrados: [cod7] });
      ck(`si «${otro.nombre}» no tiene esos kilos, no se inventan: 409 STOCK_INSUFICIENTE`, r.status === 409 &&
        r.error?.code === 'STOCK_INSUFICIENTE' && r.error.message.includes(otro.nombre), r.error);
      ck('…y el paquete sigue donde estaba', (await paquete(cod7)) === `disponible@${otro.id}`, await paquete(cod7));
    }
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    console.log('\nLimpiando…');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    const ids = traspasos.filter(Boolean);
    if (ids.length) {
      await db.query('DELETE tb FROM traspaso_bultos tb JOIN traspaso_detalle d ON d.id = tb.detalle_id WHERE d.traspaso_id IN (?)', [ids]);
      await db.query('DELETE FROM traspaso_detalle WHERE traspaso_id IN (?)', [ids]);
      await db.query('DELETE FROM traspasos WHERE id IN (?)', [ids]);
    }
    const [prods] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPOT %'");
    const pr = prods.map((x) => x.id);
    const [vs] = pr.length ? await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [pr]) : [[]];
    const vids = vs.map((x) => x.id);
    const [peds] = vids.length ? await db.query('SELECT DISTINCT pedido_id FROM pedido_detalle WHERE variante_id IN (?)', [vids]) : [[]];
    const pids = peds.map((x) => x.pedido_id);
    if (pids.length) {
      await db.query('DELETE b FROM pedido_detalle_bultos b JOIN pedido_detalle d ON d.id = b.detalle_id WHERE d.pedido_id IN (?)', [pids]);
      for (const tb of ['pagos', 'pedido_detalle', 'credito_movimientos']) await db.query(`DELETE FROM ${tb} WHERE pedido_id IN (?)`, [pids]);
      await db.query('DELETE FROM pedidos WHERE id IN (?)', [pids]);
    }
    if (vids.length) {
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) {
        await db.query(`DELETE FROM ${tb} WHERE variante_id IN (?)`, [vids]);
      }
      await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
    }
    if (pr.length) await db.query('DELETE FROM productos WHERE id IN (?)', [pr]);
    await db.query("DELETE FROM clientes WHERE nombre LIKE 'TMPOT %'");
    const [cjs] = await db.query("SELECT id FROM cajas WHERE nombre LIKE 'TMPOT Caja%'");
    if (cjs.length) {
      const [ses] = await db.query('SELECT id FROM sesiones_caja WHERE caja_id IN (?)', [cjs.map((x) => x.id)]);
      await borrarTurnosPropios(db, ses.map((x) => x.id));
      await borrarCajasSinTurnos(db, cjs.map((x) => x.id));
    }
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    const [[{ n }]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPOT %') + (SELECT COUNT(*) FROM clientes WHERE nombre LIKE 'TMPOT %')
            + (SELECT COUNT(*) FROM cajas WHERE nombre LIKE 'TMPOT Caja%') + (SELECT COUNT(*) FROM traspasos WHERE notas LIKE 'TMPOT%') AS n`
    );
    ck('no quedó basura (TMPOT)', Number(n) === 0, n);
    await db.end();
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
