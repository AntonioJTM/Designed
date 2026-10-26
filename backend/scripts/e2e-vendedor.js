'use strict';

/**
 * Prueba del VENDEDOR DE LA NOTA (2026-10-23, usuario: "Nota de venta: añadir
 * vendedor"). En la caja se elige quién atendió al cliente, aparte de quién cobra:
 *
 *   · la lista es el personal ACTIVO de esa tienda (su «Trabaja en», «Todas las
 *     tiendas» o administrador), y solo la pide quien ve esa tienda;
 *   · una venta con un vendedor de otra tienda o dado de baja no se registra
 *     (422 VENDEDOR_INVALIDO) y no mueve nada;
 *   · la venta guarda quién la registró («Elaboró», `usuario_id`) y quién la vendió
 *     (`vendedor_id`); sin elegir, la vendió quien la registra;
 *   · la COMISIÓN es del vendedor, no de quien cobró.
 *
 * Crea "TMPVD …" (personal, hilo, caja y turno) y lo borra al final.
 *
 *   cd backend
 *   DB_NAME=desarrollo PORT=3210 node src/server.js &
 *   DB_NAME=desarrollo E2E_ACEPTO_PRODUCCION=si node scripts/e2e-vendedor.js
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
const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

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
    `SELECT u.id, u.nombre, u.rol_id FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = 'administrador' AND u.activo = 1 ORDER BY u.id LIMIT 1`
  );
  const [[gerente]] = await db.query("SELECT id FROM roles WHERE nombre = 'gerente' LIMIT 1");
  const firmar = (u) => jwt.sign({ sub: u.id, tipo: 'usuario', rol_id: u.rol_id, rol: u.rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const pedir = async (token, me, r, b) => {
    const x = await fetch(B + r, {
      method: me,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };
  const api = (me, r, b) => pedir(firmar({ ...admin, rol: 'administrador' }), me, r, b);
  const inv = async (v, a) => {
    const [[x]] = await db.query('SELECT cantidad FROM inventario WHERE variante_id = ? AND almacen_id = ?', [v, a]);
    return r3(x?.cantidad ?? 0);
  };
  const enBase = async (id) => {
    const [[x]] = await db.query('SELECT usuario_id, vendedor_id FROM pedidos WHERE id = ?', [id]);
    return x ? { usuario_id: Number(x.usuario_id), vendedor_id: x.vendedor_id == null ? null : Number(x.vendedor_id) } : null;
  };
  const alta = async (nombre, tiendas) => {
    const r = await api('POST', '/usuarios', {
      nombre, correo: `tmpvd.${nombre.split(' ')[1].toLowerCase()}.${SUF.toLowerCase()}@prueba.local`,
      contrasena: 'clave-de-prueba-1', rol_id: gerente.id, todas_las_tiendas: false, tiendas,
    });
    return r.data ? { id: Number(r.data.id), nombre, rol_id: gerente.id, rol: 'gerente' } : null;
  };

  try {
    const [tiendas] = await db.query(
      'SELECT id, nombre FROM almacenes WHERE activo = 1 AND es_punto_venta = 1 ORDER BY id LIMIT 2'
    );
    if (tiendas.length < 2) throw new Error('Hacen falta dos tiendas activas para la prueba');
    const [mia, otra] = tiendas;
    console.log(`Tienda de la prueba: ${mia.nombre} (${mia.id}) · otra: ${otra.nombre} (${otra.id})`);

    const rosa = await alta(`TMPVD Rosa ${SUF}`, [mia.id]);
    const deOtra = await alta(`TMPVD Lejana ${SUF}`, [otra.id]);
    const baja = await alta(`TMPVD Baja ${SUF}`, [mia.id]);
    await api('PUT', `/usuarios/${baja?.id}`, { activo: false });
    ck('personal de prueba: una de esta tienda, una de la otra y una dada de baja',
      !!rosa && !!deOtra && !!baja, [rosa?.id, deOtra?.id, baja?.id]);

    const [[cat]] = await db.query('SELECT id FROM categorias ORDER BY id LIMIT 1');
    const [[kg]] = await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");
    const [[efectivo]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Efectivo%' ORDER BY id LIMIT 1");
    let r = await api('POST', '/productos', {
      categoria_id: cat.id, unidad_medida_id: kg.id, nombre: 'TMPVD ROJO ' + SUF, precio_kg: 100, multipresentacion: true,
    });
    const paquete = (await api('GET', `/productos/${r.data.id}`)).data.variantes[0];
    const cj = (await api('POST', '/caja/cajas', { almacen_id: mia.id, nombre: 'TMPVD Caja ' + SUF })).data;
    const sesion = (await api('POST', '/caja/sesiones', { caja_id: cj.id, monto_inicial: 0 })).data;
    await api('POST', '/inventario/movimientos', { variante_id: paquete.id, almacen_id: mia.id, tipo: 'entrada', cantidad: 40, motivo: 'TMPVD' });
    ck('hilo a $100/kg con 40 kg, caja y turno en esa tienda', !!sesion?.id && (await inv(paquete.id, mia.id)) === 40);

    console.log('\n=== 1. Quién puede ser el vendedor ===');
    r = await api('GET', `/pedidos/vendedores?almacen_id=${mia.id}`);
    const ids = (r.data ?? []).map((v) => v.id);
    ck('la lista trae a quien trabaja ahí', r.status === 200 && ids.includes(rosa.id), r.error ?? ids.length);
    ck('y al administrador (las ve todas)', ids.includes(Number(admin.id)));
    ck('no trae a quien es de otra tienda', !ids.includes(deOtra.id));
    ck('ni a quien se dio de baja', !ids.includes(baja.id));
    ck('cada uno con su nombre y su puesto', r.data?.find((v) => v.id === rosa.id)?.puesto === 'gerente', r.data?.find((v) => v.id === rosa.id));
    r = await api('GET', '/pedidos/vendedores');
    ck('sin decir la tienda: 422 FALTA_ALMACEN', r.status === 422 && r.error?.code === 'FALTA_ALMACEN', r.error?.code);
    r = await pedir(firmar(deOtra), 'GET', `/pedidos/vendedores?almacen_id=${mia.id}`);
    ck('quien es de otra tienda no ve este personal: 404 OTRA_TIENDA', r.status === 404 && r.error?.code === 'OTRA_TIENDA', [r.status, r.error?.code]);

    console.log('\n=== 2. Lo que no se deja ===');
    const venta = (extra) => api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id,
      items: [{ variante_id: paquete.id, cantidad: 2 }],
      pagos: [{ metodo_pago_id: efectivo.id, monto: 200 }],
      ...extra,
    });
    r = await venta({ vendedor_id: deOtra.id });
    ck('vendedor de otra tienda: 422 VENDEDOR_INVALIDO', r.status === 422 && r.error?.code === 'VENDEDOR_INVALIDO', r.error?.code);
    r = await venta({ vendedor_id: baja.id });
    ck('vendedor dado de baja: 422 VENDEDOR_INVALIDO', r.status === 422 && r.error?.code === 'VENDEDOR_INVALIDO', r.error?.code);
    ck('y no se movió nada (40 kg)', (await inv(paquete.id, mia.id)) === 40, await inv(paquete.id, mia.id));
    r = await api('POST', '/pedidos/cotizacion', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, vendedor_id: rosa.id, items: [{ variante_id: paquete.id, cantidad: 2 }],
    });
    ck('la cotización no lleva vendedor (422)', r.status === 422, r.status);

    console.log('\n=== 3. Cobra el administrador, vendió Rosa ===');
    r = await venta({ vendedor_id: rosa.id });
    const v1 = r.data;
    ck('se registra', r.status === 201 && !!v1?.id, r.error);
    ck('en la base: la elaboró el administrador y la vendió Rosa',
      JSON.stringify(await enBase(v1.id)) === JSON.stringify({ usuario_id: Number(admin.id), vendedor_id: rosa.id }), await enBase(v1.id));
    ck('la respuesta dice quién la vendió y quién la elaboró',
      v1?.vendedor === rosa.nombre && v1?.usuario === admin.nombre && Number(v1?.vendedor_id) === rosa.id, [v1?.vendedor, v1?.usuario]);
    r = await api('GET', `/pedidos/${v1.id}`);
    ck('el detalle también', r.data?.vendedor === rosa.nombre && r.data?.usuario === admin.nombre, [r.data?.vendedor, r.data?.usuario]);
    r = await api('GET', `/pedidos?q=${encodeURIComponent(v1.numero_pedido)}`);
    const enLista = (r.data?.data ?? r.data?.items ?? r.data ?? []).find?.((p) => p.id === v1.id);
    ck('y la lista de Ventas', enLista?.vendedor === rosa.nombre && enLista?.usuario === admin.nombre, enLista && [enLista.vendedor, enLista.usuario]);

    console.log('\n=== 4. Sin elegir, la vendió quien cobra ===');
    r = await venta({});
    const v2 = r.data;
    ck('se registra a nombre de quien cobra',
      r.status === 201 && JSON.stringify(await enBase(v2.id)) === JSON.stringify({ usuario_id: Number(admin.id), vendedor_id: Number(admin.id) }),
      await enBase(v2.id));
    ck('el detalle dice que la vendió quien la elaboró', v2?.vendedor === admin.nombre, v2?.vendedor);
    r = await venta({ vendedor_id: Number(admin.id) });
    ck('elegirse a sí mismo también pasa', r.status === 201 && (await enBase(r.data.id))?.vendedor_id === Number(admin.id), r.error);

    console.log('\n=== 5. Nota en espera y nota pendiente de pago llevan su vendedor ===');
    const [[cli]] = await db.query("SELECT id FROM clientes WHERE activo = 1 ORDER BY id LIMIT 1");
    r = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: cli.id, encargo: true, metodo_entrega: 'recoger',
      vendedor_id: rosa.id, items: [{ variante_id: paquete.id, cantidad: 1 }],
    });
    ck('nota en espera vendida por Rosa', r.status === 201 && (await enBase(r.data.id))?.vendedor_id === rosa.id, r.error);
    r = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: cli.id, pendiente_pago: true,
      vendedor_id: rosa.id, items: [{ variante_id: paquete.id, cantidad: 1 }],
    });
    ck('nota pendiente de pago vendida por Rosa', r.status === 201 && (await enBase(r.data.id))?.vendedor_id === rosa.id, r.error);

    console.log('\n=== 6. La comisión es de quien vendió ===');
    const comisiones = require('../src/modules/nomina/comisiones');
    const { pool } = require('../src/config/db');
    const manana = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) + ' 00:00:00';
    const deRosa = await comisiones.ventasSinPagarComision(pool, { usuarioIds: [rosa.id], hasta: manana });
    const delAdmin = await comisiones.ventasSinPagarComision(pool, { usuarioIds: [Number(admin.id)], hasta: manana });
    ck('la venta que vendió Rosa cuenta para Rosa',
      deRosa.some((v) => v.pedido_id === v1.id && v.usuario_id === rosa.id), deRosa.map((v) => v.pedido_id));
    ck('y no para quien la cobró', !delAdmin.some((v) => v.pedido_id === v1.id));
    ck('la que vendió quien cobra, para quien cobra', delAdmin.some((v) => v.pedido_id === v2.id));
    await pool.end();
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    console.log('\nLimpiando…');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    const [prods] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPVD %'");
    const pr = prods.map((x) => x.id);
    const [vs] = pr.length ? await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [pr]) : [[]];
    const vids = vs.map((v) => v.id);
    const [peds] = vids.length
      ? await db.query('SELECT DISTINCT pedido_id FROM pedido_detalle WHERE variante_id IN (?)', [vids])
      : [[]];
    const pids = peds.map((x) => x.pedido_id);
    if (pids.length) {
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
    const [cjs] = await db.query("SELECT id FROM cajas WHERE nombre LIKE 'TMPVD Caja%'");
    if (cjs.length) {
      const [ses] = await db.query('SELECT id FROM sesiones_caja WHERE caja_id IN (?)', [cjs.map((x) => x.id)]);
      await borrarTurnosPropios(db, ses.map((x) => x.id));
      await borrarCajasSinTurnos(db, cjs.map((x) => x.id));
    }
    const [us] = await db.query("SELECT id FROM usuarios WHERE nombre LIKE 'TMPVD %'");
    const uids = us.map((x) => x.id);
    if (uids.length) {
      for (const tb of ['usuario_almacenes', 'usuario_roles']) await db.query(`DELETE FROM ${tb} WHERE usuario_id IN (?)`, [uids]);
      await db.query('DELETE FROM usuarios WHERE id IN (?)', [uids]);
    }
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    const [[{ n }]] = await db.query(
      "SELECT (SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPVD %') + (SELECT COUNT(*) FROM usuarios WHERE nombre LIKE 'TMPVD %') + (SELECT COUNT(*) FROM cajas WHERE nombre LIKE 'TMPVD Caja%') AS n"
    );
    ck('no quedó basura (TMPVD)', Number(n) === 0, n);
    await db.end();
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
