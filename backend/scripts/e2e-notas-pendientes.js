'use strict';

/**
 * Prueba de las NOTAS PENDIENTES DE PAGO y el nuevo "Total a cobrar"
 * (2026-10-13): "en total a cobrar es cobrar, a crédito, nota en espera y nota
 * pendiente de forma de pago (sale el ticket pero aún no se registra cómo te
 * pagó hasta después)… que exista un apartado de notas pendientes de pago de
 * los clientes y que se agreguen al corte de caja del día en que paguen, o si
 * el cliente pide que se vaya a crédito que exista esa opción" (usuario).
 *
 *   · la nota pendiente exige cliente, no lleva pago ni crédito, la mercancía
 *     SALE del inventario (y su paquete queda vendido) y no deja nada en caja;
 *   · aparece en Notas pendientes de pago; se paga en abonos: el efectivo entra
 *     al turno como 'ingreso' (al corte de ese día), la transferencia no toca
 *     la caja; con el último abono queda pagada sola;
 *   · a mano no se marca pagada debiéndose;
 *   · se pasa a crédito lo que FALTA, con el límite del cliente;
 *   · una nota en espera se entrega como pendiente de pago;
 *   · tarjeta y los demás métodos desactivados ya no cobran.
 *
 * Crea "TMPNP …" (hilo, clientes, caja y turno) y lo borra al final.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-notas-pendientes.js   # contra la base de pruebas
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
  const inv = async (v, a) => {
    const [[x]] = await db.query('SELECT cantidad, cantidad_reservada FROM inventario WHERE variante_id = ? AND almacen_id = ?', [v, a]);
    return { cantidad: r3(x?.cantidad ?? 0), reservada: r3(x?.cantidad_reservada ?? 0) };
  };
  const caja = async (s) => {
    const [rows] = await db.query('SELECT tipo, monto FROM movimientos_caja WHERE sesion_caja_id = ? ORDER BY id', [s]);
    return rows.map((x) => `${x.tipo}:${r2(x.monto)}`);
  };
  const estadoBulto = async (c) => {
    const [[x]] = await db.query('SELECT estado FROM variante_codigos WHERE codigo = ?', [c]);
    return x?.estado;
  };
  const estado = async (id) => {
    const [[x]] = await db.query('SELECT estado, nota_pendiente FROM pedidos WHERE id = ?', [id]);
    return `${x.estado}/${x.nota_pendiente}`;
  };

  try {
    const [[cat]] = await db.query('SELECT id FROM categorias ORDER BY id LIMIT 1');
    const [[kg]] = await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");
    const [[efectivo]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Efectivo%' ORDER BY id LIMIT 1");
    const [[transferencia]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Transferencia%' ORDER BY id LIMIT 1");
    const [[tarjeta]] = await db.query("SELECT id, activo FROM metodos_pago WHERE nombre LIKE 'Tarjeta%' ORDER BY id LIMIT 1");

    let r = await api('POST', '/productos', {
      categoria_id: cat.id, unidad_medida_id: kg.id, nombre: 'TMPNP ROJO ' + SUF, precio_kg: 100, multipresentacion: true,
    });
    const paquete = (await api('GET', `/productos/${r.data.id}`)).data.variantes[0];
    const almacen = (await api('GET', '/caja/cajas')).data.find((c) => c.activo).almacen_id;
    const cj = (await api('POST', '/caja/cajas', { almacen_id: almacen, nombre: 'TMPNP Caja ' + SUF })).data;
    const sesion = (await api('POST', '/caja/sesiones', { caja_id: cj.id, monto_inicial: 0 })).data;
    await api('POST', '/inventario/movimientos', { variante_id: paquete.id, almacen_id: almacen, tipo: 'entrada', cantidad: 40, motivo: 'TMPNP' });
    await api('PATCH', `/variantes/${paquete.id}`, { peso_kg: 19 });
    const COD = `TMPNP-${SUF}-1`;
    await api('POST', `/variantes/${paquete.id}/codigos`, { codigo: COD, peso_kg: 18.5, conos: 12, lote: 'L1', almacen_id: almacen });
    const cli = (await api('POST', '/clientes', { nombre: 'TMPNP Doña Chela ' + SUF, telefono: '4450000001', limite_credito: 5000 })).data;
    const sinCredito = (await api('POST', '/clientes', { nombre: 'TMPNP Sin crédito ' + SUF, telefono: '4450000002' })).data;
    ck('hilo a $100/kg con 58.5 kg (un paquete de 18.5), caja, turno y clientes',
      !!paquete && !!sesion?.id && !!cli?.id && !!sinCredito?.id && (await inv(paquete.id, almacen)).cantidad === 58.5,
      await inv(paquete.id, almacen));

    const base = { canal: 'punto_venta', sesion_caja_id: sesion.id, pendiente_pago: true };

    console.log('\n=== 1. Lo que no se deja ===');
    r = await api('POST', '/pedidos', { ...base, items: [{ variante_id: paquete.id, cantidad: 5 }] });
    ck('sin cliente: 422 NOTA_SIN_CLIENTE', r.status === 422 && r.error?.code === 'NOTA_SIN_CLIENTE', r.error?.code);
    r = await api('POST', '/pedidos', { ...base, cliente_id: cli.id, pagos: [{ metodo_pago_id: efectivo.id, monto: 100 }], items: [{ variante_id: paquete.id, cantidad: 5 }] });
    ck('con un pago: 422 NOTA_PENDIENTE_CON_PAGO', r.status === 422 && r.error?.code === 'NOTA_PENDIENTE_CON_PAGO', r.error?.code);
    r = await api('POST', '/pedidos', { ...base, cliente_id: cli.id, a_credito: 100, items: [{ variante_id: paquete.id, cantidad: 5 }] });
    ck('con crédito: 422 NOTA_PENDIENTE_COMBINADA', r.status === 422 && r.error?.code === 'NOTA_PENDIENTE_COMBINADA', r.error?.code);
    r = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, items: [{ variante_id: paquete.id, cantidad: 1 }],
      pagos: [{ metodo_pago_id: tarjeta.id, monto: 100 }],
    });
    ck('con tarjeta (desactivada): 422 METODO_PAGO_INVALIDO', !Number(tarjeta.activo) && r.status === 422 && r.error?.code === 'METODO_PAGO_INVALIDO',
      [tarjeta.activo, r.error?.code]);
    // "Saldo a favor" (2026-10-13) está activo pero es interno: no se ofrece.
    r = await api('GET', '/opciones/metodos-pago');
    ck('solo se ofrecen efectivo y transferencia', r.data?.length === 2, r.data?.map((x) => x.nombre));

    console.log('\n=== 2. Doña Chela se lleva el paquete (18.5 kg) y 5 kg sueltos, y paga después ===');
    r = await api('POST', '/pedidos', {
      ...base, cliente_id: cli.id,
      items: [{ variante_id: paquete.id, cantidad: 23.5, bultos: [{ codigo: COD, peso_kg: 18.5 }] }],
    });
    const n1 = r.data;
    ck('sale la nota: pendiente y marcada como nota', r.status === 201 && n1?.estado === 'pendiente' && Number(n1?.nota_pendiente) === 1,
      r.error ?? [n1?.estado, n1?.nota_pendiente]);
    ck('total $2,350', Number(n1?.total) === 2350, n1?.total);
    ck('la mercancía SALE: 58.5 − 23.5 = 35, y el paquete queda vendido',
      (await inv(paquete.id, almacen)).cantidad === 35 && (await estadoBulto(COD)) === 'vendido',
      [await inv(paquete.id, almacen), await estadoBulto(COD)]);
    ck('no entra nada a la caja', JSON.stringify(await caja(sesion.id)) === '[]', await caja(sesion.id));
    const [[cargos]] = await db.query("SELECT COUNT(*) AS n FROM credito_movimientos WHERE pedido_id = ?", [n1.id]);
    ck('no es crédito: no le carga nada a su cuenta', Number(cargos.n) === 0, cargos.n);

    r = await api('GET', '/pedidos/notas-pendientes');
    let fila = r.data?.items?.find((x) => x.id === n1.id);
    ck('aparece en Notas pendientes de pago: falta todo, con lo que se llevó',
      r.status === 200 && fila?.falta === 2350 && fila?.hilos?.[0]?.paquetes === 1 && fila?.hilos?.[0]?.kg === 23.5,
      r.error ?? fila);
    ck('las cifras de arriba la cuentan', r.data?.num_notas >= 1 && r.data?.por_cobrar >= 2350, [r.data?.num_notas, r.data?.por_cobrar]);
    r = await api('GET', `/pedidos/notas-pendientes?q=${encodeURIComponent('Doña Chela ' + SUF)}`);
    ck('se encuentra por el nombre del cliente', r.data?.items?.length === 1 && r.data.items[0].id === n1.id, r.data?.items?.length);
    r = await api('GET', '/notificaciones');
    ck('la campana la avisa', (r.data?.notas_pendientes?.num ?? 0) >= 1 && (r.data?.notas_pendientes?.monto ?? 0) >= 2350, r.data?.notas_pendientes);

    r = await api('PATCH', `/pedidos/${n1.id}/estado`, { estado: 'pagado' });
    ck('a mano no se marca pagada: 409 NOTA_PENDIENTE_SIN_PAGAR', r.status === 409 && r.error?.code === 'NOTA_PENDIENTE_SIN_PAGAR', r.error?.code);

    console.log('\n=== 3. Paga en abonos: $1,000 en efectivo hoy y el resto por transferencia ===');
    r = await api('POST', `/pedidos/${n1.id}/abonos`, { monto: 1000, metodo_pago_id: efectivo.id });
    ck('en efectivo sin turno: 409 FALTA_SESION_CAJA', r.status === 409 && r.error?.code === 'FALTA_SESION_CAJA', r.error?.code);
    r = await api('POST', `/pedidos/${n1.id}/abonos`, { monto: 1000, metodo_pago_id: efectivo.id, sesion_caja_id: sesion.id });
    ck('abona $1,000: le faltan $1,350', r.status === 201 && r.data?.pendiente === 1350 && !r.data?.liquidado, r.error ?? r.data);
    ck('el efectivo entra al turno como ingreso (al corte de hoy)', JSON.stringify(await caja(sesion.id)) === JSON.stringify(['ingreso:1000']),
      await caja(sesion.id));
    ck('sigue pendiente', (await estado(n1.id)) === 'pendiente/1', await estado(n1.id));
    r = await api('POST', `/pedidos/${n1.id}/abonos`, { monto: 2000, metodo_pago_id: transferencia.id });
    ck('no se abona más de lo que falta: 422', r.status === 422 && r.error?.code === 'ABONO_EXCEDE_PENDIENTE', r.error?.code);
    r = await api('POST', `/pedidos/${n1.id}/abonos`, { monto: 1350, metodo_pago_id: transferencia.id, referencia: 'TMPNP folio' });
    ck('con la transferencia queda liquidada', r.status === 201 && r.data?.liquidado === true, r.error ?? r.data);
    ck('y PAGADA sola (sigue marcada como nota)', (await estado(n1.id)) === 'pagado/1', await estado(n1.id));
    ck('la transferencia no toca la caja', JSON.stringify(await caja(sesion.id)) === JSON.stringify(['ingreso:1000']), await caja(sesion.id));
    r = await api('GET', '/pedidos/notas-pendientes');
    ck('ya no está en Notas pendientes', !r.data?.items?.some((x) => x.id === n1.id));
    r = await api('POST', `/pedidos/${n1.id}/abonos`, { monto: 1, metodo_pago_id: transferencia.id });
    ck('a una nota pagada ya no se le abona: 409', r.status === 409, r.error?.code);
    r = await api('GET', '/pedidos?q=' + encodeURIComponent(n1.numero_pedido));
    fila = r.data?.items?.find((x) => x.id === n1.id) ?? r.data?.find?.((x) => x.id === n1.id);
    ck('en Ventas sale marcada como nota y sin falta', Number(fila?.nota_pendiente) === 1 && Number(fila?.falta) === 0, fila);

    console.log('\n=== 4. Otra nota de $500 que pide pasar a crédito ===');
    r = await api('POST', '/pedidos', { ...base, cliente_id: cli.id, items: [{ variante_id: paquete.id, cantidad: 5 }] });
    const n2 = r.data;
    ck('sale la nota de $500', r.status === 201 && Number(n2?.total) === 500, r.error ?? n2?.total);
    await api('POST', `/pedidos/${n2.id}/abonos`, { monto: 200, metodo_pago_id: transferencia.id });
    r = await api('POST', `/pedidos/${n2.id}/a-credito`, {});
    ck('se pasa a crédito: se cargan los $300 que faltan', r.status === 200 && r.data?.a_credito === 300 && r.data?.estado === 'pendiente',
      r.error ?? [r.data?.a_credito, r.data?.estado]);
    const [[saldo]] = await db.query('SELECT saldo FROM v_clientes_saldo WHERE cliente_id = ?', [cli.id]);
    ck('el cliente debe $300 en su cuenta', r2(saldo.saldo) === 300, saldo.saldo);
    r = await api('GET', '/pedidos/notas-pendientes');
    ck('sale de Notas pendientes (ahora se cobra en su cuenta)', !r.data?.items?.some((x) => x.id === n2.id));
    r = await api('POST', `/pedidos/${n2.id}/a-credito`, {});
    ck('no se pasa dos veces: 409', r.status === 409 && r.error?.code === 'NO_ES_NOTA_PENDIENTE', r.error?.code);
    r = await api('POST', `/clientes/${cli.id}/abonos`, { monto: 300, metodo_pago_id: transferencia.id });
    ck('al abonar los $300 a su cuenta, la nota queda pagada', r.status === 201 && (await estado(n2.id)) === 'pagado/1', r.error ?? await estado(n2.id));

    console.log('\n=== 5. Un cliente sin crédito no puede pasarla a crédito ===');
    r = await api('POST', '/pedidos', { ...base, cliente_id: sinCredito.id, items: [{ variante_id: paquete.id, cantidad: 2 }] });
    const n3 = r.data;
    r = await api('POST', `/pedidos/${n3.id}/a-credito`, {});
    ck('409 SIN_CREDITO, y la nota sigue pendiente', r.status === 409 && r.error?.code === 'SIN_CREDITO' && (await estado(n3.id)) === 'pendiente/1',
      r.error?.code);

    console.log('\n=== 6. Cancelar una nota con un abono en efectivo ===');
    r = await api('POST', `/pedidos/${n3.id}/abonos`, { monto: 50, metodo_pago_id: efectivo.id, sesion_caja_id: sesion.id });
    const antes = (await inv(paquete.id, almacen)).cantidad;
    r = await api('PATCH', `/pedidos/${n3.id}/estado`, { estado: 'cancelado' });
    ck('se cancela: regresa la mercancía (2 kg) y sale el efectivo del turno',
      r.status === 200 && (await inv(paquete.id, almacen)).cantidad === r3(antes + 2) &&
        (await caja(sesion.id)).at(-1) === 'devolucion:50',
      r.error ?? [await inv(paquete.id, almacen), await caja(sesion.id)]);

    console.log('\n=== 7. Una nota en espera que se entrega como pendiente de pago ===');
    r = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, encargo: true, cliente_id: cli.id,
      items: [{ variante_id: paquete.id, cantidad: 3 }],
    });
    const e1 = r.data;
    ck('se guarda en espera (aparta 3 kg)', r.status === 201 && e1?.estado === 'en_preparacion' && (await inv(paquete.id, almacen)).reservada === 3,
      r.error ?? await inv(paquete.id, almacen));
    r = await api('POST', `/pedidos/${e1.id}/entregar`, { pendiente_pago: true, a_credito: 100 });
    ck('pendiente de pago y fiado a la vez: 422', r.status === 422 && r.error?.code === 'NOTA_PENDIENTE_COMBINADA', r.error?.code);
    const antes7 = (await inv(paquete.id, almacen)).cantidad;
    r = await api('POST', `/pedidos/${e1.id}/entregar`, { pendiente_pago: true });
    ck('se entrega como nota pendiente: sale del inventario y queda por cobrar',
      r.status === 200 && (await estado(e1.id)) === 'pendiente/1' && (await inv(paquete.id, almacen)).cantidad === r3(antes7 - 3) &&
        (await inv(paquete.id, almacen)).reservada === 0,
      r.error ?? [await estado(e1.id), await inv(paquete.id, almacen)]);
    r = await api('GET', '/pedidos/notas-pendientes');
    ck('y aparece en Notas pendientes por $300', r.data?.items?.find((x) => x.id === e1.id)?.falta === 300);
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    console.log('\nLimpiando…');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    const [cls] = await db.query("SELECT id FROM clientes WHERE nombre LIKE 'TMPNP %'");
    const cids = cls.map((x) => x.id);
    const [prods] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPNP %'");
    const pr = prods.map((x) => x.id);
    const [vs] = pr.length ? await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [pr]) : [[]];
    const vids = vs.map((v) => v.id);
    const [peds] = vids.length
      ? await db.query('SELECT DISTINCT pedido_id FROM pedido_detalle WHERE variante_id IN (?)', [vids])
      : [[]];
    const pids = peds.map((x) => x.pedido_id);
    if (pids.length) {
      await db.query('DELETE b FROM pedido_detalle_bultos b JOIN pedido_detalle d ON d.id = b.detalle_id WHERE d.pedido_id IN (?)', [pids]);
      for (const tb of ['pagos', 'pedido_detalle']) await db.query(`DELETE FROM ${tb} WHERE pedido_id IN (?)`, [pids]);
      await db.query('DELETE FROM credito_movimientos WHERE pedido_id IN (?)', [pids]);
      await db.query('DELETE FROM pedidos WHERE id IN (?)', [pids]);
    }
    if (cids.length) {
      await db.query('DELETE FROM credito_movimientos WHERE cliente_id IN (?)', [cids]);
      await db.query('DELETE FROM clientes WHERE id IN (?)', [cids]);
    }
    if (vids.length) {
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) {
        await db.query(`DELETE FROM ${tb} WHERE variante_id IN (?)`, [vids]);
      }
      await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
    }
    if (pr.length) await db.query('DELETE FROM productos WHERE id IN (?)', [pr]);
    const [cjs] = await db.query("SELECT id FROM cajas WHERE nombre LIKE 'TMPNP Caja%'");
    if (cjs.length) {
      const [ses] = await db.query('SELECT id FROM sesiones_caja WHERE caja_id IN (?)', [cjs.map((x) => x.id)]);
      await borrarTurnosPropios(db, ses.map((x) => x.id));
      await borrarCajasSinTurnos(db, cjs.map((x) => x.id));
    }
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    const [[{ n }]] = await db.query(
      "SELECT (SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPNP %') + (SELECT COUNT(*) FROM clientes WHERE nombre LIKE 'TMPNP %') + (SELECT COUNT(*) FROM cajas WHERE nombre LIKE 'TMPNP Caja%') AS n"
    );
    ck('no quedó basura (TMPNP)', Number(n) === 0, n);
    await db.end();
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
