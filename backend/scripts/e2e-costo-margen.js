'use strict';

/**
 * Prueba del costo y del margen.
 *
 *   PORT=3224 node --env-file=.env.local.respaldo src/server.js &
 *   BASE=http://localhost:3224/api/v1 node --env-file=.env.local.respaldo scripts/e2e-costo-margen.js
 *
 * Lo que importa comprobar:
 *   · el COSTO PROMEDIO PONDERADO se mezcla bien cuando llega una remesa más
 *     cara (es el cálculo delicado de todo esto);
 *   · el costo se CONGELA en la venta, así que el margen de una venta vieja no
 *     se mueve cuando cambia el costo del hilo;
 *   · una venta sin costo capturado NO se cuenta como margen del 100%, se
 *     reporta aparte;
 *   · el costo NO se le filtra al cliente en la cotización del checkout.
 *
 * SE LIMPIA SOLO: prefijo TMPCM2.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3224/api/v1';
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

  try {
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const efectivo = (await api('GET', '/opciones/metodos-pago')).data
      .find((x) => x.nombre.toLowerCase().includes('efectivo')).id;

    const prod = (await api('POST', '/productos', {
      categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPCM2 Hilo ' + SUF,
      grosor_calibre: '1/30', multipresentacion: true, precio_kg: 200,
    })).data.id;
    const variante = (await api('POST', '/variantes', {
      producto_id: prod, sku: 'TMPCM2-' + SUF, presentacion: 'Paquete',
      tipo_presentacion: 'paquete', peso_kg: 10, precio: 200,
    })).data.id;

    // Caja PROPIA de la prueba, nunca el turno de una caja real: en producción
    // la primera caja activa tiene un turno de verdad abierto y las ventas de
    // prueba quedarían en su corte. Va en el almacén donde vende el mostrador.
    const almacen = (await api('GET', '/caja/cajas')).data.find((c) => c.activo).almacen_id;
    const caja = (await api('POST', '/caja/cajas', {
      almacen_id: almacen, nombre: 'TMPCM2 Caja ' + SUF,
    })).data;
    let sesion = (await api('GET', `/caja/sesiones/abierta?caja_id=${caja.id}`)).data;
    const abriYo = !sesion;
    if (!sesion) {
      sesion = (await api('POST', '/caja/sesiones', { caja_id: caja.id, monto_inicial: 0 })).data;
    }

    const bultos = (n, peso, pref) =>
      Array.from({ length: n }, (_, i) => ({
        codigo: `TMPCM2-${pref}-${i}-${SUF}`, peso_kg: peso, lote: 'L' + pref,
      }));

    // ------------------------------------------ 1. Promedio ponderado móvil
    console.log('\n1 · El costo promedio ponderado');

    // Primera compra: 100 kg a $100.
    let r = await api('POST', '/remesas', {
      variante_id: variante, almacen_id: almacen, costo_kg: 100,
      archivo: 'TMPCM2.xlsx', bultos: bultos(10, 10, 'A'),
    });
    ck('la remesa con costo pasa', r.status === 201, r.data?.folio);
    ck('primera compra: el costo es el de esa remesa', cerca(r.data.costo_promedio, 100),
      r.data?.costo_promedio);

    // Segunda compra: 100 kg a $200. El promedio debe ser $150.
    r = await api('POST', '/remesas', {
      variante_id: variante, almacen_id: almacen, costo_kg: 200,
      archivo: 'TMPCM2.xlsx', bultos: bultos(10, 10, 'B'),
    });
    ck('100 kg a $100 + 100 kg a $200 = $150 de promedio',
      cerca(r.data.costo_promedio, 150), r.data?.costo_promedio);

    // Tercera: 200 kg a $300 sobre 200 kg a $150 → (200×150 + 200×300)/400 = 225.
    r = await api('POST', '/remesas', {
      variante_id: variante, almacen_id: almacen, costo_kg: 300,
      archivo: 'TMPCM2.xlsx', bultos: bultos(20, 10, 'C'),
    });
    ck('y pondera por KILOS, no por número de remesas',
      cerca(r.data.costo_promedio, 225), r.data?.costo_promedio);

    // Una remesa SIN costo no debe tocar el costo del hilo.
    r = await api('POST', '/remesas', {
      variante_id: variante, almacen_id: almacen,
      archivo: 'TMPCM2.xlsx', bultos: bultos(5, 10, 'D'),
    });
    ck('una remesa sin costo no lo cambia', r.data.costo_promedio === null,
      String(r.data?.costo_promedio));
    const [[v1]] = await db.query('SELECT costo FROM producto_variantes WHERE id = ?', [variante]);
    ck('y el costo del hilo sigue en 225', cerca(v1.costo, 225), v1.costo);

    // ------------------------------------------------- 2. El costo se congela
    console.log('\n2 · El costo se congela en la venta');
    const venta = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id,
      items: [{ variante_id: variante, cantidad: 10 }], // 10 kg × $200 = 2000
      pagos: [{ metodo_pago_id: efectivo, monto: 5000 }],
    });
    ck('la venta pasa', venta.status === 201, venta.data?.numero_pedido);
    const [[d1]] = await db.query(
      'SELECT costo_unitario FROM pedido_detalle WHERE pedido_id = ?', [venta.data.id]);
    ck('guarda el costo del momento', cerca(d1.costo_unitario, 225), d1.costo_unitario);

    // Ahora sube el costo del hilo. El de la venta NO debe moverse.
    await api('POST', '/remesas', {
      variante_id: variante, almacen_id: almacen, costo_kg: 1000,
      archivo: 'TMPCM2.xlsx', bultos: bultos(50, 10, 'E'),
    });
    const [[v2]] = await db.query('SELECT costo FROM producto_variantes WHERE id = ?', [variante]);
    const [[d2]] = await db.query(
      'SELECT costo_unitario FROM pedido_detalle WHERE pedido_id = ?', [venta.data.id]);
    ck('el costo del hilo subió', Number(v2.costo) > 225, v2.costo);
    ck('pero el de la venta vieja NO se movió', cerca(d2.costo_unitario, 225), d2.costo_unitario);

    // ------------------------------------------------------------ 3. El margen
    console.log('\n3 · El margen');
    // El margen llega dentro del tablero, con los mismos filtros por omisión.
    const marg = (await api('GET', '/analisis/tablero')).data.margen;
    const mio = marg.hilos.find((h) => h.producto_id === prod);
    ck('el hilo aparece en el margen', !!mio, mio && `venta ${mio.venta}, costo ${mio.costo}`);
    ck('venta 2000, costo 2250 → pierde 250', cerca(mio.ganancia, -250), mio?.ganancia);
    ck('y el margen sale negativo', Number(mio.margen_pct) < 0, mio?.margen_pct + '%');

    // Una venta de un hilo SIN costo no debe contarse como margen del 100%.
    const sinCosto = (await api('POST', '/productos', {
      categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPCM2 SinCosto ' + SUF,
      grosor_calibre: '1/30', multipresentacion: true, precio_kg: 50,
    })).data.id;
    const vSin = (await api('POST', '/variantes', {
      producto_id: sinCosto, sku: 'TMPCM2-SC-' + SUF, presentacion: 'Paquete',
      tipo_presentacion: 'paquete', peso_kg: 10, precio: 50,
    })).data.id;
    await api('POST', '/inventario/movimientos', {
      variante_id: vSin, almacen_id: almacen, tipo: 'entrada', cantidad: 100,
      motivo: 'TMPCM2 sin costo',
    });
    await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id,
      items: [{ variante_id: vSin, cantidad: 4 }], // 200
      pagos: [{ metodo_pago_id: efectivo, monto: 500 }],
    });
    const marg2 = (await api('GET', '/analisis/tablero')).data.margen;
    ck('el hilo sin costo NO entra al margen',
      !marg2.hilos.some((h) => h.producto_id === sinCosto));
    ck('se reporta aparte cuánta venta quedó fuera',
      Number(marg2.sin_costo_venta) >= 200, `$${marg2.sin_costo_venta} en ${marg2.sin_costo_lineas} línea(s)`);

    // ------------------------------------------- 4. El costo no se le filtra
    console.log('\n4 · El costo es información interna');
    const cot = await api('POST', '/pedidos/cotizacion', {
      canal: 'tienda_linea', metodo_entrega: 'recoger',
      items: [{ variante_id: variante, cantidad: 1 }],
    });
    ck('la cotización del checkout no lleva el costo',
      cot.data.lineas.every((l) => l.costo_unitario === undefined),
      JSON.stringify(Object.keys(cot.data.lineas[0])));

    if (abriYo) await api('POST', `/caja/sesiones/${sesion.id}/cerrar`, { monto_final: 0 });

  } catch (e) {
    console.error('\nERROR:', e.message, e.stack);
    f++;
  } finally {
    console.log('\nLimpiando…');
    const [prods] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPCM2%'");
    const pr = prods.map((r) => r.id);
    if (pr.length) {
      const [vs] = await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [pr]);
      const vids = vs.map((v) => v.id);
      if (vids.length) {
        const [peds] = await db.query(
          'SELECT DISTINCT pedido_id FROM pedido_detalle WHERE variante_id IN (?)', [vids]);
        const pids = peds.map((r) => r.pedido_id);
        if (pids.length) {
          await db.query('DELETE FROM movimientos_inventario WHERE referencia_tipo="pedido" AND referencia_id IN (?)', [pids]);
          await db.query('DELETE FROM pedidos WHERE id IN (?)', [pids]);
        }
        await db.query('DELETE FROM remesas WHERE variante_id IN (?)', [vids]);
        for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) {
          await db.query('DELETE FROM ' + tb + ' WHERE variante_id IN (?)', [vids]);
        }
        await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
      }
      await db.query('DELETE FROM productos WHERE id IN (?)', [pr]);
    }
    // La caja de la prueba con su turno y sus movimientos. Se borra por TURNO y
    // no por referencia_id: por número podría alcanzar un movimiento real.
    const [cjs] = await db.query("SELECT id FROM cajas WHERE nombre LIKE 'TMPCM2 Caja%'");
    if (cjs.length) {
      const [ses] = await db.query('SELECT id FROM sesiones_caja WHERE caja_id IN (?)', [cjs.map((r) => r.id)]);
      if (ses.length) {
        await db.query('DELETE FROM movimientos_caja WHERE sesion_caja_id IN (?)', [ses.map((r) => r.id)]);
        await db.query('DELETE FROM sesiones_caja WHERE id IN (?)', [ses.map((r) => r.id)]);
      }
      await db.query('DELETE FROM cajas WHERE id IN (?)', [cjs.map((r) => r.id)]);
    }
    const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM productos WHERE nombre LIKE 'TMPCM2%'");
    ck('no quedó basura en la base (TMPCM2)', Number(n) === 0, n);
    await db.end();
  }

  console.log(`\n${f === 0 ? 'TODO OK' : f + ' FALLO(S)'}`);
  process.exit(f === 0 ? 0 : 1);
})();
