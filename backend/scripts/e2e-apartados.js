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
const { borrarTurnosPropios, borrarCajasSinTurnos } = require('./_propios');
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

    // Caja PROPIA de la prueba, nunca el turno de una caja real: en producción
    // la primera caja activa tiene un turno de verdad abierto y las ventas de
    // prueba quedarían en su corte. Va en el almacén donde vende el mostrador.
    const almacen = (await api('GET', '/caja/cajas')).data.find((c) => c.activo).almacen_id;
    const caja = (await api('POST', '/caja/cajas', {
      almacen_id: almacen, nombre: 'TMPAP Caja ' + SUF,
    })).data;
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

    // Y la caja ya no se lo vende a otro. Antes sí: la venta solo miraba la
    // existencia, y el día que venían por el apartado no había con qué.
    const libre = Math.round((tras.cantidad - 20) * 1000) / 1000;
    const venderApartado = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id,
      items: [{ variante_id: variante, cantidad: libre + 1 }],
      pagos: [{ metodo_pago_id: efectivo, monto: 999999 }],
    });
    ck('la caja NO vende lo apartado: 409 STOCK_INSUFICIENTE',
      venderApartado.status === 409 && venderApartado.error?.code === 'STOCK_INSUFICIENTE',
      venderApartado.status + ' ' + venderApartado.error?.code);
    ck('y el mensaje dice que está apartado',
      /apartad/i.test(venderApartado.error?.message ?? ''), venderApartado.error?.message);
    const otroApartado = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: cliente.id, apartado: true,
      items: [{ variante_id: variante, cantidad: libre + 1 }],
    });
    ck('ni se aparta dos veces lo mismo',
      otroApartado.status === 409 && otroApartado.error?.code === 'STOCK_INSUFICIENTE',
      otroApartado.status + ' ' + otroApartado.error?.code);

    const total = Number(ap.data.total);
    // 20 kg × $100 = $2,000 de subtotal, más el IVA que tenga el impuesto.
    ck('el total del apartado lleva el impuesto',
      iva ? total > 2000 : cerca(total, 2000), `$${total}`);

    // --------------------------------------------- 2. Lo que no se permite
    console.log('\n2 · Lo que no se permite');
    // Subirle la captura de un depósito creaba un pago por el TOTAL y lo daba
    // por liquidado: un apartado se paga con abonos.
    const conCaptura = await fetch(`${B}/pedidos/${ap.data.id}/comprobante`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/octet-stream' },
      body: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]),
    }).then(async (x) => ({ status: x.status, ...(await x.json()) }));
    ck('a un apartado no se le sube captura: se le abona',
      conCaptura.status === 409 && conCaptura.error?.code === 'APARTADO_USA_ABONOS', conCaptura.error?.code);

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

    // El cambio de estado genérico no puede saltarse "Entregar": sin esto el
    // apartado quedaba entregado sin descontar y apartado para siempre.
    const atajo = await api('PATCH', `/pedidos/${ap2.data.id}/estado`, { estado: 'entregado' });
    ck('un apartado no se marca entregado desde el cambio de estado',
      atajo.status === 409 && atajo.error?.code === 'APARTADO_SE_ENTREGA', atajo.error?.code);

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

    // ------------------------------------------------------ 5. Reactivar
    console.log('\n5 · Reactivar un apartado cancelado');
    const comoVenta = await api('PATCH', `/pedidos/${ap2.data.id}/estado`, { estado: 'pendiente' });
    ck('no se reactiva como venta pendiente (quedaría sin apartar ni descontar)',
      comoVenta.status === 409 && comoVenta.error?.code === 'REACTIVAR_COMO_APARTADO',
      comoVenta.error?.code);

    const reactivado = await api('PATCH', `/pedidos/${ap2.data.id}/estado`, { estado: 'apartado' });
    ck('se reactiva como apartado', reactivado.status === 200 && reactivado.data?.estado === 'apartado',
      reactivado.error?.code ?? reactivado.data?.estado);
    const trasReactivar = await inv(variante, almacen);
    ck('y la mercancía se vuelve a apartar',
      cerca(trasReactivar.reservada, antesCancel.reservada + 15), `reservada ${trasReactivar.reservada}`);
    ck('sin descontarla', cerca(trasReactivar.cantidad, antesCancel.cantidad),
      `${antesCancel.cantidad} → ${trasReactivar.cantidad}`);
    ck('ni tocar el kardex', (await movsDe(ap2.data.id)) === 0);
    ck('y vuelve a la lista de apartados',
      (await api('GET', '/pedidos/apartados')).data.items.some((x) => x.pedido_id === ap2.data.id));

    const normal = (await api('GET', `/pedidos/${ap.data.id}`)).data;
    const aApartar = await api('PATCH', `/pedidos/${ap.data.id}/estado`, { estado: 'apartado' });
    ck('un pedido que ya descontó no se vuelve apartado',
      aApartar.status === 409 && aApartar.error?.code === 'NO_SE_PUEDE_APARTAR',
      `${normal?.estado}: ${aApartar.error?.code}`);

    // Se cancela otra vez para dejar la reserva como estaba antes de limpiar.
    await api('PATCH', `/pedidos/${ap2.data.id}/estado`, { estado: 'cancelado' });

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
    // La caja de la prueba con su turno y sus movimientos. Se borra por TURNO y
    // no por referencia_id: ese campo guarda a veces un pedido y a veces un
    // abono de crédito, y por número podría alcanzar un movimiento real.
    const [cjs] = await db.query("SELECT id FROM cajas WHERE nombre LIKE 'TMPAP Caja%'");
    if (cjs.length) {
      const [ses] = await db.query('SELECT id FROM sesiones_caja WHERE caja_id IN (?)', [cjs.map((r) => r.id)]);
      // Solo los turnos que nadie más usó: si alguien cobró en la caja de la
      // prueba (pasó el 2026-10-03), ese turno y su caja se quedan. Ver _propios.js.
      await borrarTurnosPropios(db, ses.map((r) => r.id));
      await borrarCajasSinTurnos(db, cjs.map((r) => r.id));
    }

    const [[{ n }]] = await db.query(
      "SELECT (SELECT COUNT(*) FROM clientes WHERE nombre LIKE 'TMPAP%') + " +
      "(SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPAP%') AS n");
    ck('no quedó basura en la base (TMPAP)', Number(n) === 0, n);
    await db.end();
  }

  console.log(`\n${f === 0 ? 'TODO OK' : f + ' FALLO(S)'}`);
  process.exit(f === 0 ? 0 : 1);
})();
