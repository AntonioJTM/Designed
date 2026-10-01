'use strict';

/**
 * Prueba de los apartados: el cliente deja un anticipo, la mercancía se guarda
 * y se entrega cuando la liquida.
 *
 *   PORT=3225 node --env-file=.env.local.respaldo src/server.js &
 *   BASE=http://localhost:3225/api/v1 node --env-file=.env.local.respaldo scripts/e2e-apartados.js
 *
 * Lo que importa comprobar:
 *   · apartar RESERVA sin descontar (la mercancía sigue en la bodega) y NO deja
 *     movimiento en el kardex: no hubo movimiento de existencias;
 *   · lo apartado ya no está DISPONIBLE para otra venta;
 *   · al cajón entra solo el ANTICIPO, no el total;
 *   · no se entrega sin liquidar;
 *   · al entregar SÍ se descuenta, se libera la reserva y queda el kardex;
 *   · cancelar un apartado LIBERA la reserva y NO inventa existencias.
 *
 * SE LIMPIA SOLO: prefijo TMPAP.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3225/api/v1';
const t = jwt.sign(
  { sub: 1, tipo: 'usuario', rol_id: 1, rol: 'administrador' },
  process.env.JWT_SECRET, { expiresIn: '1h' }
);
const api = async (me, r, b) => {
  const x = await fetch(B + r, {
    method: me,
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  return { status: x.status, ...(await x.json().catch(() => ({}))) };
};

let f = 0;
const ck = (n, ok, d) => {
  console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + d : ''));
  if (!ok) f++;
};
const cerca = (a, b, tol = 0.011) => Math.abs(Number(a) - Number(b)) < tol;

(async () => {
  const db = await m.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const SUF = Date.now().toString(36);

  /** Existencia y apartado de una variante en un almacén. */
  const inv = async (v, a) => {
    const [[r]] = await db.query(
      'SELECT cantidad, cantidad_reservada FROM inventario WHERE variante_id=? AND almacen_id=?',
      [v, a]
    );
    return r
      ? { cantidad: Number(r.cantidad), reservada: Number(r.cantidad_reservada) }
      : { cantidad: 0, reservada: 0 };
  };
  const movsDe = async (pedidoId) => {
    const [r] = await db.query(
      'SELECT COUNT(*) n FROM movimientos_inventario WHERE referencia_tipo="pedido" AND referencia_id=?',
      [pedidoId]
    );
    return Number(r[0].n);
  };

  try {
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const efectivo = (await api('GET', '/opciones/metodos-pago')).data
      .find((x) => x.nombre.toLowerCase().includes('efectivo')).id;
    const transferencia = (await api('GET', '/opciones/metodos-pago')).data
      .find((x) => x.nombre.toLowerCase().includes('transferencia')).id;

    // CON impuesto: el caso real de esta tienda. Así la prueba cubre que el
    // pendiente del apartado se calcula sobre el total CON IVA y no sobre el
    // subtotal, que es donde estaría el error fácil.
    const iva = (await api('GET', '/opciones/impuestos')).data[0];
    const prod = (await api('POST', '/productos', {
      categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPAP Hilo ' + SUF,
      grosor_calibre: '1/30', multipresentacion: true, precio_kg: 100,
      impuesto_id: iva ? iva.id : undefined,
    })).data.id;
    const variante = (await api('POST', '/variantes', {
      producto_id: prod, sku: 'TMPAP-' + SUF, presentacion: 'Paquete',
      tipo_presentacion: 'paquete', peso_kg: 10, precio: 100,
    })).data.id;

    const caja = (await api('GET', '/caja/cajas')).data.find((c) => c.activo);
    const almacen = caja.almacen_id;
    await api('POST', '/inventario/movimientos', {
      variante_id: variante, almacen_id: almacen, tipo: 'entrada',
      cantidad: 100, motivo: 'TMPAP alta de prueba',
    });

    let sesion = (await api('GET', `/caja/sesiones/abierta?caja_id=${caja.id}`)).data;
    const abriYo = !sesion;
    if (!sesion) {
      sesion = (await api('POST', '/caja/sesiones', { caja_id: caja.id, monto_inicial: 0 })).data;
    }

    const cliente = (await api('POST', '/clientes', {
      nombre: 'TMPAP Cliente', telefono: '4457776666',
    })).data;

    // -------------------------------------------------- 1. Apartar: reservar
    console.log('\n1 · Apartar reserva, no descuenta');
    const antes = await inv(variante, almacen);
    const cajonAntes = (await api('GET', '/caja/sesiones/' + sesion.id)).data.esperado_actual;

    // 20 kg × $100 = $2,000 + IVA. Deja $500 de anticipo.
    const ap = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: cliente.id,
      apartado: true,
      items: [{ variante_id: variante, cantidad: 20 }],
      pagos: [{ metodo_pago_id: efectivo, monto: 500 }],
    });
    ck('el apartado se crea', ap.status === 201, ap.data?.numero_pedido);
    ck('y queda en estado "apartado"', ap.data.estado === 'apartado', ap.data?.estado);

    const tras = await inv(variante, almacen);
    ck('la mercancía NO se descontó: sigue en la bodega',
      cerca(tras.cantidad, antes.cantidad), `${antes.cantidad} → ${tras.cantidad}`);
    ck('pero quedó APARTADA', cerca(tras.reservada, antes.reservada + 20),
      `reservada ${antes.reservada} → ${tras.reservada}`);
    ck('y NO hay movimiento en el kardex: no hubo movimiento de existencias',
      (await movsDe(ap.data.id)) === 0);

    const cajonTras = (await api('GET', '/caja/sesiones/' + sesion.id)).data.esperado_actual;
    ck('al cajón entra solo el ANTICIPO, no el total',
      cerca(cajonTras - cajonAntes, 500), `${cajonAntes} → ${cajonTras}`);

    // Lo apartado ya no está disponible para otra venta.
    const [[disp]] = await db.query(
      'SELECT (cantidad - cantidad_reservada) d FROM inventario WHERE variante_id=? AND almacen_id=?',
      [variante, almacen]
    );
    ck('lo apartado sale de lo DISPONIBLE',
      cerca(disp.d, tras.cantidad - 20), `${disp.d} disponibles de ${tras.cantidad}`);

    const total = Number(ap.data.total);
    // 20 kg × $100 = $2,000 de subtotal, más el IVA que tenga el impuesto.
    ck('el total del apartado lleva el impuesto',
      iva ? total > 2000 : cerca(total, 2000), `$${total}`);

    // --------------------------------------------- 2. Lo que no se permite
    console.log('\n2 · Lo que no se permite');
    const sinLiquidar = await api('POST', `/pedidos/${ap.data.id}/entregar`);
    ck('no se entrega sin liquidar',
      sinLiquidar.status === 409 && sinLiquidar.error.code === 'APARTADO_NO_LIQUIDADO',
      sinLiquidar.error?.code);
    ck('y el mensaje dice cuánto falta',
      /\d/.test(sinLiquidar.error.message), sinLiquidar.error?.message?.slice(0, 80));

    const deMas = await api('POST', `/pedidos/${ap.data.id}/abonos`, {
      monto: 99999, metodo_pago_id: transferencia,
    });
    ck('no se abona más de lo que falta',
      deMas.status === 422 && deMas.error.code === 'ABONO_EXCEDE_PENDIENTE', deMas.error?.code);

    const enEfectivoSinTurno = await api('POST', `/pedidos/${ap.data.id}/abonos`, {
      monto: 10, metodo_pago_id: efectivo,
    });
    ck('un abono en efectivo sin turno se rechaza',
      enEfectivoSinTurno.status === 409 &&
        enEfectivoSinTurno.error.code === 'FALTA_SESION_CAJA',
      enEfectivoSinTurno.error?.code);

    const apartadoYFiado = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: cliente.id,
      apartado: true, a_credito: 100,
      items: [{ variante_id: variante, cantidad: 1 }],
    });
    ck('apartar Y fiar a la vez se rechaza',
      apartadoYFiado.status === 422 && apartadoYFiado.error.code === 'APARTADO_A_CREDITO',
      apartadoYFiado.error?.code);

    const sinCliente = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, apartado: true,
      items: [{ variante_id: variante, cantidad: 1 }],
    });
    ck('no se aparta sin decir a quién',
      sinCliente.status === 422 && sinCliente.error.code === 'APARTADO_SIN_CLIENTE',
      sinCliente.error?.code);

    const enLinea = await api('POST', '/pedidos', {
      canal: 'tienda_linea', apartado: true, metodo_entrega: 'recoger',
      items: [{ variante_id: variante, cantidad: 1 }],
    });
    ck('no se aparta desde la tienda en línea',
      enLinea.status === 422 && enLinea.error.code === 'APARTADO_SOLO_MOSTRADOR',
      enLinea.error?.code);

    // ------------------------------------------------- 3. Abonar y entregar
    console.log('\n3 · Abonar hasta liquidar, y entregar');
    const lista = (await api('GET', '/pedidos/apartados')).data;
    const mio = lista.items.find((x) => x.pedido_id === ap.data.id);
    ck('aparece en la lista de apartados', !!mio, mio && `lleva ${mio.pct_pagado}% pagado`);
    ck('con lo que lleva abonado', cerca(mio.abonado, 500), mio?.abonado);
    ck('y lo que falta', cerca(mio.pendiente, total - 500), mio?.pendiente);

    const parcial = await api('POST', `/pedidos/${ap.data.id}/abonos`, {
      monto: 1000, metodo_pago_id: transferencia, referencia: 'SPEI-TMPAP',
    });
    ck('el abono parcial pasa', parcial.status === 201, `abonado ${parcial.data?.abonado}`);
    ck('todavía no está liquidado', parcial.data.liquidado === false);

    const resto = Math.round((total - 1500) * 100) / 100;
    const cajonPre = (await api('GET', '/caja/sesiones/' + sesion.id)).data.esperado_actual;
    const final = await api('POST', `/pedidos/${ap.data.id}/abonos`, {
      monto: resto, metodo_pago_id: efectivo, sesion_caja_id: sesion.id,
    });
    ck('el último abono liquida', final.data.liquidado === true, `pendiente ${final.data?.pendiente}`);
    const cajonPost = (await api('GET', '/caja/sesiones/' + sesion.id)).data.esperado_actual;
    ck('el efectivo del abono entra al cajón',
      cerca(cajonPost - cajonPre, resto), `${cajonPre} → ${cajonPost}`);
    const movsCaja = (await api('GET', '/caja/sesiones/' + sesion.id)).data.movimientos;
    ck('como ingreso y no como venta (la venta ya se contó al apartar)',
      movsCaja.some((x) => x.tipo === 'ingreso' && cerca(x.monto, resto)));

    const entregado = await api('POST', `/pedidos/${ap.data.id}/entregar`);
    ck('ya liquidado, se entrega', entregado.status === 200, entregado.data?.estado);
    ck('y queda como entregado', entregado.data.estado === 'entregado');

    const trasEntrega = await inv(variante, almacen);
    ck('AHORA sí se descuenta del inventario',
      cerca(trasEntrega.cantidad, antes.cantidad - 20),
      `${tras.cantidad} → ${trasEntrega.cantidad}`);
    ck('y se libera lo apartado',
      cerca(trasEntrega.reservada, antes.reservada), `reservada ${trasEntrega.reservada}`);
    ck('con su movimiento en el kardex', (await movsDe(ap.data.id)) === 20 / 20,
      `${await movsDe(ap.data.id)} movimiento(s)`);

    const yaEntregado = await api('POST', `/pedidos/${ap.data.id}/entregar`);
    ck('no se entrega dos veces',
      yaEntregado.status === 409 && yaEntregado.error.code === 'NO_ES_APARTADO',
      yaEntregado.error?.code);

    // ------------------------------------------------------- 4. Cancelar
    console.log('\n4 · Cancelar un apartado');
    const antesCancel = await inv(variante, almacen);
    const ap2 = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: cliente.id,
      apartado: true,
      items: [{ variante_id: variante, cantidad: 15 }],
      pagos: [{ metodo_pago_id: efectivo, monto: 300 }],
    });
    const conApartado = await inv(variante, almacen);
    ck('el segundo apartado reserva 15 kg',
      cerca(conApartado.reservada, antesCancel.reservada + 15), conApartado.reservada);

    await api('PATCH', `/pedidos/${ap2.data.id}/estado`, { estado: 'cancelado' });
    const trasCancel = await inv(variante, almacen);
    ck('cancelar LIBERA la reserva',
      cerca(trasCancel.reservada, antesCancel.reservada), `reservada ${trasCancel.reservada}`);
    ck('y NO inventa existencias: la cantidad no cambió',
      cerca(trasCancel.cantidad, antesCancel.cantidad),
      `${antesCancel.cantidad} → ${trasCancel.cantidad}`);
    ck('no deja movimientos de inventario fantasma',
      (await movsDe(ap2.data.id)) === 0, `${await movsDe(ap2.data.id)} movimiento(s)`);

    const yaNoEstá = (await api('GET', '/pedidos/apartados')).data;
    ck('y desaparece de la lista de apartados',
      !yaNoEstá.items.some((x) => x.pedido_id === ap2.data.id));

    if (abriYo) await api('POST', `/caja/sesiones/${sesion.id}/cerrar`, { monto_final: 0 });

  } catch (e) {
    console.error('\nERROR:', e.message, e.stack);
    f++;
  } finally {
    console.log('\nLimpiando…');
    const [cls] = await db.query("SELECT id FROM clientes WHERE nombre LIKE 'TMPAP%'");
    const cids = cls.map((r) => r.id);
    const [prods] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPAP%'");
    const pr = prods.map((r) => r.id);
    let vids = [];
    if (pr.length) {
      const [vs] = await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [pr]);
      vids = vs.map((v) => v.id);
    }
    const pedidos = new Set();
    if (cids.length) {
      const [p] = await db.query('SELECT id FROM pedidos WHERE cliente_id IN (?)', [cids]);
      p.forEach((x) => pedidos.add(x.id));
    }
    if (vids.length) {
      const [p] = await db.query(
        'SELECT DISTINCT pedido_id FROM pedido_detalle WHERE variante_id IN (?)', [vids]);
      p.forEach((x) => pedidos.add(x.pedido_id));
    }
    const pids = [...pedidos];
    if (pids.length) {
      await db.query('DELETE FROM movimientos_inventario WHERE referencia_tipo="pedido" AND referencia_id IN (?)', [pids]);
      await db.query('DELETE FROM movimientos_caja WHERE referencia_id IN (?)', [pids]);
      await db.query('DELETE FROM pedidos WHERE id IN (?)', [pids]);
    }
    if (cids.length) await db.query('DELETE FROM clientes WHERE id IN (?)', [cids]);
    if (vids.length) {
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) {
        await db.query('DELETE FROM ' + tb + ' WHERE variante_id IN (?)', [vids]);
      }
      await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
    }
    if (pr.length) await db.query('DELETE FROM productos WHERE id IN (?)', [pr]);

    const [[{ n }]] = await db.query(
      "SELECT (SELECT COUNT(*) FROM clientes WHERE nombre LIKE 'TMPAP%') + " +
      "(SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPAP%') AS n");
    ck('no quedó basura en la base (TMPAP)', Number(n) === 0, n);
    await db.end();
  }

  console.log(`\n${f === 0 ? 'TODO OK' : f + ' FALLO(S)'}`);
  process.exit(f === 0 ? 0 : 1);
})();
