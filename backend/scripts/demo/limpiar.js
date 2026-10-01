'use strict';

/**
 * Borra la MUESTRA que sembró `sembrar.js`, sin tocar lo real.
 *
 * Parte de lo anotado en `_demo_registros` (productos, clientes, pedidos,
 * turnos de caja, traspasos, nóminas, listas de precio y cupones) y borra
 * todo lo que cuelga de ahí: variantes, bultos, remesas, kardex, inventario,
 * desarmes, pagos, crédito, direcciones. También lo que se haya hecho EN VIVO
 * durante la muestra con hilos o clientes de la muestra.
 *
 * Uso (desde backend/):
 *   node scripts/demo/limpiar.js --base <DB_NAME>              dice qué borraría
 *   node scripts/demo/limpiar.js --base <DB_NAME> --confirmar  lo borra
 *
 * Se niega a seguir si encuentra una venta VIGENTE que mezcle hilos de la
 * muestra con hilos reales: borrarla dejaría el inventario real descontado sin
 * su venta. Esa venta se cancela primero (repone lo real) y luego se limpia.
 */

process.env.TZ = 'UTC';
require('dotenv').config();

const argv = process.argv.slice(2);
const base = argv[argv.indexOf('--base') + 1];
const CONFIRMAR = argv.includes('--confirmar');
if (!argv.includes('--base') || base !== process.env.DB_NAME) {
  console.error(`\n  ✗ Di qué base se limpia: --base ${process.env.DB_NAME || '<DB_NAME>'}\n`);
  process.exit(1);
}

const fs = require('node:fs/promises');
const path = require('node:path');
const { pool, withTransaction } = require('../../src/config/db');
const env = require('../../src/config/env');

const lista = (ids) => (ids.length ? ids.join(',') : 'NULL');

