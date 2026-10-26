'use strict';

/**
 * Prueba de la auditoría del 2026-10-26 (módulos 02 a 05): al cancelar, SOLO EL
 * DINERO que entró se puede regresar.
 *
 *   · Venta a crédito abonada con $700 en efectivo y $300 condonados: la ventana
 *     ofrece regresar $700, los $300 se van con la venta (decisión del usuario), no
 *     queda nada a favor y ya no se reactiva. El resumen de la autorización lo dice.
 *   · Pagada con su saldo a favor («Descontar de lo que debe»): aunque se pida
 *     regresarlo en efectivo, no sale nada del cajón y regresa a su saldo a favor.
 *   · Abonada por transferencia y regresada por el banco: Transferencias la resta
 *     («Se le regresó», en negativo) de la cuenta de la que salió.
 *   · Transferencias cuenta todos sus renglones (también los que no suman) y una
 *     nota en espera entregada como pendiente de pago es «Nota pendiente».
 *   · Cancelar una NOTA EN ESPERA también puede dejar a su saldo a favor lo que dejó;
 *     Caja marca esa venta «quedó a su saldo a favor»; reactivarla dice por qué no.
 *   · El ticket de un abono a una nota dice lo que le falta hoy contando su crédito.
 *   · Entregar con su saldo a favor y efectivo deja los dos pagos a la misma hora.
 *   · La comisión no se paga sobre lo condonado («solo sobre lo cobrado»).
 *
 * Crea "TMPCA …" (hilo, caja, turno, cuenta de banco, clientes) y lo borra al final.
 *
 *   cd backend
 *   DB_NAME=desarrollo PORT=3210 node src/server.js &
 *   DB_NAME=desarrollo E2E_ACEPTO_PRODUCCION=si node scripts/e2e-cancelar-lo-abonado.js
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
  const conf = {
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  };
  const db = await m.createConnection(conf);
  const [[admin]] = await db.query(
    `SELECT u.id, u.rol_id FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = 'administrador' AND u.activo = 1 ORDER BY u.id LIMIT 1`
  );
  const t = jwt.sign({ sub: admin.id, tipo: 'usuario', rol_id: admin.rol_id, rol: 'administrador' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const api = async (me, r, b) => {
    const x = await fetch(B + r, {
      method: me, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };

  try {
    const [[tienda]] = await db.query('SELECT id FROM almacenes WHERE activo = 1 AND es_punto_venta = 1 ORDER BY id LIMIT 1');
    const [[cat]] = await db.query('SELECT id FROM categorias ORDER BY id LIMIT 1');
    const [[kg]] = await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");
    const [[ef]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Efectivo%' ORDER BY id LIMIT 1");
    const [[tr]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Transferencia%' ORDER BY id LIMIT 1");
    const [ins] = await db.query(
      "INSERT INTO cuentas_bancarias (banco, titular, numero_cuenta, activa) VALUES (?, 'TMPCA', ?, 1)",
      [`TMPCA Banco ${SUF}`, String(Date.now()).slice(-10)]
    );
    const cuentaId = Number(ins.insertId);

    let r = await api('POST', '/productos', {
      categoria_id: cat.id, unidad_medida_id: kg.id, nombre: 'TMPCA AZUL ' + SUF, precio_kg: 100, multipresentacion: true,
    });
    const paquete = (await api('GET', `/productos/${r.data.id}`)).data.variantes[0];
    await api('POST', '/inventario/movimientos', { variante_id: paquete.id, almacen_id: tienda.id, tipo: 'entrada', cantidad: 200, motivo: 'TMPCA' });
    const cj = (await api('POST', '/caja/cajas', { almacen_id: tienda.id, nombre: 'TMPCA Caja ' + SUF })).data;
    const sesion = (await api('POST', '/caja/sesiones', { caja_id: cj.id, monto_inicial: 5000 })).data;
    ck('hilo, caja con turno y una cuenta de banco de la prueba', !!sesion?.id && cuentaId > 0);

    const nuevoCliente = async (n) => (await api('POST', '/clientes', {
      nombre: `TMPCA ${n} ${SUF}`, telefono: '44500001' + String(Math.floor(Math.random() * 90) + 10), limite_credito: 20000,
    })).data;
    const saldoDe = async (c) => r2((await api('GET', `/clientes/${c.id}`)).data?.saldo_favor ?? 0);
    const deudaDe = async (c) => r2((await api('GET', `/clientes/${c.id}`)).data?.saldo ?? 0);
    const devolucionesCaja = async () => {
      const [rows] = await db.query("SELECT COALESCE(SUM(monto), 0) AS m FROM movimientos_caja WHERE sesion_caja_id = ? AND tipo = 'devolucion'", [sesion.id]);
      return r2(rows[0].m);
    };
    const fiar = async (c, kgs) => (await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: c.id, a_credito: kgs * 100,
      items: [{ variante_id: paquete.id, cantidad: kgs }],
    })).data;

    // ---------------------------------------------------------------- #4
    console.log('\n=== Venta a crédito: $700 abonados en efectivo y $300 condonados ===');
    const ana = await nuevoCliente('Ana');
    const v1 = await fiar(ana, 10);
    await api('POST', `/clientes/${ana.id}/abonos`, { monto: 700, metodo_pago_id: ef.id, sesion_caja_id: sesion.id });
    r = await api('POST', `/clientes/${ana.id}/ajustes`, { monto: -300, notas: 'TMPCA se le perdonan' });
    let p1 = (await api('GET', `/pedidos/${v1.id}`)).data;
    ck('queda pagada', p1?.estado === 'pagado', p1?.estado);
    ck('el detalle dice qué quedaría libre: $700 de efectivo y $300 de un ajuste',
      p1?.abonado_libre?.efectivo === 700 && p1?.abonado_libre?.ajuste === 300 && p1?.abonado_libre?.total === 1000, p1?.abonado_libre);
    // El resumen de la solicitud de autorización.
    const operaciones = require('../src/modules/autorizaciones/operaciones');
    const resumen = await operaciones.OPERACIONES?.cancelar_venta?.describir?.({
      params: { id: String(v1.id) }, body: { estado: 'cancelado', abonado_se_regresa: 'efectivo' },
    }) ?? await (operaciones.cancelar_venta ?? operaciones.default?.cancelar_venta)?.describir?.({
      params: { id: String(v1.id) }, body: { estado: 'cancelado', abonado_se_regresa: 'efectivo' },
    });
    ck('la autorización dice cuánto sale y qué se quita', /\$700\.00 que abonó se le regresan en efectivo/.test(resumen ?? '')
      && /\$300\.00 de un ajuste a mano se quitan/.test(resumen ?? ''), resumen);
    let caja = await devolucionesCaja();
    r = await api('PATCH', `/pedidos/${v1.id}/estado`, { estado: 'cancelado', abonado_se_regresa: 'efectivo' });
    ck('se cancela: se le regresan $700 en efectivo y $300 se quitan con la venta',
      r.status === 200 && r.data?.abonado_regresado === 700 && r.data?.abonado_condonado === 300 && !r.data?.abonado_a_favor,
      r.error ?? [r.data?.abonado_regresado, r.data?.abonado_condonado, r.data?.abonado_a_favor]);
    ck('salen $700 del cajón (no $1,000)', (await devolucionesCaja()) === r2(caja + 700), [caja, await devolucionesCaja()]);
    ck('no le queda nada a favor y su cuenta queda en $0', (await saldoDe(ana)) === 0 && (await deudaDe(ana)) === 0,
      [await saldoDe(ana), await deudaDe(ana)]);
    r = await api('PATCH', `/pedidos/${v1.id}/estado`, { estado: 'pendiente' });
    ck('ya no se reactiva (409 VENTA_CON_SALDO_FAVOR)', r.status === 409 && r.error?.code === 'VENTA_CON_SALDO_FAVOR', r.error);

    console.log('\n=== Solo condonada: tampoco se reactiva (la deuda perdonada ya no existe) ===');
    const vC = await fiar(ana, 3);
    await api('POST', `/clientes/${ana.id}/ajustes`, { monto: -300, notas: 'TMPCA se le perdona toda' });
    r = await api('PATCH', `/pedidos/${vC.id}/estado`, { estado: 'cancelado' });
    ck('se cancela sin dejar nada a favor', r.status === 200 && r.data?.abonado_condonado === 300 && (await saldoDe(ana)) === 0,
      [r.error, r.data?.abonado_condonado, await saldoDe(ana)]);
    r = await api('PATCH', `/pedidos/${vC.id}/estado`, { estado: 'pendiente' });
    ck('y no se reactiva', r.status === 409 && r.error?.code === 'VENTA_CON_SALDO_FAVOR', r.error?.code);

    // ---------------------------------------------------------------- saldo
    console.log('\n=== Pagada con su saldo a favor: no se regresa en efectivo ===');
    const beto = await nuevoCliente('Beto');
    await api('POST', `/clientes/${beto.id}/anticipos`, { efectivo: 500, sesion_caja_id: sesion.id });
    const v2 = await fiar(beto, 5);
    r = await api('POST', `/clientes/${beto.id}/saldo-favor/aplicar`, { monto: 500 });
    let p2 = (await api('GET', `/pedidos/${v2.id}`)).data;
    ck('se paga con «Descontar de lo que debe»', p2?.estado === 'pagado' && (await saldoDe(beto)) === 0, [r.error, p2?.estado]);
    ck('el detalle lo dice como saldo, no como dinero', p2?.abonado_libre?.saldo === 500 && p2?.abonado_libre?.efectivo === 0, p2?.abonado_libre);
    caja = await devolucionesCaja();
    r = await api('PATCH', `/pedidos/${v2.id}/estado`, { estado: 'cancelado', abonado_se_regresa: 'efectivo' });
    ck('aunque se pida en efectivo, no sale nada del cajón', r.status === 200 && !r.data?.abonado_regresado
      && (await devolucionesCaja()) === caja, [r.error, r.data?.abonado_regresado, await devolucionesCaja()]);
    ck('y los $500 regresan a su saldo a favor', r.data?.abonado_a_favor === 500 && (await saldoDe(beto)) === 500, await saldoDe(beto));

    // ---------------------------------------------------------------- #6 y #5
    console.log('\n=== Abonada por transferencia y regresada por el banco ===');
    const ver = async (q = '') => (await api('GET', `/transferencias?cuenta=${cuentaId}${q}`)).data;
    const caro = await nuevoCliente('Caro');
    const v3 = await fiar(caro, 4);
    await api('POST', `/clientes/${caro.id}/abonos`, { monto: 400, metodo_pago_id: tr.id, cuenta_bancaria_id: cuentaId });
    let d = await ver();
    ck('antes: entraron $400 por transferencia a la cuenta', d?.cifras?.importe === 400, d?.cifras);
    r = await api('PATCH', `/pedidos/${v3.id}/estado`, { estado: 'cancelado', abonado_se_regresa: 'banco', cuenta_regreso: cuentaId });
    ck('se cancela regresándole $400 por el banco', r.status === 200 && r.data?.abonado_regresado === 400, r.error ?? r.data?.abonado_regresado);
    d = await ver();
    const reg = (d?.items ?? []).find((x) => x.de === 'regreso');
    ck('Transferencias lo resta: la cuenta queda en $0 y dice cuánto se le regresó',
      d?.cifras?.importe === 0 && d?.cifras?.regresos === 1 && d?.cifras?.importe_regresado === 400
        && (d?.por_cuenta ?? []).every((k) => k.importe === 0 && k.cuantas === 1 && k.regresado === 400), [d?.cifras, d?.por_cuenta]);
    ck('el renglón «Se le regresó» va en negativo, de esa cuenta y con su venta',
      reg?.importe === -400 && reg?.cuenta_bancaria_id === cuentaId && reg?.ventas?.[0]?.id === v3.id, reg);
    ck('«Por revisar» y «Sin facturar» cuentan solo lo que entró', d?.cifras?.sin_facturar === 1 && d?.cifras?.importe_sin_facturar === 400
      && d?.cifras?.por_revisar === 1 && d?.cifras?.importe_por_revisar === 400, d?.cifras);
    r = await api('PUT', `/transferencias/${reg?.clave}`, { estado: 'procesada', facturada: true });
    d = await ver();
    const reg2 = (d?.items ?? []).find((x) => x.de === 'regreso');
    ck('se marca procesada pero no facturada', r.status === 200 && reg2?.estado === 'procesada' && reg2?.facturada === false, [r.error, reg2?.facturada]);

    console.log('\n=== La lista cuenta todos sus renglones ===');
    const v4 = (await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, items: [{ variante_id: paquete.id, cantidad: 2 }],
      pagos: [{ metodo_pago_id: tr.id, monto: 200, cuenta_bancaria_id: cuentaId }],
    })).data;
    await api('PUT', `/transferencias/pago-${(await db.query('SELECT id FROM pagos WHERE pedido_id = ?', [v4.id]))[0][0].id}`, { facturada: true });
    await api('PATCH', `/pedidos/${v4.id}/estado`, { estado: 'cancelado' });
    d = await ver();
    ck('total = todos los renglones (también el cancelado, que no suma)', d?.total === (d?.items ?? []).length && d?.total === 3,
      [d?.total, (d?.items ?? []).length]);
    ck('la cancelada que ya estaba facturada se avisa', d?.cifras?.facturadas_canceladas === 1 && d?.cifras?.importe_facturadas_canceladas === 200, d?.cifras);

    // ---------------------------------------------------------------- #3, #20, #17
    console.log('\n=== Nota en espera con lo que dejó: queda a su saldo a favor ===');
    const dani = await nuevoCliente('Dani');
    const ne = (await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: dani.id, encargo: true,
      items: [{ variante_id: paquete.id, cantidad: 3 }], pagos: [{ metodo_pago_id: ef.id, monto: 150 }],
    })).data;
    ck('nota en espera de $300 con $150 dejados en efectivo', Number(ne?.total) === 300, ne?.total ?? ne);
    caja = await devolucionesCaja();
    r = await api('PATCH', `/pedidos/${ne.id}/estado`, { estado: 'cancelado', a_favor: { efectivo: true } });
    ck('se cancela: los $150 quedan a su saldo a favor y no salen del cajón', r.status === 200 && r.data?.efectivo_a_favor === 150
      && (await saldoDe(dani)) === 150 && (await devolucionesCaja()) === caja, [r.error, r.data?.efectivo_a_favor, await saldoDe(dani)]);
    const ses = (await api('GET', `/caja/sesiones/${sesion.id}`)).data;
    const mov = (ses?.movimientos ?? []).find((x) => x.tipo === 'venta' && x.numero_pedido === ne.numero_pedido);
    ck('Caja la marca: quedó a su saldo a favor', !!mov && Number(mov.cancelada_a_favor) === 1, mov);
    r = await api('PATCH', `/pedidos/${ne.id}/estado`, { estado: 'en_preparacion' });
    ck('reactivarla dice que lo que pagó quedó a su saldo a favor', r.status === 409
      && /le quedó a su saldo a favor/.test(r.error?.message ?? '') && !/no había efectivo/.test(r.error?.message ?? ''), r.error?.message);

    // ---------------------------------------------------------------- #18
    console.log('\n=== Entregar con su saldo a favor y efectivo: una sola hora ===');
    const ne2 = (await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: dani.id, encargo: true,
      items: [{ variante_id: paquete.id, cantidad: 4 }],
    })).data;
    r = await api('POST', `/pedidos/${ne2.id}/entregar`, {
      saldo_favor: 150, pagos: [{ metodo_pago_id: ef.id, monto: 250 }], sesion_caja_id: sesion.id,
    });
    const [pagosNe2] = await db.query("SELECT DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS en FROM pagos WHERE pedido_id = ?", [ne2.id]);
    ck('se entrega con $150 de su saldo y $250 en efectivo', r.status === 200 && pagosNe2.length === 2, [r.error, pagosNe2.length]);
    ck('los dos pagos llevan la misma hora', new Set(pagosNe2.map((x) => x.en)).size === 1, pagosNe2);

    // ---------------------------------------------------------------- #15, #11
    console.log('\n=== Nota pendiente: Transferencias la clasifica bien y su ticket cuenta el crédito ===');
    const eli = await nuevoCliente('Eli');
    const ne3 = (await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: eli.id, encargo: true,
      items: [{ variante_id: paquete.id, cantidad: 10 }],
    })).data;
    r = await api('POST', `/pedidos/${ne3.id}/entregar`, { pendiente_pago: true });
    ck('nota en espera de $1,000 entregada como pendiente de pago', r.status === 200, r.error);
    r = await api('POST', `/pedidos/${ne3.id}/pago-nota`, {
      partes: [{ metodo_pago_id: tr.id, monto: 300, cuenta_bancaria_id: cuentaId }],
    });
    const pago1 = r.data?.pago_id ?? r.data?.pagos?.[0] ?? null;
    d = await ver('&de=nota');
    ck('su transferencia sale como «Nota pendiente»', (d?.items ?? []).some((x) => x.de === 'nota' && x.importe === 300), (d?.items ?? []).map((x) => x.de));
    r = await api('POST', `/pedidos/${ne3.id}/pago-nota`, {
      partes: [{ metodo_pago_id: ef.id, monto: 200 }], sesion_caja_id: sesion.id, a_credito: true,
    });
    ck('después paga $200 en efectivo y $500 a crédito', r.status < 300, r.error);
    const [[pg1]] = await db.query('SELECT id FROM pagos WHERE pedido_id = ? ORDER BY id LIMIT 1', [ne3.id]);
    let tk = (await api('GET', `/pedidos/${ne3.id}/pagos/${pago1?.id ?? pg1.id}/ticket`)).data;
    ck('el ticket del primer abono: «Hoy le falta $500», todo en su crédito', tk?.falta === 700 && tk?.falta_hoy === 500
      && tk?.falta_hoy_credito === 500, tk && [tk.falta, tk.falta_hoy, tk.falta_hoy_credito]);
    await api('POST', `/clientes/${eli.id}/abonos`, { monto: 500, metodo_pago_id: ef.id, sesion_caja_id: sesion.id });
    tk = (await api('GET', `/pedidos/${ne3.id}/pagos/${pg1.id}/ticket`)).data;
    ck('al liquidar su crédito, el mismo ticket dice que hoy no le falta nada', tk?.falta_hoy === 0 && tk?.falta_hoy_credito === 0,
      tk && [tk.falta_hoy, tk.falta_hoy_credito]);

    // ---------------------------------------------------------------- #21
    console.log('\n=== La comisión no se paga sobre lo condonado ===');
    const fer = await nuevoCliente('Fer');
    const v5 = await fiar(fer, 10);
    await api('POST', `/clientes/${fer.id}/abonos`, { monto: 700, metodo_pago_id: ef.id, sesion_caja_id: sesion.id });
    await api('POST', `/clientes/${fer.id}/ajustes`, { monto: -300, notas: 'TMPCA se le perdonan' });
    const conn = await m.createConnection({ ...conf, namedPlaceholders: true, dateStrings: true });
    await conn.query("SET time_zone = '-06:00'");
    const comisiones = require('../src/modules/nomina/comisiones');
    const ventas = await comisiones.ventasSinPagarComision(conn, { usuarioIds: [admin.id], hasta: '9999-12-31 00:00:00' });
    const c5 = ventas.find((x) => x.pedido_id === v5.id);
    await conn.end();
    ck('liquidada, con venta neta de $700 y $300 condonados', !!c5?.liquidada_en && c5?.venta_neta === 700 && c5?.condonado === 300,
      c5 && { liquidada: c5.liquidada_en, neta: c5.venta_neta, condonado: c5.condonado });
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    console.log('\nLimpiando…');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    const [prods] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPCA %'");
    const pr = prods.map((x) => x.id);
    const [vs] = pr.length ? await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [pr]) : [[]];
    const vids = vs.map((v) => v.id);
    const [peds] = vids.length ? await db.query('SELECT DISTINCT pedido_id FROM pedido_detalle WHERE variante_id IN (?)', [vids]) : [[]];
    const pids = peds.map((x) => x.pedido_id);
    const [cls] = await db.query("SELECT id FROM clientes WHERE nombre LIKE 'TMPCA %'");
    const cids = cls.map((x) => x.id);
    if (pids.length) {
      const [pgs] = await db.query('SELECT id FROM pagos WHERE pedido_id IN (?)', [pids]);
      if (pgs.length) await db.query("DELETE FROM transferencias WHERE fuente = 'pago' AND fuente_id IN (?)", [pgs.map((x) => x.id)]);
      for (const tb of ['pagos', 'pedido_detalle', 'credito_movimientos']) await db.query(`DELETE FROM ${tb} WHERE pedido_id IN (?)`, [pids]);
      await db.query('DELETE FROM pedidos WHERE id IN (?)', [pids]);
    }
    if (cids.length) {
      const [cms] = await db.query('SELECT id FROM credito_movimientos WHERE cliente_id IN (?)', [cids]);
      if (cms.length) await db.query("DELETE FROM transferencias WHERE fuente = 'abono' AND fuente_id IN (?)", [cms.map((x) => x.id)]);
      const [sfs] = await db.query('SELECT id FROM saldo_favor_movimientos WHERE cliente_id IN (?)', [cids]);
      if (sfs.length) await db.query("DELETE FROM transferencias WHERE fuente IN ('anticipo', 'regreso') AND fuente_id IN (?)", [sfs.map((x) => x.id)]);
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
    const [cjs] = await db.query("SELECT id FROM cajas WHERE nombre LIKE 'TMPCA Caja%'");
    if (cjs.length) {
      const [ses] = await db.query('SELECT id FROM sesiones_caja WHERE caja_id IN (?)', [cjs.map((x) => x.id)]);
      await borrarTurnosPropios(db, ses.map((x) => x.id));
      await borrarCajasSinTurnos(db, cjs.map((x) => x.id));
    }
    await db.query("DELETE FROM transferencias WHERE cuenta_bancaria_id IN (SELECT id FROM cuentas_bancarias WHERE titular = 'TMPCA')");
    await db.query("DELETE FROM cuentas_bancarias WHERE titular = 'TMPCA'");
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    const [[{ n }]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPCA %') + (SELECT COUNT(*) FROM cajas WHERE nombre LIKE 'TMPCA Caja%')
            + (SELECT COUNT(*) FROM cuentas_bancarias WHERE titular = 'TMPCA') + (SELECT COUNT(*) FROM clientes WHERE nombre LIKE 'TMPCA %') AS n`
    );
    ck('no quedó basura (TMPCA)', Number(n) === 0, n);
    await db.end();
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
