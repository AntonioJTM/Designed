'use strict';

/**
 * Prueba de VENDER CONOS POR PESO (2026-10-06): "la gente solo dice 'vengo por 6
 * conos de tal color'; se pesan los conos y se calcula el precio con los precios
 * por kilo" (usuario).
 *
 * Recorre el flujo real con un hilo de prueba:
 *   · un paquete se baja a conos (Inventario → Bajar conos a mostrador), SOLO
 *     en una tienda y donde está el paquete, con el destare POR CONO (12 conos ×
 *     0.035 kg = 0.42 kg más);
 *   · la búsqueda de la caja, con su almacén, dice cuántos kilos enconados hay
 *     AHÍ y que ya no queda el paquete cerrado;
 *   · se venden 6 conos que pesaron 9.35 kg: se cobra 9.35 × el precio por kilo,
 *     se descuentan 9.35 kg y la venta guarda que eran 6 conos;
 *   · no se puede vender más de lo enconado, y las piezas son enteras.
 *
 * Crea "TMPVC …" (hilo, caja y turno) y lo borra al final.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-venta-conos.js   # contra la base de pruebas
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

  try {
    const [[cat]] = await db.query('SELECT id FROM categorias ORDER BY id LIMIT 1');
    const [[kg]] = await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");
    const [[efectivo]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Efectivo%' ORDER BY id LIMIT 1");

    console.log('=== 1. Un paquete se baja a conos ===');
    let r = await api('POST', '/productos', {
      categoria_id: cat.id, unidad_medida_id: kg.id, nombre: 'TMPVC ROJO ' + SUF, precio_kg: 200, multipresentacion: true,
    });
    const productoId = r.data?.id;
    r = await api('GET', `/productos/${productoId}`);
    const paquete = r.data?.variantes?.find((v) => v.tipo_presentacion === 'paquete');
    ck('hilo de prueba con su paquete a $200 el kg', !!paquete && Number(paquete.precio) === 200, paquete?.precio);
    await api('PATCH', `/variantes/${paquete.id}`, { peso_kg: 19 });

    // Caja PROPIA: nunca el turno de una caja real.
    const almacen = (await api('GET', '/caja/cajas')).data.find((c) => c.activo).almacen_id;
    const caja = (await api('POST', '/caja/cajas', { almacen_id: almacen, nombre: 'TMPVC Caja ' + SUF })).data;
    const sesion = (await api('POST', '/caja/sesiones', { caja_id: caja.id, monto_inicial: 0 })).data;
    ck('caja y turno de prueba', !!sesion?.id);

    const codigo = 'TMPVC-B1-' + SUF;
    r = await api('POST', `/variantes/${paquete.id}/codigos`, { codigo, peso_kg: 19.2, conos: 12, lote: 'L1' });
    ck('el paquete físico (19.2 kg, 12 conos)', r.status === 201, r.error);
    r = await api('POST', '/inventario/movimientos', { variante_id: paquete.id, almacen_id: almacen, tipo: 'entrada', cantidad: 19.2, motivo: 'Prueba TMPVC' });
    ck('entra a la tienda', r.status === 201 || r.status === 200, r.error);
    const [[bodega]] = await db.query('SELECT id FROM almacenes WHERE es_punto_venta = 0 AND activo = 1 ORDER BY id LIMIT 1');
    if (bodega) {
      r = await api('POST', '/inventario/desarmes', { codigo_bulto: codigo, almacen_origen_id: bodega.id, almacen_destino_id: bodega.id });
      ck('en la bodega no se bajan conos: 422 SOLO_EN_TIENDA', r.status === 422 && r.error?.code === 'SOLO_EN_TIENDA', r.error?.code);
      r = await api('POST', '/inventario/desarmes', { codigo_bulto: codigo, almacen_origen_id: bodega.id, almacen_destino_id: almacen });
      ck('ni se abre en la tienda un paquete de la bodega: 422', r.status === 422 && r.error?.code === 'DESARME_EN_OTRO_ALMACEN', r.error?.code);
    }
    if (bodega) {
      // El paquete tiene que estar EN la tienda (2026-10-06): anotado en la bodega, no se abre aquí.
      await db.query('UPDATE variante_codigos SET almacen_id = ? WHERE codigo = ?', [bodega.id, codigo]);
      r = await api('GET', `/inventario/desarmes/previa/${codigo}`);
      ck('la vista previa dice que el paquete está en la bodega', r.data?.bulto?.almacen_id === bodega.id && r.data?.bulto?.en_tienda === false,
        r.data?.bulto);
      r = await api('POST', '/inventario/desarmes', { codigo_bulto: codigo, almacen_origen_id: almacen, almacen_destino_id: almacen });
      ck('si el paquete no está en esa tienda: 409 PAQUETE_EN_OTRA_SUCURSAL', r.status === 409 && r.error?.code === 'PAQUETE_EN_OTRA_SUCURSAL',
        r.error?.message);
      await db.query('UPDATE variante_codigos SET almacen_id = ? WHERE codigo = ?', [almacen, codigo]);
    }
    r = await api('GET', `/inventario/desarmes/previa/${codigo}`);
    ck('ya en la tienda, la vista previa lo dice', r.data?.bulto?.almacen_id === almacen && r.data?.bulto?.en_tienda === true, r.data?.bulto);
    r = await api('POST', '/inventario/desarmes', {
      codigo_bulto: codigo, almacen_origen_id: almacen, almacen_destino_id: almacen, destare_por_cono_kg: 0.035,
    });
    ck('se baja a conos en la tienda', r.status === 201 || r.status === 200, r.error);
    ck('destare: 12 conos × 0.035 kg = 0.42 kg, entran 19.62 kg', r3(r.data?.destare_kg) === 0.42 && r3(r.data?.kg_enconados) === 19.62,
      { destare: r.data?.destare_kg, enconados: r.data?.kg_enconados });
    ck('del paquete se descuenta lo que pesaba (19.2 kg)', r3(r.data?.kg_consumidos) === 19.2, r.data?.kg_consumidos);

    console.log('\n=== 2. La búsqueda de la caja dice qué hay AHÍ ===');
    r = await api('GET', `/variantes?q=${encodeURIComponent('TMPVC ROJO ' + SUF)}&almacen_id=${almacen}`);
    const cono = r.data?.items?.find((v) => v.tipo_presentacion === 'cono');
    const paq = r.data?.items?.find((v) => v.tipo_presentacion === 'paquete');
    ck('el cono: 19.62 kg enconados', cono && r3(cono.aqui?.cantidad) === 19.62, cono?.aqui);
    ck('el paquete: ya no queda cerrado', paq && paq.aqui?.paquetes === 0 && r3(paq.aqui?.cantidad) === 0, paq?.aqui);
    ck('el cono cuesta lo mismo por kilo que el paquete', Number(cono?.precio) === 200, cono?.precio);
    r = await api('GET', `/variantes?q=${encodeURIComponent('TMPVC ROJO ' + SUF)}`);
    ck('sin almacén, la búsqueda no trae existencias', r.data?.items?.every((v) => v.aqui === undefined));

    console.log('\n=== 3. "Vengo por 6 conos": pesaron 9.35 kg ===');
    r = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id,
      items: [{ variante_id: cono.id, cantidad: 9.35, piezas: 6 }],
      pagos: [{ metodo_pago_id: efectivo.id, monto: 2000 }],
    });
    ck('se cobra', r.status === 201, r.error);
    const pedidoId = r.data?.id;
    ck('9.35 kg × $200 = $1,870', Number(r.data?.total) === 1870, r.data?.total);
    r = await api('GET', `/pedidos/${pedidoId}`);
    const linea = r.data?.detalle?.[0];
    ck('la venta dice que eran 6 conos y 9.35 kg', Number(linea?.piezas) === 6 && r3(linea?.cantidad) === 9.35, { piezas: linea?.piezas, cantidad: linea?.cantidad });
    r = await api('GET', `/variantes?q=${encodeURIComponent('TMPVC ROJO ' + SUF)}&almacen_id=${almacen}`);
    ck('quedan 10.27 kg enconados', r3(r.data?.items?.find((v) => v.id === cono.id)?.aqui?.cantidad) === 10.27);

    console.log('\n=== 4. Lo que no debe pasar ===');
    r = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id,
      items: [{ variante_id: cono.id, cantidad: 12.5, piezas: 8 }],
      pagos: [{ metodo_pago_id: efectivo.id, monto: 5000 }],
    });
    ck('más de lo enconado: 409 STOCK_INSUFICIENTE', r.status === 409 && r.error?.code === 'STOCK_INSUFICIENTE', r.error?.code);
    r = await api('POST', '/pedidos/cotizacion', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, items: [{ variante_id: cono.id, cantidad: 1, piezas: 1.5 }],
    });
    ck('conos con decimales: 422', r.status === 422, r.status);
    r = await api('POST', '/pedidos/cotizacion', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, items: [{ variante_id: cono.id, cantidad: 1, piezas: 0 }],
    });
    ck('cero conos: 422', r.status === 422, r.status);
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    console.log('\nLimpiando…');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    const [prods] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPVC %'");
    const pr = prods.map((x) => x.id);
    if (pr.length) {
      const [vs] = await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [pr]);
      const vids = vs.map((v) => v.id);
      if (vids.length) {
        const [peds] = await db.query('SELECT DISTINCT pedido_id FROM pedido_detalle WHERE variante_id IN (?)', [vids]);
        const pids = peds.map((x) => x.pedido_id);
        if (pids.length) {
          for (const tb of ['pagos', 'pedido_detalle']) await db.query(`DELETE FROM ${tb} WHERE pedido_id IN (?)`, [pids]);
          await db.query('DELETE FROM pedidos WHERE id IN (?)', [pids]);
        }
        await db.query('DELETE FROM variante_conversiones WHERE variante_origen_id IN (?) OR variante_destino_id IN (?)', [vids, vids]);
        for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) {
          await db.query(`DELETE FROM ${tb} WHERE variante_id IN (?)`, [vids]);
        }
        await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
      }
      await db.query('DELETE FROM productos WHERE id IN (?)', [pr]);
    }
    const [cjs] = await db.query("SELECT id FROM cajas WHERE nombre LIKE 'TMPVC Caja%'");
    if (cjs.length) {
      const [ses] = await db.query('SELECT id FROM sesiones_caja WHERE caja_id IN (?)', [cjs.map((x) => x.id)]);
      await borrarTurnosPropios(db, ses.map((x) => x.id));
      await borrarCajasSinTurnos(db, cjs.map((x) => x.id));
    }
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    const [[{ n }]] = await db.query(
      "SELECT (SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPVC %') + (SELECT COUNT(*) FROM cajas WHERE nombre LIKE 'TMPVC Caja%') AS n"
    );
    ck('no quedó basura (TMPVC)', Number(n) === 0, n);
    await db.end();
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
