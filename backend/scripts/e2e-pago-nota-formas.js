'use strict';

/**
 * Prueba de PAGAR UNA NOTA PENDIENTE CON HASTA DOS FORMAS (2026-10-26, usuario:
 * "cuando se registra pago, que tenga múltiples formas de pago: crédito, efectivo
 * y transferencia o aplicación de saldo a favor"). `POST /pedidos/:id/pago-nota`:
 *
 *   · efectivo y transferencia: dos pagos, el efectivo al turno, queda pagada;
 *   · efectivo y crédito: el efectivo hoy y lo demás a su cuenta, con sus días;
 *   · saldo a favor y crédito / saldo a favor y efectivo (una parte);
 *   · TODO O NADA: si el crédito no alcanza o falta el turno, no queda ni el pago
 *     que iba antes;
 *   · lo que no se deja: tres formas, la misma dos veces, más de lo que falta,
 *     crédito sin nada que pasar, crédito sin el permiso;
 *   · el ticket junta los pagos de esa vez y dice lo que pasó a crédito.
 *
 * Crea "TMPPN …" (hilo, caja, turno, clientes y una persona sin «Vender a
 * crédito») y lo borra al final.
 *
 *   cd backend
 *   DB_NAME=desarrollo PORT=3210 node src/server.js &
 *   DB_NAME=desarrollo E2E_ACEPTO_PRODUCCION=si node scripts/e2e-pago-nota-formas.js
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
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

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
  const firmar = (u) => jwt.sign({ sub: u.id, tipo: 'usuario', rol_id: u.rol_id, rol: u.rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const pedir = async (token, me, r, b) => {
    const x = await fetch(B + r, {
      method: me,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };
  const tAdmin = firmar({ ...admin, rol: 'administrador' });
  const api = (me, r, b) => pedir(tAdmin, me, r, b);
  const pagos = async (id) => {
    const [rows] = await db.query(
      `SELECT mp.nombre AS metodo, g.monto, DATE_FORMAT(g.creado_en, '%Y-%m-%d %H:%i:%s') AS en
         FROM pagos g JOIN metodos_pago mp ON mp.id = g.metodo_pago_id WHERE g.pedido_id = ? ORDER BY g.id`, [id]
    );
    return rows.map((x) => ({ metodo: x.metodo, monto: r2(x.monto), en: x.en }));
  };
  const cargo = async (id) => {
    const [[x]] = await db.query("SELECT COALESCE(SUM(monto), 0) AS m FROM credito_movimientos WHERE pedido_id = ? AND tipo = 'cargo'", [id]);
    return r2(x.m);
  };
  const estado = async (id) => (await db.query('SELECT estado, dias_credito FROM pedidos WHERE id = ?', [id]))[0][0];
  const caja = async (s) => {
    const [rows] = await db.query("SELECT monto FROM movimientos_caja WHERE sesion_caja_id = ? AND tipo = 'ingreso' ORDER BY id", [s]);
    return rows.map((x) => r2(x.monto));
  };

  try {
    const [[tienda]] = await db.query('SELECT id FROM almacenes WHERE activo = 1 AND es_punto_venta = 1 ORDER BY id LIMIT 1');
    const [[cat]] = await db.query('SELECT id FROM categorias ORDER BY id LIMIT 1');
    const [[kg]] = await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");
    const [[ef]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Efectivo%' ORDER BY id LIMIT 1");
    const [[tr]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Transferencia%' ORDER BY id LIMIT 1");
    const [[sinFiar]] = await db.query(
      `SELECT r.id FROM roles r WHERE r.entra_al_sistema = 1 AND r.nombre <> 'administrador'
          AND NOT EXISTS (SELECT 1 FROM rol_permisos rp JOIN permisos p ON p.id = rp.permiso_id
                           WHERE rp.rol_id = r.id AND p.clave = 'hacer:fiar') ORDER BY r.id LIMIT 1`
    );

    let r = await api('POST', '/productos', {
      categoria_id: cat.id, unidad_medida_id: kg.id, nombre: 'TMPPN ROJO ' + SUF, precio_kg: 100, multipresentacion: true,
    });
    const paquete = (await api('GET', `/productos/${r.data.id}`)).data.variantes[0];
    await api('POST', '/inventario/movimientos', { variante_id: paquete.id, almacen_id: tienda.id, tipo: 'entrada', cantidad: 200, motivo: 'TMPPN' });
    const cj = (await api('POST', '/caja/cajas', { almacen_id: tienda.id, nombre: 'TMPPN Caja ' + SUF })).data;
    const sesion = (await api('POST', '/caja/sesiones', { caja_id: cj.id, monto_inicial: 0 })).data;
    const cli = (await api('POST', '/clientes', { nombre: 'TMPPN Doña Chela ' + SUF, telefono: '4450000031', limite_credito: 5000 })).data;
    const corto = (await api('POST', '/clientes', { nombre: 'TMPPN Poco crédito ' + SUF, telefono: '4450000032', limite_credito: 100 })).data;
    const nota = async (c = cli, kgs = 10) => (await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: c.id, pendiente_pago: true,
      items: [{ variante_id: paquete.id, cantidad: kgs }],
    })).data;
    const pagar = (id, b, token = tAdmin) => pedir(token, 'POST', `/pedidos/${id}/pago-nota`, b);
    ck('hilo a $100/kg, caja, turno y dos clientes', !!sesion?.id && !!cli?.id && !!corto?.id);

    console.log('\n=== 1. Efectivo y transferencia: queda pagada ===');
    let n = await nota();
    r = await pagar(n.id, {
      sesion_caja_id: sesion.id,
      partes: [{ metodo_pago_id: tr.id, monto: 400, referencia: 'OP-1' }, { metodo_pago_id: ef.id, monto: 600 }],
    });
    let pg = await pagos(n.id);
    ck('se registra: dos pagos ($400 transferencia, $600 efectivo)', r.status === 201 && pg.length === 2
      && pg.map((x) => x.monto).join() === '400,600', r.error ?? pg);
    ck('con la MISMA hora (el ticket los junta)', pg[0].en === pg[1].en, pg.map((x) => x.en));
    ck('la nota queda pagada', (await estado(n.id)).estado === 'pagado' && r.data?.liquidado === true, r.data);
    ck('al turno entra solo el efectivo ($600)', JSON.stringify(await caja(sesion.id)) === '[600]', await caja(sesion.id));
    let t = await api('GET', `/pedidos/${n.id}/pagos/${r.data.pago_id}/ticket`);
    ck('el ticket dice ABONÓ $1,000 con las dos formas', t.data?.monto === 1000 && t.data?.partes?.length === 2
      && t.data?.falta === 0 && !t.data?.credito, t.data && [t.data.monto, t.data.partes, t.data.falta]);

    console.log('\n=== 2. Efectivo y crédito: lo demás a su cuenta, con sus días ===');
    n = await nota();
    r = await pagar(n.id, { sesion_caja_id: sesion.id, partes: [{ metodo_pago_id: ef.id, monto: 300 }], a_credito: true, dias_credito: 20 });
    ck('se registra: $300 hoy y $700 a crédito', r.status === 201 && r.data?.a_credito === 700 && r.data?.pendiente === 0, r.error ?? r.data);
    ck('el cargo es de $700 a 20 días', (await cargo(n.id)) === 700 && (await estado(n.id)).dias_credito === 20, [await cargo(n.id), await estado(n.id)]);
    ck('ya no está en Notas pendientes (es una venta a crédito)',
      !((await api('GET', '/pedidos/notas-pendientes')).data?.items ?? []).some((x) => x.id === n.id));
    ck('el efectivo entró al turno', (await caja(sesion.id)).includes(300), await caja(sesion.id));
    t = await api('GET', `/pedidos/${n.id}/pagos/${r.data.pago_id}/ticket`);
    ck('el ticket dice el crédito: $700 a 20 días', t.data?.credito?.monto === 700 && t.data?.credito?.dias === 20 && t.data?.falta === 0,
      t.data?.credito);

    console.log('\n=== 3. Con su saldo a favor ===');
    await api('POST', `/clientes/${cli.id}/anticipos`, { efectivo: 250, sesion_caja_id: sesion.id });
    n = await nota();
    r = await pagar(n.id, { partes: [{ con_saldo_favor: true, monto: 250 }], a_credito: true });
    ck('saldo y crédito: $250 de su saldo y $750 a crédito (15 días)', r.status === 201 && r.data?.a_credito === 750
      && (await cargo(n.id)) === 750, r.error ?? r.data);
    pg = await pagos(n.id);
    ck('el pago dice «Saldo a favor»', pg.length === 1 && pg[0].metodo === 'Saldo a favor' && pg[0].monto === 250, pg);
    await api('POST', `/clientes/${cli.id}/anticipos`, { efectivo: 100, sesion_caja_id: sesion.id });
    n = await nota();
    r = await pagar(n.id, { sesion_caja_id: sesion.id, partes: [{ con_saldo_favor: true, monto: 100 }, { metodo_pago_id: ef.id, monto: 400 }] });
    ck('saldo y efectivo, pagando una parte: le faltan $500', r.status === 201 && r.data?.pendiente === 500
      && (await estado(n.id)).estado === 'pendiente', r.error ?? r.data);

    console.log('\n=== 4. Todo o nada ===');
    n = await nota(corto);
    r = await pagar(n.id, { partes: [{ metodo_pago_id: tr.id, monto: 200 }], a_credito: true });
    ck('el crédito no le alcanza ($800 con límite de $100): 409', r.status === 409 && /CREDITO/.test(r.error?.code ?? ''), r.error?.code);
    ck('y no quedó ni la transferencia', (await pagos(n.id)).length === 0 && (await cargo(n.id)) === 0, await pagos(n.id));
    n = await nota();
    r = await pagar(n.id, { partes: [{ metodo_pago_id: tr.id, monto: 200 }, { metodo_pago_id: ef.id, monto: 300 }] });
    ck('efectivo sin turno: 409 FALTA_SESION_CAJA', r.status === 409 && r.error?.code === 'FALTA_SESION_CAJA', r.error?.code);
    ck('y no quedó la transferencia que iba antes', (await pagos(n.id)).length === 0, await pagos(n.id));

    console.log('\n=== 5. Lo que no se deja ===');
    r = await pagar(n.id, { sesion_caja_id: sesion.id, partes: [{ metodo_pago_id: tr.id, monto: 100 }, { metodo_pago_id: ef.id, monto: 100 }], a_credito: true });
    ck('tres formas: 422 MAS_DE_DOS_FORMAS', r.status === 422 && r.error?.code === 'MAS_DE_DOS_FORMAS', r.error?.code);
    r = await pagar(n.id, { sesion_caja_id: sesion.id, partes: [{ metodo_pago_id: ef.id, monto: 100 }, { metodo_pago_id: ef.id, monto: 100 }] });
    ck('la misma forma dos veces: 422 FORMA_REPETIDA', r.status === 422 && r.error?.code === 'FORMA_REPETIDA', r.error?.code);
    r = await pagar(n.id, { partes: [{ metodo_pago_id: tr.id, monto: 2000 }] });
    ck('más de lo que falta: 422 ABONO_EXCEDE_PENDIENTE', r.status === 422 && r.error?.code === 'ABONO_EXCEDE_PENDIENTE', r.error?.code);
    r = await pagar(n.id, { partes: [{ metodo_pago_id: tr.id, monto: 1000 }], a_credito: true });
    ck('crédito sin nada que pasar: 422 NADA_A_CREDITO', r.status === 422 && r.error?.code === 'NADA_A_CREDITO', r.error?.code);
    r = await pagar(n.id, {});
    ck('sin nada: 422 PAGO_VACIO', r.status === 422 && r.error?.code === 'PAGO_VACIO', r.error?.code);
    if (sinFiar) {
      r = await api('POST', '/usuarios', {
        nombre: `TMPPN Sin fiar ${SUF}`, correo: `tmppn.sinfiar.${SUF.toLowerCase()}@prueba.local`,
        contrasena: 'clave-de-prueba-1', rol_id: sinFiar.id, todas_las_tiendas: false, tiendas: [tienda.id],
      });
      const t2 = firmar({ id: Number(r.data?.id), rol_id: sinFiar.id, rol: 'x' });
      r = await pagar(n.id, { partes: [{ metodo_pago_id: tr.id, monto: 100 }], a_credito: true }, t2);
      ck('quien no tiene «Vender a crédito»: 403', r.status === 403 && r.error?.code === 'SIN_PERMISO', r.error?.code);
    }
    ck('y la nota sigue igual (nada registrado)', (await pagos(n.id)).length === 0 && (await estado(n.id)).estado === 'pendiente');
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    console.log('\nLimpiando…');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    const [prods] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPPN %'");
    const pr = prods.map((x) => x.id);
    const [vs] = pr.length ? await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [pr]) : [[]];
    const vids = vs.map((v) => v.id);
    const [peds] = vids.length ? await db.query('SELECT DISTINCT pedido_id FROM pedido_detalle WHERE variante_id IN (?)', [vids]) : [[]];
    const pids = peds.map((x) => x.pedido_id);
    if (pids.length) {
      const [pgs] = await db.query('SELECT id FROM pagos WHERE pedido_id IN (?)', [pids]);
      if (pgs.length) await db.query("DELETE FROM transferencias WHERE fuente = 'pago' AND fuente_id IN (?)", [pgs.map((x) => x.id)]);
      for (const tb of ['pagos', 'pedido_detalle', 'credito_movimientos']) await db.query(`DELETE FROM ${tb} WHERE pedido_id IN (?)`, [pids]);
      await db.query('DELETE FROM pedidos WHERE id IN (?)', [pids]);
    }
    const [cls] = await db.query("SELECT id FROM clientes WHERE nombre LIKE 'TMPPN %'");
    const cids = cls.map((x) => x.id);
    if (cids.length) {
      for (const tb of ['credito_movimientos', 'saldo_favor_movimientos']) await db.query(`DELETE FROM ${tb} WHERE cliente_id IN (?)`, [cids]);
      await db.query('DELETE FROM clientes WHERE id IN (?)', [cids]);
    }
    if (vids.length) {
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) {
        await db.query(`DELETE FROM ${tb} WHERE variante_id IN (?)`, [vids]);
      }
      await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
    }
    if (pr.length) await db.query('DELETE FROM productos WHERE id IN (?)', [pr]);
    const [cjs] = await db.query("SELECT id FROM cajas WHERE nombre LIKE 'TMPPN Caja%'");
    if (cjs.length) {
      const [ses] = await db.query('SELECT id FROM sesiones_caja WHERE caja_id IN (?)', [cjs.map((x) => x.id)]);
      await borrarTurnosPropios(db, ses.map((x) => x.id));
      await borrarCajasSinTurnos(db, cjs.map((x) => x.id));
    }
    const [us] = await db.query("SELECT id FROM usuarios WHERE nombre LIKE 'TMPPN %'");
    const uids = us.map((x) => x.id);
    if (uids.length) {
      for (const tb of ['usuario_almacenes', 'usuario_roles']) await db.query(`DELETE FROM ${tb} WHERE usuario_id IN (?)`, [uids]);
      await db.query('DELETE FROM usuarios WHERE id IN (?)', [uids]);
    }
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    const [[{ n }]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPPN %') + (SELECT COUNT(*) FROM clientes WHERE nombre LIKE 'TMPPN %')
            + (SELECT COUNT(*) FROM cajas WHERE nombre LIKE 'TMPPN Caja%') + (SELECT COUNT(*) FROM usuarios WHERE nombre LIKE 'TMPPN %') AS n`
    );
    ck('no quedó basura (TMPPN)', Number(n) === 0, n);
    await db.end();
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
