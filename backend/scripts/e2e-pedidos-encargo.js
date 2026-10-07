'use strict';

/**
 * Prueba de los PEDIDOS de clientes (encargos) (2026-10-06): "tenemos chofer que
 * los lleva, o hacen el pedido por WhatsApp y después van por él; no es un
 * apartado, es una venta" (usuario).
 *
 *   · se toma en el mostrador con el cliente; la mercancía se APARTA (no se
 *     descuenta) y nadie más la vende;
 *   · queda LISTO al PREPARARLO: se escanean los paquetes que van (quedan
 *     apartados para él) y se pesa lo que va por kilo; el total queda con el
 *     peso real (si pesó menos de lo que pagó, se le devuelve al entregar);
 *   · pasa por preparar → listo → en camino (solo si lo lleva el chofer);
 *   · al ENTREGARLO se cobra lo que falta (el efectivo entra al turno, con
 *     cambio) o se fía, y ahí sale del inventario;
 *   · cancelado libera lo apartado y devuelve lo que dejó; se reactiva solo como
 *     "por preparar";
 *   · los paquetes escaneados al tomar un pedido o un APARTADO quedan apartados
 *     y pasan a vendidos al entregarlo.
 *
 * Crea "TMPPE …" (hilo, cliente, caja y turno) y lo borra al final.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-pedidos-encargo.js   # contra la base de pruebas
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

  try {
    const [[cat]] = await db.query('SELECT id FROM categorias ORDER BY id LIMIT 1');
    const [[kg]] = await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");
    const [[efectivo]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Efectivo%' ORDER BY id LIMIT 1");
    const [[transferencia]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Transferencia%' ORDER BY id LIMIT 1");

    // Hilo, caja y cliente de la prueba.
    let r = await api('POST', '/productos', {
      categoria_id: cat.id, unidad_medida_id: kg.id, nombre: 'TMPPE ROJO ' + SUF, precio_kg: 100, multipresentacion: true,
    });
    const paquete = (await api('GET', `/productos/${r.data.id}`)).data.variantes[0];
    const almacen = (await api('GET', '/caja/cajas')).data.find((c) => c.activo).almacen_id;
    const cj = (await api('POST', '/caja/cajas', { almacen_id: almacen, nombre: 'TMPPE Caja ' + SUF })).data;
    const sesion = (await api('POST', '/caja/sesiones', { caja_id: cj.id, monto_inicial: 0 })).data;
    await api('POST', '/inventario/movimientos', { variante_id: paquete.id, almacen_id: almacen, tipo: 'entrada', cantidad: 100, motivo: 'TMPPE' });
    const cli = (await api('POST', '/clientes', { nombre: 'TMPPE Mercería ' + SUF, telefono: '4450000000', limite_credito: 5000 })).data;
    ck('hilo a $100/kg con 100 kg, caja, turno y cliente con crédito', !!paquete && !!sesion?.id && !!cli?.id);

    const base = { canal: 'punto_venta', sesion_caja_id: sesion.id, encargo: true };

    // Cinco paquetes del ROJO, con su peso real, y un hilo que va POR KILO.
    const PESOS = [19.2, 18.6, 20.1, 19.5, 10.75];
    await api('PATCH', `/variantes/${paquete.id}`, { peso_kg: 19 });
    const cod = PESOS.map((_, i) => `TMPPE-${SUF}-${i + 1}`);
    for (let i = 0; i < PESOS.length; i++) {
      await api('POST', `/variantes/${paquete.id}/codigos`, { codigo: cod[i], peso_kg: PESOS[i], conos: 12, lote: 'L1' });
    }
    r = await api('POST', '/productos', {
      categoria_id: cat.id, unidad_medida_id: kg.id, nombre: 'TMPPE NEGRO ' + SUF, precio_kg: 80, multipresentacion: false,
    });
    const kilo = (await api('GET', `/productos/${r.data.id}`)).data.variantes[0];
    await api('POST', '/inventario/movimientos', { variante_id: kilo.id, almacen_id: almacen, tipo: 'entrada', cantidad: 50, motivo: 'TMPPE' });
    const estadoBulto = async (c) => {
      const [[x]] = await db.query('SELECT estado FROM variante_codigos WHERE codigo = ?', [c]);
      return x?.estado;
    };
    ck('5 paquetes con su peso y un hilo por kilo a $80 con 50 kg', kilo?.tipo_presentacion === 'simple' && (await estadoBulto(cod[4])) === 'disponible',
      kilo?.tipo_presentacion);

    console.log('\n=== 1. Lo que no se deja ===');
    r = await api('POST', '/pedidos', { ...base, items: [{ variante_id: paquete.id, cantidad: 5 }] });
    ck('sin cliente: 422 PEDIDO_SIN_CLIENTE', r.status === 422 && r.error?.code === 'PEDIDO_SIN_CLIENTE', r.error?.code);
    r = await api('POST', '/pedidos', { ...base, cliente_id: cli.id, a_credito: 100, items: [{ variante_id: paquete.id, cantidad: 5 }] });
    ck('fiarlo al tomarlo: 422 PEDIDO_A_CREDITO', r.status === 422 && r.error?.code === 'PEDIDO_A_CREDITO', r.error?.code);
    r = await api('POST', '/pedidos', { ...base, cliente_id: cli.id, metodo_entrega: 'envio', items: [{ variante_id: paquete.id, cantidad: 5 }] });
    ck('con chofer y sin dirección: 422 FALTA_DIRECCION', r.status === 422 && r.error?.code === 'FALTA_DIRECCION', r.error?.code);

    console.log('\n=== 2. Lo pide por WhatsApp: "2 paquetes de rojo", ≈ 38 kg ===');
    r = await api('POST', '/pedidos', {
      ...base, cliente_id: cli.id, entrega_para: '2030-01-15', notas: 'TMPPE pasa en la tarde',
      items: [{ variante_id: paquete.id, cantidad: 38 }],
    });
    const p1 = r.data;
    ck('se toma: queda "por preparar"', r.status === 201 && p1?.estado === 'en_preparacion' && Number(p1?.encargo) === 1, r.error ?? p1?.estado);
    ck('total $3,800 (aproximado) y para el 15 de enero', Number(p1?.total) === 3800 && p1?.entrega_para === '2030-01-15', [p1?.total, p1?.entrega_para]);
    ck('la mercancía se aparta, no se descuenta', JSON.stringify(await inv(paquete.id, almacen)) === JSON.stringify({ cantidad: 100, reservada: 38 }),
      await inv(paquete.id, almacen));
    r = await api('POST', '/pedidos', { canal: 'punto_venta', sesion_caja_id: sesion.id, items: [{ variante_id: paquete.id, cantidad: 90 }], pagos: [{ metodo_pago_id: efectivo.id, monto: 9000 }] });
    ck('el mostrador no se vende lo del pedido (quedan 62 libres): 409', r.status === 409 && r.error?.code === 'STOCK_INSUFICIENTE', r.error?.code);
    r = await api('GET', '/pedidos/encargos');
    let enLista = r.data?.items?.find((x) => x.id === p1.id);
    ck('aparece en Pedidos: falta todo, ≈ 2 paquetes sin escanear', enLista && enLista.falta === 3800 && enLista.hilos?.[0]?.paquetes === 2 &&
      enLista.hilos?.[0]?.escaneados === 0 && enLista.telefono === '4450000000', enLista && { falta: enLista.falta, hilos: enLista.hilos });

    console.log('\n=== 3. Se PREPARA: se escanean los paquetes que van ===');
    const linea1 = (await api('GET', `/pedidos/${p1.id}`)).data.detalle[0].id;
    r = await api('PATCH', `/pedidos/${p1.id}/estado`, { estado: 'listo' });
    ck('marcarlo listo a mano no se puede: se prepara (409)', r.status === 409 && r.error?.code === 'PEDIDO_SE_PREPARA', r.error?.code);
    r = await api('POST', `/pedidos/${p1.id}/entregar`, { pagos: [{ metodo_pago_id: efectivo.id, monto: 3800 }], sesion_caja_id: sesion.id });
    ck('sin prepararlo no se entrega (409)', r.status === 409 && r.error?.code === 'PEDIDO_SIN_PREPARAR', r.error?.code);
    r = await api('POST', `/pedidos/${p1.id}/preparar`, { lineas: [{ detalle_id: linea1, codigos: [] }] });
    ck('el paquete sin escanear no queda listo: 422 SIN_ESCANEAR', r.status === 422 && r.error?.code === 'SIN_ESCANEAR', r.error?.code);
    r = await api('POST', `/pedidos/${p1.id}/preparar`, { lineas: [{ detalle_id: linea1, codigos: ['NO-EXISTE-' + SUF] }] });
    ck('un código que no existe: 422', r.status === 422 && r.error?.code === 'CODIGO_DESCONOCIDO', r.error?.code);
    r = await api('POST', `/pedidos/${p1.id}/preparar`, { lineas: [{ detalle_id: linea1, codigos: [cod[0], cod[0]] }] });
    ck('el mismo paquete dos veces: 422', r.status === 422 && r.error?.code === 'BULTO_REPETIDO', r.error?.code);
    r = await api('POST', `/pedidos/${p1.id}/preparar`, { lineas: [{ detalle_id: linea1, codigos: [cod[0], cod[1]] }] });
    ck('con 2 paquetes (19.2 + 18.6): listo con 37.8 kg y $3,780', r.status === 200 && r.data?.estado === 'listo' &&
      Number(r.data?.detalle?.[0]?.cantidad) === 37.8 && Number(r.data?.total) === 3780 && r.data?.total_antes === 3800,
      r.error ?? [r.data?.estado, r.data?.detalle?.[0]?.cantidad, r.data?.total]);
    ck('lo apartado sigue a los kilos (37.8)', (await inv(paquete.id, almacen)).reservada === 37.8, await inv(paquete.id, almacen));
    ck('esos paquetes quedan APARTADOS', (await estadoBulto(cod[0])) === 'apartado' && (await estadoBulto(cod[1])) === 'apartado');
    r = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, pagos: [{ metodo_pago_id: efectivo.id, monto: 2000 }],
      items: [{ variante_id: paquete.id, cantidad: 19.2, bultos: [{ codigo: cod[0], peso_kg: 19.2 }] }],
    });
    ck('el mostrador no vende un paquete apartado: 409 que dice para quién', r.status === 409 && r.error?.code === 'BULTO_NO_DISPONIBLE' &&
      /apartado para el pedido/.test(r.error?.message ?? ''), r.error);
    r = await api('GET', '/pedidos/encargos?estado=listo');
    enLista = r.data?.items?.find((x) => x.id === p1.id);
    ck('en Pedidos: listo, 2 paquetes escaneados', enLista?.hilos?.[0]?.escaneados === 2 && enLista?.hilos?.[0]?.paquetes === 2, enLista?.hilos);

    r = await api('POST', `/pedidos/${p1.id}/preparar`, { lineas: [{ detalle_id: linea1, codigos: [cod[1], cod[2]] }] });
    ck('se corrige: van el 2 y el 3 (38.7 kg, $3,870)', r.status === 200 && Number(r.data?.total) === 3870 &&
      r.data?.detalle?.[0]?.bultos?.map((b) => b.codigo).sort().join() === [cod[1], cod[2]].sort().join(), r.error ?? r.data?.detalle?.[0]?.bultos);
    ck('el 1 se suelta y el 3 se aparta', (await estadoBulto(cod[0])) === 'disponible' && (await estadoBulto(cod[2])) === 'apartado');
    ck('apartado: 38.7', (await inv(paquete.id, almacen)).reservada === 38.7, await inv(paquete.id, almacen));
    r = await api('PATCH', `/pedidos/${p1.id}/estado`, { estado: 'enviado' });
    ck('lo recoge el cliente: no sale con el chofer (409)', r.status === 409 && r.error?.code === 'PEDIDO_SE_RECOGE', r.error?.code);
    r = await api('PATCH', `/pedidos/${p1.id}/estado`, { estado: 'entregado' });
    ck('entregarlo a mano no se puede: se entrega cobrando (409)', r.status === 409 && r.error?.code === 'PEDIDO_SE_ENTREGA', r.error?.code);

    console.log('\n=== 4. Paga una parte por transferencia y el resto al recogerlo ===');
    r = await api('POST', `/pedidos/${p1.id}/abonos`, { monto: 500, metodo_pago_id: transferencia.id, referencia: 'SPEI-TMPPE' });
    ck('abona $500 por transferencia', r.status === 201 && r.data?.pendiente === 3370, r.error ?? r.data);
    r = await api('POST', `/pedidos/${p1.id}/entregar`, { pagos: [{ metodo_pago_id: efectivo.id, monto: 1000 }], sesion_caja_id: sesion.id });
    ck('con menos de lo que falta no se entrega: 409 PAGO_INSUFICIENTE', r.status === 409 && r.error?.code === 'PAGO_INSUFICIENTE', r.error?.code);
    ck('…y nada se movió', JSON.stringify(await inv(paquete.id, almacen)) === JSON.stringify({ cantidad: 100, reservada: 38.7 }));
    r = await api('POST', `/pedidos/${p1.id}/entregar`, { pagos: [{ metodo_pago_id: efectivo.id, monto: 3400 }], sesion_caja_id: sesion.id });
    ck('paga con $3,400: se entrega y lleva $30 de cambio', r.status === 200 && r.data?.estado === 'entregado' && r.data?.cambio === 30, r.error ?? [r.data?.estado, r.data?.cambio]);
    ck('sale del inventario el peso real (61.3 kg, nada apartado)', JSON.stringify(await inv(paquete.id, almacen)) === JSON.stringify({ cantidad: 61.3, reservada: 0 }),
      await inv(paquete.id, almacen));
    ck('sus paquetes quedan VENDIDOS', (await estadoBulto(cod[1])) === 'vendido' && (await estadoBulto(cod[2])) === 'vendido');
    ck('al cajón entran $3,370 como ingreso', JSON.stringify(await caja(sesion.id)) === JSON.stringify(['ingreso:3370']), await caja(sesion.id));
    r = await api('PATCH', `/pedidos/${p1.id}/estado`, { estado: 'listo' });
    ck('entregado ya no regresa a prepararse (409)', r.status === 409 && r.error?.code === 'PEDIDO_YA_ENTREGADO', r.error?.code);
    r = await api('POST', `/pedidos/${p1.id}/preparar`, { lineas: [{ detalle_id: linea1, codigos: [cod[0]] }] });
    ck('ni se vuelve a preparar (409)', r.status === 409 && r.error?.code === 'NO_SE_PREPARA', r.error?.code);

    console.log('\n=== 5. Por kilo: "6 conos de negro", lo lleva el chofer y se fía ===');
    r = await api('POST', '/pedidos', {
      ...base, cliente_id: cli.id, metodo_entrega: 'envio', entrega_direccion: 'Calle TMPPE 12, Moroleón', costo_envio: 50,
      items: [{ variante_id: kilo.id, cantidad: 10, piezas: 6 }],
    });
    const p2 = r.data;
    ck('pedido con chofer: ≈ $800 + $50 de envío', r.status === 201 && Number(p2?.total) === 850 && p2?.entrega_direccion === 'Calle TMPPE 12, Moroleón',
      r.error ?? [p2?.total, p2?.entrega_direccion]);
    const linea2 = p2.detalle[0].id;
    r = await api('PATCH', `/pedidos/${p2.id}/estado`, { estado: 'enviado' });
    ck('sin prepararlo no sale con el chofer (409)', r.status === 409 && r.error?.code === 'PEDIDO_SE_PREPARA', r.error?.code);
    r = await api('POST', `/pedidos/${p2.id}/preparar`, { lineas: [{ detalle_id: linea2, cantidad: 999 }] });
    ck('si no hay tanto, no queda: 409 STOCK_INSUFICIENTE', r.status === 409 && r.error?.code === 'STOCK_INSUFICIENTE', r.error?.code);
    r = await api('POST', `/pedidos/${p2.id}/preparar`, { lineas: [{ detalle_id: linea2, cantidad: 9.5, piezas: 6 }] });
    ck('se pesan: 9.5 kg → $760 + $50 = $810', r.status === 200 && Number(r.data?.total) === 810 && r.data?.falta === 810 &&
      Number(r.data?.detalle?.[0]?.piezas) === 6, r.error ?? [r.data?.total, r.data?.falta]);
    ck('lo apartado del negro: 9.5', (await inv(kilo.id, almacen)).reservada === 9.5, await inv(kilo.id, almacen));
    r = await api('PATCH', `/pedidos/${p2.id}/estado`, { estado: 'enviado' });
    ck('ya preparado, sale con el chofer', r.status === 200 && r.data?.estado === 'enviado', r.error);
    r = await api('POST', `/pedidos/${p2.id}/entregar`, { a_credito: 810 });
    ck('se entrega fiado: queda pendiente de pago', r.status === 200 && r.data?.estado === 'pendiente', r.error ?? r.data?.estado);
    const [[cargo]] = await db.query("SELECT monto FROM credito_movimientos WHERE pedido_id = ? AND tipo = 'cargo'", [p2.id]);
    ck('y la deuda queda en su cuenta ($810)', r2(cargo?.monto) === 810, cargo?.monto);
    ck('sale del inventario lo que pesó (40.5 kg)', JSON.stringify(await inv(kilo.id, almacen)) === JSON.stringify({ cantidad: 40.5, reservada: 0 }),
      await inv(kilo.id, almacen));

    console.log('\n=== 6. Pagó todo por adelantado y pesó MENOS ===');
    r = await api('POST', '/pedidos', {
      ...base, cliente_id: cli.id, items: [{ variante_id: kilo.id, cantidad: 10 }],
      pagos: [{ metodo_pago_id: efectivo.id, monto: 800 }],
    });
    const p4 = r.data;
    ck('deja los $800 completos', r.status === 201 && (await caja(sesion.id)).includes('venta:800'), r.error ?? await caja(sesion.id));
    r = await api('POST', `/pedidos/${p4.id}/preparar`, { lineas: [{ detalle_id: p4.detalle[0].id, cantidad: 9.2 }] });
    ck('pesa 9.2 kg: $736, le quedan $64 a favor', r.status === 200 && Number(r.data?.total) === 736 && r.data?.a_favor === 64, r.error ?? [r.data?.total, r.data?.a_favor]);
    r = await api('GET', '/pedidos/encargos?estado=listo');
    ck('Pedidos dice "a favor $64"', r.data?.items?.some((x) => x.id === p4.id && x.a_favor === 64 && x.falta === 0));
    r = await api('POST', `/pedidos/${p4.id}/entregar`, {});
    ck('sin turno para devolverle: 409 FALTA_SESION_CAJA', r.status === 409 && r.error?.code === 'FALTA_SESION_CAJA', r.error?.code);
    r = await api('POST', `/pedidos/${p4.id}/entregar`, { pagos: [{ metodo_pago_id: efectivo.id, monto: 10 }], sesion_caja_id: sesion.id });
    ck('cobrarle algo no tiene sentido: 422 NADA_POR_COBRAR', r.status === 422 && r.error?.code === 'NADA_POR_COBRAR', r.error?.code);
    r = await api('POST', `/pedidos/${p4.id}/entregar`, { sesion_caja_id: sesion.id });
    ck('se entrega y se le devuelven $64', r.status === 200 && r.data?.estado === 'entregado' && r.data?.devuelto === 64, r.error ?? [r.data?.estado, r.data?.devuelto]);
    ck('los $64 salen del cajón', (await caja(sesion.id)).includes('devolucion:64'), await caja(sesion.id));
    const [[pg]] = await db.query("SELECT COALESCE(SUM(monto), 0) AS s FROM pagos WHERE pedido_id = ? AND estado = 'completado'", [p4.id]);
    ck('lo asentado es lo cobrado ($736), no lo que dejó', r2(pg.s) === 736, pg.s);

    console.log('\n=== 7. Los paquetes escaneados al tomarlo, y cancelar ===');
    r = await api('POST', '/pedidos', {
      ...base, cliente_id: cli.id, pagos: [{ metodo_pago_id: efectivo.id, monto: 200 }],
      items: [{ variante_id: paquete.id, cantidad: 19.5, bultos: [{ codigo: cod[3], peso_kg: 19.5 }] }],
    });
    const p3 = r.data;
    ck('se toma con el paquete escaneado: queda apartado para él', r.status === 201 && (await estadoBulto(cod[3])) === 'apartado', r.error ?? await estadoBulto(cod[3]));
    ck('19.5 kg apartados', (await inv(paquete.id, almacen)).reservada === 19.5, await inv(paquete.id, almacen));
    r = await api('PATCH', `/pedidos/${p3.id}/estado`, { estado: 'cancelado' });
    ck('se cancela: suelta lo apartado, el paquete y devuelve los $200', r.status === 200 && (await inv(paquete.id, almacen)).reservada === 0 &&
      (await estadoBulto(cod[3])) === 'disponible' && (await caja(sesion.id)).includes('devolucion:200'), r.error ?? await caja(sesion.id));
    r = await api('PATCH', `/pedidos/${p3.id}/estado`, { estado: 'apartado' });
    ck('cancelado, no se reactiva como apartado (409)', r.status === 409 && r.error?.code === 'REACTIVAR_COMO_PEDIDO', r.error?.code);
    r = await api('PATCH', `/pedidos/${p3.id}/estado`, { estado: 'en_preparacion' });
    ck('se reactiva como "por preparar": vuelve a apartar, también el paquete', r.status === 200 && r.data?.estado === 'en_preparacion' &&
      (await inv(paquete.id, almacen)).reservada === 19.5 && (await estadoBulto(cod[3])) === 'apartado', r.error ?? await inv(paquete.id, almacen));
    r = await api('GET', '/pedidos/encargos?estado=en_preparacion');
    ck('Pedidos lo enseña por preparar, con lo que ya dejó', r.data?.items?.some((x) => x.id === p3.id && x.pagado === 200 && x.falta === 1750) &&
      r.data?.conteo?.en_preparacion >= 1, r.data?.conteo);

    console.log('\n=== 8. Un APARTADO con su paquete escaneado ===');
    r = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, apartado: true, cliente_id: cli.id,
      items: [{ variante_id: paquete.id, cantidad: 10.75, bultos: [{ codigo: cod[4], peso_kg: 10.75 }] }],
    });
    const p5 = r.data;
    ck('se aparta y el paquete queda apartado (no vendido)', r.status === 201 && p5?.estado === 'apartado' && (await estadoBulto(cod[4])) === 'apartado',
      r.error ?? await estadoBulto(cod[4]));
    await api('POST', `/pedidos/${p5.id}/abonos`, { monto: 1075, metodo_pago_id: transferencia.id });
    r = await api('POST', `/pedidos/${p5.id}/entregar`, {});
    ck('al entregarlo, el paquete queda vendido', r.status === 200 && (await estadoBulto(cod[4])) === 'vendido', r.error ?? await estadoBulto(cod[4]));
    ck('y sale del inventario (61.3 − 10.75 = 50.55)', JSON.stringify(await inv(paquete.id, almacen)) === JSON.stringify({ cantidad: 50.55, reservada: 19.5 }),
      await inv(paquete.id, almacen));
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    console.log('\nLimpiando…');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    const [cls] = await db.query("SELECT id FROM clientes WHERE nombre LIKE 'TMPPE %'");
    const cids = cls.map((x) => x.id);
    const [prods] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPPE %'");
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
    const [cjs] = await db.query("SELECT id FROM cajas WHERE nombre LIKE 'TMPPE Caja%'");
    if (cjs.length) {
      const [ses] = await db.query('SELECT id FROM sesiones_caja WHERE caja_id IN (?)', [cjs.map((x) => x.id)]);
      await borrarTurnosPropios(db, ses.map((x) => x.id));
      await borrarCajasSinTurnos(db, cjs.map((x) => x.id));
    }
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    const [[{ n }]] = await db.query(
      "SELECT (SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPPE %') + (SELECT COUNT(*) FROM clientes WHERE nombre LIKE 'TMPPE %') + (SELECT COUNT(*) FROM cajas WHERE nombre LIKE 'TMPPE Caja%') AS n"
    );
    ck('no quedó basura (TMPPE)', Number(n) === 0, n);
    await db.end();
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