async function main() {
  console.log(`\n  Limpiar muestra → base "${process.env.DB_NAME}" en ${process.env.DB_HOST}`);
  const [[existe]] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '_demo_registros'"
  );
  if (!Number(existe.n)) {
    console.log('  No hay muestra sembrada en esta base. Nada que hacer.\n');
    return;
  }

  const [regs] = await pool.query('SELECT tabla, registro_id FROM _demo_registros');
  const de = (t) => regs.filter((r) => r.tabla === t).map((r) => Number(r.registro_id));
  const [estados] = await pool.query('SELECT clave, valor FROM _demo_estado');
  const estado = Object.fromEntries(estados.map((e) => [e.clave, JSON.parse(e.valor)]));

  const ids = async (sql) => (await pool.query(sql))[0].map((r) => Number(Object.values(r)[0]));

  const P = de('productos');
  const C = de('clientes');
  const S = de('sesiones_caja');
  const N = de('nomina_periodos');
  const TC = de('tipos_cliente');
  const CU = de('cupones');
  const V = P.length ? await ids(`SELECT id FROM producto_variantes WHERE producto_id IN (${lista(P)})`) : [];

  // Pedidos: los anotados, más lo que se haya vendido EN VIVO con hilos,
  // clientes o turnos de la muestra.
  const D = [
    ...new Set([
      ...de('pedidos'),
      ...(await ids(`SELECT DISTINCT pedido_id FROM pedido_detalle WHERE variante_id IN (${lista(V)})`)),
      ...(await ids(`SELECT id FROM pedidos WHERE cliente_id IN (${lista(C)})`)),
      ...(await ids(`SELECT id FROM pedidos WHERE sesion_caja_id IN (${lista(S)})`)),
    ]),
  ];

  // Un pedido que también lleva hilos REALES: si sigue vigente, borrarlo
  // dejaría el inventario real descontado sin su venta.
  const [mixtos] = await pool.query(
    `SELECT p.id, p.numero_pedido, p.estado
       FROM pedidos p
      WHERE p.id IN (${lista(D)})
        AND EXISTS (SELECT 1 FROM pedido_detalle d WHERE d.pedido_id = p.id AND d.variante_id NOT IN (${lista(V)}))`
  );
  const vigentes = mixtos.filter((m) => !['cancelado', 'devuelto'].includes(m.estado));
  if (vigentes.length) {
    console.error('\n  ✗ Estas ventas mezclan la muestra con hilos o clientes REALES y siguen vigentes:');
    for (const m of vigentes) console.error(`      ${m.numero_pedido} (${m.estado})`);
    console.error('    Cancélalas desde Pedidos (eso repone el inventario real) y vuelve a correr la limpieza.\n');
    process.exitCode = 1;
    return;
  }
  // Las mixtas ya canceladas sí se pueden borrar: su salida y su reposición
  // del kardex se anulan entre sí.
  const mixtasCanceladas = mixtos.map((m) => Number(m.id));

  const T = [
    ...new Set([
      ...de('traspasos'),
      ...(await ids(`SELECT DISTINCT traspaso_id FROM traspaso_detalle WHERE variante_id IN (${lista(V)})`)),
    ]),
  ];
  const [tMixtos] = await pool.query(
    `SELECT t.folio FROM traspasos t WHERE t.id IN (${lista(T)})
        AND EXISTS (SELECT 1 FROM traspaso_detalle d WHERE d.traspaso_id = t.id AND d.variante_id NOT IN (${lista(V)}))`
  );
  if (tMixtos.length) {
    console.error(`\n  ✗ Traspasos que mezclan la muestra con hilos reales: ${tMixtos.map((t) => t.folio).join(', ')}`);
    console.error('    Revísalos a mano antes de limpiar.\n');
    process.exitCode = 1;
    return;
  }

  const CM = await ids(`SELECT id FROM credito_movimientos WHERE cliente_id IN (${lista(C)}) OR pedido_id IN (${lista(D)})`);

  // Lo que se va a borrar, por tabla.
  const conteos = {};
  const contar = async (tabla, where) => {
    const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${where}`);
    conteos[tabla] = Number(r.n);
  };
  const W = {
    movimientos_caja:
      `sesion_caja_id IN (${lista(S)})
        OR (referencia_id IN (${lista(D)}) AND (tipo IN ('venta','devolucion') OR (tipo = 'ingreso' AND motivo NOT LIKE 'Abono de %')))
        OR (tipo = 'ingreso' AND motivo LIKE 'Abono de %' AND referencia_id IN (${lista(CM)}))`,
    credito_movimientos: `id IN (${lista(CM)})`,
    movimientos_inventario:
      `variante_id IN (${lista(V)})
        OR (referencia_tipo = 'pedido' AND referencia_id IN (${lista(mixtasCanceladas)}))`,
    pedidos: `id IN (${lista(D)})`,
    variante_conversiones: `variante_origen_id IN (${lista(V)}) OR variante_destino_id IN (${lista(V)})`,
    traspasos: `id IN (${lista(T)})`,
    inventario: `variante_id IN (${lista(V)})`,
    variante_codigos: `variante_id IN (${lista(V)})`,
    remesas: `variante_id IN (${lista(V)})`,
    producto_variantes: `id IN (${lista(V)})`,
    productos: `id IN (${lista(P)})`,
    sesiones_caja: `id IN (${lista(S)})`,
    clientes: `id IN (${lista(C)})`,
    nomina_periodos: `id IN (${lista(N)})`,
    tipos_cliente: `id IN (${lista(TC)})`,
    cupones: `id IN (${lista(CU)})`,
  };
  for (const [t, w] of Object.entries(W)) await contar(t, w);

  console.log('\n  Se borraría:');
  for (const [t, n] of Object.entries(conteos)) console.log(`    ${t.padEnd(24)} ${n}`);
  if (estado.configuracion_previa) {
    console.log(`    configuración           se regresa a como estaba (${Object.keys(estado.configuracion_previa).join(', ')})`);
  }
  if (estado.almacen_reactivado) {
    console.log(`    almacén ${estado.almacen_reactivado}               se vuelve a desactivar, como estaba`);
  }
  if (estado.nomina_recalcular?.length) {
    console.log(`    nómina real             se recalcula el periodo ${estado.nomina_recalcular.join(', ')} sin las ventas de la muestra`);
  }

  if (!CONFIRMAR) {
    console.log('\n  (Solo se mostró. Para borrar de verdad: agrega --confirmar)\n');
    return;
  }

  const [pagosConArchivo] = await pool.query(
    `SELECT comprobante_archivo FROM pagos WHERE pedido_id IN (${lista(D)}) AND comprobante_archivo IS NOT NULL`
  );

  await withTransaction(async (conn) => {
    const x = (sql) => conn.query(sql);
    // Lo real que haya usado una lista de precios o un cupón de la muestra
    // vuelve al público / sin cupón, para poder borrarlos.
    const [[pub]] = await conn.query('SELECT id FROM tipos_cliente WHERE es_publico = 1 LIMIT 1');
    await x(`UPDATE clientes SET tipo_cliente_id = NULL WHERE tipo_cliente_id IN (${lista(TC)}) AND id NOT IN (${lista(C)})`);
    await x(`UPDATE pedidos SET tipo_cliente_id = ${pub ? Number(pub.id) : 'NULL'}
              WHERE tipo_cliente_id IN (${lista(TC)}) AND id NOT IN (${lista(D)})`);
    await x(`UPDATE pedidos SET cupon_id = NULL WHERE cupon_id IN (${lista(CU)}) AND id NOT IN (${lista(D)})`);

    await x(`DELETE FROM movimientos_caja WHERE ${W.movimientos_caja}`);
    await x(`DELETE FROM credito_movimientos WHERE ${W.credito_movimientos}`);
    await x(`DELETE FROM movimientos_inventario WHERE ${W.movimientos_inventario}`);
    // pedido_detalle, pedido_detalle_bultos, pagos y envíos se van en cascada.
    await x(`DELETE FROM pedidos WHERE ${W.pedidos}`);
    await x(`DELETE FROM variante_conversiones WHERE ${W.variante_conversiones}`);
    await x(`DELETE FROM traspasos WHERE ${W.traspasos}`);
    await x(`DELETE FROM inventario WHERE ${W.inventario}`);
    await x(`DELETE FROM variante_codigos WHERE ${W.variante_codigos}`);
    await x(`DELETE FROM remesas WHERE ${W.remesas}`);
    await x(`DELETE FROM carrito_items WHERE variante_id IN (${lista(V)})`);
    // Primero los conos, que apuntan a su paquete.
    await x(`DELETE FROM producto_variantes WHERE id IN (${lista(V)}) AND origen_variante_id IS NOT NULL`);
    await x(`DELETE FROM producto_variantes WHERE ${W.producto_variantes}`);
    await x(`DELETE FROM productos WHERE ${W.productos}`);
    await x(`DELETE FROM sesiones_caja WHERE ${W.sesiones_caja}`);
    await x(`DELETE FROM clientes WHERE ${W.clientes}`);
    await x(`DELETE FROM nomina_periodos WHERE ${W.nomina_periodos}`);
    await x(`DELETE FROM tipos_cliente WHERE ${W.tipos_cliente}`);
    await x(`DELETE FROM cupones WHERE ${W.cupones}`);
    if (estado.almacen_reactivado) {
      await conn.query('UPDATE almacenes SET activo = 0 WHERE id = :id', { id: estado.almacen_reactivado });
    }
    for (const [clave, valor] of Object.entries(estado.configuracion_previa ?? {})) {
      await conn.query('UPDATE configuracion SET valor = :valor WHERE clave = :clave', { clave, valor });
    }
  });

  // Fuera de la transacción: los archivos de los comprobantes, la nómina real
  // que se había recalculado con la muestra y la bitácora misma.
  const carpeta = path.join(env.uploadsDir, 'comprobantes');
  let archivos = 0;
  for (const { comprobante_archivo: nombre } of pagosConArchivo) {
    // El nombre lo generó el sistema (hex + extensión), pero se valida igual
    // para no borrar nada fuera de la carpeta.
    if (!/^[a-f0-9]+\.[a-z0-9]+$/i.test(nombre)) continue;
    await fs.rm(path.join(carpeta, nombre), { force: true });
    archivos++;
  }

  const nominaService = require('../../src/modules/nomina/service');
  for (const id of estado.nomina_recalcular ?? []) {
    const [[p]] = await pool.query('SELECT estado FROM nomina_periodos WHERE id = :id', { id });
    if (p?.estado === 'borrador') await nominaService.calcular(id);
  }

  await pool.query('DROP TABLE IF EXISTS _demo_registros');
  await pool.query('DROP TABLE IF EXISTS _demo_estado');
  console.log(`\n  ✓ Muestra borrada. ${archivos} comprobante(s) eliminados del disco.\n`);
}

main()
  .catch((err) => {
    console.error(`\n  ✗ ${err.stack || err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
