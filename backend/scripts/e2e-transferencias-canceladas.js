'use strict';

/**
 * Prueba de que LA TRANSFERENCIA DE UNA VENTA CANCELADA NO SUMA (2026-10-26,
 * usuario: "se realizó una cancelación de una venta que fue pagada en
 * transferencia y efectivo, pero en las transferencias no descuenta la
 * transferencia de la venta cancelada"):
 *
 *   · antes de cancelar, sus $400 por transferencia suman en "Entró por
 *     transferencia", en "Por revisar" y en "A qué cuenta llegó";
 *   · al cancelarla ya no suman en ninguna cifra ni en la barra de su cuenta;
 *     se dicen aparte (`canceladas`, `importe_cancelado`);
 *   · su renglón sigue en la lista, marcado `cancelada`;
 *   · AL CANCELAR SE PREGUNTA QUÉ PASA CON EL DINERO (2026-10-26): lo que queda a su
 *     saldo a favor no sale del cajón, la transferencia sigue sumando (marcada
 *     `a_favor`) y la venta ya no se reactiva; sin cliente se regresa como siempre.
 *
 * Crea "TMPTC …" (hilo, caja, turno, cuenta de banco) y lo borra al final.
 *
 *   cd backend
 *   DB_NAME=desarrollo PORT=3210 node src/server.js &
 *   DB_NAME=desarrollo E2E_ACEPTO_PRODUCCION=si node scripts/e2e-transferencias-canceladas.js
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
  const t = jwt.sign({ sub: admin.id, tipo: 'usuario', rol_id: admin.rol_id, rol: 'administrador' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const api = async (me, r, b) => {
    const x = await fetch(B + r, {
      method: me, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };
  let cuentaId = null;

  try {
    const [[tienda]] = await db.query('SELECT id FROM almacenes WHERE activo = 1 AND es_punto_venta = 1 ORDER BY id LIMIT 1');
    const [[cat]] = await db.query('SELECT id FROM categorias ORDER BY id LIMIT 1');
    const [[kg]] = await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");
    const [[ef]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Efectivo%' ORDER BY id LIMIT 1");
    const [[tr]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Transferencia%' ORDER BY id LIMIT 1");
    // Una cuenta propia de la prueba: así sus cifras solo cuentan lo de la prueba.
    const [ins] = await db.query(
      "INSERT INTO cuentas_bancarias (banco, titular, numero_cuenta, activa) VALUES (?, 'TMPTC', ?, 1)",
      [`TMPTC Banco ${SUF}`, String(Date.now()).slice(-10)]
    );
    cuentaId = Number(ins.insertId);

    let r = await api('POST', '/productos', {
      categoria_id: cat.id, unidad_medida_id: kg.id, nombre: 'TMPTC ROJO ' + SUF, precio_kg: 100, multipresentacion: true,
    });
    const paquete = (await api('GET', `/productos/${r.data.id}`)).data.variantes[0];
    await api('POST', '/inventario/movimientos', { variante_id: paquete.id, almacen_id: tienda.id, tipo: 'entrada', cantidad: 40, motivo: 'TMPTC' });
    const cj = (await api('POST', '/caja/cajas', { almacen_id: tienda.id, nombre: 'TMPTC Caja ' + SUF })).data;
    const sesion = (await api('POST', '/caja/sesiones', { caja_id: cj.id, monto_inicial: 1000 })).data;
    ck('hilo, caja con turno y una cuenta de banco de la prueba', !!sesion?.id && cuentaId > 0);

    // Una venta de $1,000: $400 por transferencia a esa cuenta y $600 en efectivo.
    const venta = (await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, items: [{ variante_id: paquete.id, cantidad: 10 }],
      pagos: [{ metodo_pago_id: tr.id, monto: 400, cuenta_bancaria_id: cuentaId }, { metodo_pago_id: ef.id, monto: 600 }],
    })).data;
    ck('venta de $1,000: $400 transferencia y $600 efectivo', Number(venta?.total) === 1000, venta?.total);

    const ver = async () => (await api('GET', `/transferencias?cuenta=${cuentaId}`)).data;
    let d = await ver();
    ck('antes de cancelar: suman $400 (entró, por revisar y su cuenta)',
      d?.cifras?.importe === 400 && d?.cifras?.importe_por_revisar === 400 && d?.por_cuenta?.[0]?.importe === 400,
      d && [d.cifras, d.por_cuenta]);

    r = await api('PATCH', `/pedidos/${venta.id}/estado`, { estado: 'cancelado' });
    ck('se cancela la venta', r.status === 200, r.error);

    d = await ver();
    ck('ya no suma en "Entró por transferencia" ($0, 0 transferencias)', d?.cifras?.importe === 0 && d?.cifras?.cuantas === 0, d?.cifras);
    ck('ni en "Por revisar" ni en "Sin facturar"', d?.cifras?.importe_por_revisar === 0 && d?.cifras?.importe_sin_facturar === 0, d?.cifras);
    ck('ni en "A qué cuenta llegó"', (d?.por_cuenta ?? []).length === 0, d?.por_cuenta);
    ck('se dice aparte: 1 de una venta cancelada por $400', d?.cifras?.canceladas === 1 && d?.cifras?.importe_cancelado === 400, d?.cifras);
    const renglon = (d?.items ?? []).find((x) => r2(x.importe) === 400);
    ck('y su renglón sigue en la lista, marcado como cancelada', !!renglon && renglon.cancelada === true, renglon && { cancelada: renglon.cancelada });

    // AL CANCELAR SE PREGUNTA QUÉ PASA CON EL DINERO (2026-10-26, usuario: "aquí no se
    // regresa dinero la mayor parte; a veces se abona como saldo a favor al cliente").
    console.log('\n=== Lo que pagó queda a su saldo a favor ===');
    const cli = (await api('POST', '/clientes', { nombre: 'TMPTC Cliente ' + SUF, telefono: '4450000050' })).data;
    const saldo = async () => r2((await api('GET', `/clientes/${cli.id}`)).data?.saldo_favor ?? 0);
    const devolucionesCaja = async () => {
      const [rows] = await db.query("SELECT COALESCE(SUM(monto), 0) AS m FROM movimientos_caja WHERE sesion_caja_id = ? AND tipo = 'devolucion'", [sesion.id]);
      return r2(rows[0].m);
    };
    const venta2 = (await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: cli.id, items: [{ variante_id: paquete.id, cantidad: 10 }],
      pagos: [{ metodo_pago_id: tr.id, monto: 400, cuenta_bancaria_id: cuentaId }, { metodo_pago_id: ef.id, monto: 600 }],
    })).data;
    const cajaAntes = await devolucionesCaja();
    r = await api('PATCH', `/pedidos/${venta2.id}/estado`, { estado: 'cancelado', a_favor: { efectivo: true, transferencia: true } });
    ck('se cancela dejándole los dos a su saldo a favor', r.status === 200
      && r.data?.efectivo_a_favor === 600 && r.data?.transferencia_a_favor === 400, r.error ?? [r.data?.efectivo_a_favor, r.data?.transferencia_a_favor]);
    ck('su saldo a favor sube $1,000', (await saldo()) === 1000, await saldo());
    ck('del cajón no sale nada', (await devolucionesCaja()) === cajaAntes, [cajaAntes, await devolucionesCaja()]);
    d = await ver();
    const r2do = (d?.items ?? []).find((x) => (x.ventas ?? []).some((v) => v.id === venta2.id));
    ck('en Transferencias SÍ suma (sigue en el banco) y dice que quedó a favor',
      d?.cifras?.importe === 400 && r2do?.a_favor === true && r2do?.cancelada === false, [d?.cifras?.importe, r2do && { a_favor: r2do.a_favor, cancelada: r2do.cancelada }]);
    r = await api('PATCH', `/pedidos/${venta2.id}/estado`, { estado: 'pagado' });
    ck('esa venta ya no se reactiva (409 VENTA_CON_SALDO_FAVOR)', r.status === 409 && r.error?.code === 'VENTA_CON_SALDO_FAVOR', r.error?.code);

    console.log('\n=== Mitad y mitad: el efectivo sale de la caja, la transferencia queda a favor ===');
    const venta3 = (await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: cli.id, items: [{ variante_id: paquete.id, cantidad: 10 }],
      pagos: [{ metodo_pago_id: tr.id, monto: 300, cuenta_bancaria_id: cuentaId }, { metodo_pago_id: ef.id, monto: 700 }],
    })).data;
    const caja3 = await devolucionesCaja();
    r = await api('PATCH', `/pedidos/${venta3.id}/estado`, { estado: 'cancelado', a_favor: { efectivo: false, transferencia: true } });
    ck('se cancela: $700 salen del cajón y $300 a su saldo a favor', r.status === 200
      && (await devolucionesCaja()) === r2(caja3 + 700) && (await saldo()) === 1300, [r.error, await devolucionesCaja(), await saldo()]);

    // Una venta A CRÉDITO que ya se pagó con abonos a su cuenta (2026-10-26: "opción de
    // regresar dinero o que se vaya como saldo a favor si la nota ya está pagada").
    console.log('\n=== Venta a crédito ya pagada: lo abonado se le regresa o queda a favor ===');
    const deudor = (await api('POST', '/clientes', { nombre: 'TMPTC Credito ' + SUF, telefono: '4450000051', limite_credito: 5000 })).data;
    const saldoDe = async (c) => r2((await api('GET', `/clientes/${c.id}`)).data?.saldo_favor ?? 0);
    const fiadaPagada = async () => {
      const v = (await api('POST', '/pedidos', {
        canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: deudor.id, a_credito: 500,
        items: [{ variante_id: paquete.id, cantidad: 5 }],
      })).data;
      await api('POST', `/clientes/${deudor.id}/abonos`, { monto: 500, metodo_pago_id: ef.id, sesion_caja_id: sesion.id });
      return v;
    };
    let fiada = await fiadaPagada();
    ck('venta a crédito de $500, ya pagada con un abono', (await api('GET', `/pedidos/${fiada.id}`)).data?.estado === 'pagado');
    let cajaF = await devolucionesCaja();
    r = await api('PATCH', `/pedidos/${fiada.id}/estado`, { estado: 'cancelado', abonado_se_regresa: 'efectivo' });
    ck('se cancela regresándole en efectivo: $500 salen del cajón', r.status === 200 && r.data?.abonado_regresado === 500
      && (await devolucionesCaja()) === r2(cajaF + 500), [r.error, r.data?.abonado_regresado, await devolucionesCaja()]);
    ck('y no le queda nada a favor', (await saldoDe(deudor)) === 0, await saldoDe(deudor));
    fiada = await fiadaPagada();
    cajaF = await devolucionesCaja();
    r = await api('PATCH', `/pedidos/${fiada.id}/estado`, { estado: 'cancelado', abonado_se_regresa: 'banco' });
    ck('por el banco: no sale nada del cajón ni le queda a favor', r.status === 200 && r.data?.abonado_regresado === 500
      && (await devolucionesCaja()) === cajaF && (await saldoDe(deudor)) === 0, [r.error, await devolucionesCaja(), await saldoDe(deudor)]);
    fiada = await fiadaPagada();
    r = await api('PATCH', `/pedidos/${fiada.id}/estado`, { estado: 'cancelado' });
    ck('sin decir nada, le queda a favor (como antes)', r.status === 200 && r.data?.abonado_a_favor === 500 && (await saldoDe(deudor)) === 500,
      [r.error, r.data?.abonado_a_favor, await saldoDe(deudor)]);

    console.log('\n=== Sin cliente no hay a quién dejárselo ===');
    const venta4 = (await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, items: [{ variante_id: paquete.id, cantidad: 5 }],
      pagos: [{ metodo_pago_id: ef.id, monto: 500 }],
    })).data;
    const caja4 = await devolucionesCaja();
    r = await api('PATCH', `/pedidos/${venta4.id}/estado`, { estado: 'cancelado', a_favor: { efectivo: true } });
    ck('el efectivo sale de la caja como siempre', r.status === 200 && (await devolucionesCaja()) === r2(caja4 + 500) && !r.data?.efectivo_a_favor,
      [r.error, await devolucionesCaja()]);
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    console.log('\nLimpiando…');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    const [prods] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPTC %'");
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
    if (vids.length) {
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) {
        await db.query(`DELETE FROM ${tb} WHERE variante_id IN (?)`, [vids]);
      }
      await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
    }
    if (pr.length) await db.query('DELETE FROM productos WHERE id IN (?)', [pr]);
    const [cls] = await db.query("SELECT id FROM clientes WHERE nombre LIKE 'TMPTC %'");
    if (cls.length) {
      const cids = cls.map((x) => x.id);
      for (const tb of ['credito_movimientos', 'saldo_favor_movimientos']) await db.query(`DELETE FROM ${tb} WHERE cliente_id IN (?)`, [cids]);
      await db.query('DELETE FROM clientes WHERE id IN (?)', [cids]);
    }
    const [cjs] = await db.query("SELECT id FROM cajas WHERE nombre LIKE 'TMPTC Caja%'");
    if (cjs.length) {
      const [ses] = await db.query('SELECT id FROM sesiones_caja WHERE caja_id IN (?)', [cjs.map((x) => x.id)]);
      await borrarTurnosPropios(db, ses.map((x) => x.id));
      await borrarCajasSinTurnos(db, cjs.map((x) => x.id));
    }
    await db.query("DELETE FROM cuentas_bancarias WHERE titular = 'TMPTC'");
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    const [[{ n }]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPTC %') + (SELECT COUNT(*) FROM cajas WHERE nombre LIKE 'TMPTC Caja%')
            + (SELECT COUNT(*) FROM cuentas_bancarias WHERE titular = 'TMPTC') + (SELECT COUNT(*) FROM clientes WHERE nombre LIKE 'TMPTC %') AS n`
    );
    ck('no quedó basura (TMPTC)', Number(n) === 0, n);
    await db.end();
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
