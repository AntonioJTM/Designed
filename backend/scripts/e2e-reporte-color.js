'use strict';

/**
 * Prueba del reporte "Venta por color" (GET /reportes/venta-por-color).
 *
 * NO ESCRIBE NADA: solo pide el reporte y coteja sus cifras contra la base con
 * consultas directas (de solo lectura). Comprueba:
 *   · que pide sesión de personal (sin token 401, un cliente 403);
 *   · que lo vendido del periodo es lo que salió del inventario: sin
 *     cancelados, sin devueltos y sin apartados sin entregar;
 *   · que la existencia y lo vendido desde siempre de un hilo cuadran con
 *     `inventario` y `pedido_detalle`, sumando TODAS sus presentaciones;
 *   · los porcentajes, el orden, la búsqueda por palabras ("2-30" = "2/30")
 *     y que una fecha mal escrita da 422 y no 500.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si BASE=http://localhost:3210/api/v1 node scripts/e2e-reporte-color.js
 *
 * Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';

let f = 0;
const ck = (n, ok, d) => {
  console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + d : ''));
  if (!ok) f++;
};
// Los kilos van a 3 decimales y los porcentajes a 2: se comparan con esa holgura.
const casi = (a, b, tol = 0.0015) => Math.abs(Number(a) - Number(b)) <= tol;

/** 'YYYY-MM-DD' en hora local, n días atrás. */
function diaLocal(atras = 0) {
  const d = new Date();
  d.setDate(d.getDate() - atras);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function diaSiguiente(s) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

(async () => {
  const db = await m.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    dateStrings: true, timezone: process.env.DB_TIMEZONE || '-06:00',
  });
  await db.query(`SET time_zone = '${process.env.DB_TIMEZONE || '-06:00'}'`);

  const [[admin]] = await db.query(
    `SELECT u.id, r.id AS rol_id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.activo = 1 AND r.nombre = 'administrador' ORDER BY u.id LIMIT 1`
  );
  if (!admin) throw new Error('No hay un administrador activo');
  const token = jwt.sign({ sub: admin.id, tipo: 'usuario', rol_id: admin.rol_id, rol: admin.rol },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  const tokenCliente = jwt.sign({ sub: 999999999, tipo: 'cliente' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const get = async (ruta, t = token) => {
    const x = await fetch(B + ruta, { headers: t ? { Authorization: 'Bearer ' + t } : {} });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };

  // Lo VENDIDO, igual que el reporte: salió del inventario.
  const VENDIDO = "ped.estado NOT IN ('cancelado','devuelto') AND ped.inventario_descontado = 1";

  try {
    const desde = diaLocal(89);
    const hasta = diaLocal(0);
    const hastaExcl = diaSiguiente(hasta);
    const qs = `?desde=${desde}&hasta=${hasta}`;

    console.log(`=== 1. Quién lo puede pedir (${desde} a ${hasta}) ===`);
    let r = await get('/reportes/venta-por-color' + qs, null);
    ck('sin sesión: 401', r.status === 401, r.status);
    r = await get('/reportes/venta-por-color' + qs, tokenCliente);
    ck('un cliente: 403', r.status === 403, r.status);

    r = await get('/reportes/venta-por-color' + qs);
    ck('el administrador: 200', r.status === 200, r.status);
    const rep = r.data;
    ck('trae rango, periodo, totales e hilos',
      rep && rep.rango?.desde === desde && rep.rango?.hasta === hasta && rep.periodo && rep.totales && Array.isArray(rep.hilos),
      JSON.stringify(rep?.rango));

    console.log('=== 2. Lo vendido en el periodo cuadra con la base ===');
    const [[sql]] = await db.query(
      `SELECT COALESCE(SUM(d.cantidad), 0) AS kg, COALESCE(SUM(d.subtotal), 0) AS importe
         FROM pedido_detalle d JOIN pedidos ped ON ped.id = d.pedido_id
        WHERE ${VENDIDO} AND ped.creado_en >= ? AND ped.creado_en < ?`,
      [`${desde} 00:00:00`, `${hastaExcl} 00:00:00`]
    );
    ck('kilos del periodo = SUM(pedido_detalle) de lo que salió', casi(rep.periodo.kg_vendidos, sql.kg),
      `${rep.periodo.kg_vendidos} vs ${sql.kg}`);
    ck('importe del periodo = SUM(subtotal)', casi(rep.periodo.importe, sql.importe, 0.01),
      `${rep.periodo.importe} vs ${sql.importe}`);
    ck('sin filtro, la suma de los hilos es todo el periodo', casi(rep.totales.kg_vendidos, rep.periodo.kg_vendidos),
      `${rep.totales.kg_vendidos} vs ${rep.periodo.kg_vendidos}`);
    ck('sin filtro, los hilos suman el 100% del periodo',
      rep.periodo.kg_vendidos === 0 || casi(rep.totales.pct_del_periodo, 100, 0.01), rep.totales.pct_del_periodo);

    // "Ventas por día" sí cuenta el apartado sin entregar: la diferencia tiene que ser exactamente eso.
    const ventas = (await get('/reportes/ventas' + qs)).data;
    const [[apartado]] = await db.query(
      `SELECT COALESCE(SUM(d.cantidad), 0) AS kg
         FROM pedido_detalle d JOIN pedidos ped ON ped.id = d.pedido_id
        WHERE ped.estado NOT IN ('cancelado','devuelto') AND ped.inventario_descontado = 0
          AND ped.creado_en >= ? AND ped.creado_en < ?`,
      [`${desde} 00:00:00`, `${hastaExcl} 00:00:00`]
    );
    ck('"Ventas por día" − este reporte = apartados sin entregar',
      casi(Number(ventas.resumen.kilos) - rep.periodo.kg_vendidos, apartado.kg),
      `${ventas.resumen.kilos} − ${rep.periodo.kg_vendidos} vs ${apartado.kg}`);

    console.log('=== 3. Qué hilos salen y en qué orden ===');
    const [[cuenta]] = await db.query(
      `SELECT COUNT(*) AS n FROM productos p
        WHERE EXISTS (SELECT 1 FROM pedido_detalle d JOIN pedidos ped ON ped.id = d.pedido_id
                        JOIN producto_variantes pv ON pv.id = d.variante_id
                       WHERE pv.producto_id = p.id AND ${VENDIDO}
                         AND ped.creado_en >= ? AND ped.creado_en < ?)
           OR (SELECT COALESCE(SUM(i.cantidad), 0) FROM inventario i
                 JOIN producto_variantes pv ON pv.id = i.variante_id WHERE pv.producto_id = p.id) > 0`,
      [`${desde} 00:00:00`, `${hastaExcl} 00:00:00`]
    );
    ck('un renglón por hilo con venta en el periodo o con existencias', rep.hilos.length === Number(cuenta.n),
      `${rep.hilos.length} vs ${cuenta.n}`);
    ck('num_hilos = renglones', rep.totales.num_hilos === rep.hilos.length);
    ck('ningún hilo repetido (se agrupa por producto_id)',
      new Set(rep.hilos.map((h) => h.producto_id)).size === rep.hilos.length);
    ck('todos vendieron en el periodo o tienen existencias',
      rep.hilos.every((h) => h.kg_vendidos > 0 || h.existencia > 0));
    let ordenado = true;
    for (let i = 1; i < rep.hilos.length; i++) {
      if (rep.hilos[i].kg_vendidos > rep.hilos[i - 1].kg_vendidos) ordenado = false;
    }
    ck('del que más kilos vendió al que menos', ordenado);
    const conVenta = rep.hilos.filter((h) => h.kg_vendidos > 0).length;
    ck('num_con_venta = los que vendieron', rep.totales.num_con_venta === conVenta, conVenta);

    console.log('=== 4. Un hilo, contra la base ===');
    // El que más vendió (o, sin ventas, el primero con existencias).
    const h = rep.hilos[0];
    if (!h) {
      ck('hay al menos un hilo para cotejar', false, 'la base no tiene ventas ni existencias');
    } else {
      console.log(`      ${h.color} ${h.calibre ?? ''} (producto ${h.producto_id})`);
      const [[ex]] = await db.query(
        `SELECT COALESCE(SUM(i.cantidad), 0) AS kg FROM inventario i
           JOIN producto_variantes pv ON pv.id = i.variante_id WHERE pv.producto_id = ?`,
        [h.producto_id]
      );
      ck('existencia = SUM(inventario) de todas sus presentaciones y almacenes', casi(h.existencia, ex.kg),
        `${h.existencia} vs ${ex.kg}`);
      const [[vt]] = await db.query(
        `SELECT COALESCE(SUM(d.cantidad), 0) AS kg,
                COALESCE(SUM(CASE WHEN ped.creado_en >= ? AND ped.creado_en < ? THEN d.cantidad END), 0) AS kg_periodo,
                DATE_FORMAT(MAX(ped.creado_en), '%Y-%m-%d') AS ultima
           FROM pedido_detalle d JOIN pedidos ped ON ped.id = d.pedido_id
           JOIN producto_variantes pv ON pv.id = d.variante_id
          WHERE pv.producto_id = ? AND ${VENDIDO}`,
        [`${desde} 00:00:00`, `${hastaExcl} 00:00:00`, h.producto_id]
      );
      ck('vendido desde siempre = SUM(pedido_detalle) de todas sus presentaciones', casi(h.vendido_total, vt.kg),
        `${h.vendido_total} vs ${vt.kg}`);
      ck('kilos del periodo', casi(h.kg_vendidos, vt.kg_periodo), `${h.kg_vendidos} vs ${vt.kg_periodo}`);
      ck('última venta', h.ultima_venta === vt.ultima, `${h.ultima_venta} vs ${vt.ultima}`);
      const pctP = rep.periodo.kg_vendidos > 0 ? (100 * h.kg_vendidos) / rep.periodo.kg_vendidos : null;
      ck('% del periodo = sus kilos ÷ todo lo vendido',
        pctP === null ? h.pct_del_periodo === null : casi(h.pct_del_periodo, pctP, 0.006), `${h.pct_del_periodo} vs ${pctP}`);
      const den = h.vendido_total + Math.max(0, h.existencia);
      const pctV = den > 0 ? (100 * h.vendido_total) / den : null;
      ck('% ya vendido = vendido ÷ (vendido + lo que queda)',
        pctV === null ? h.pct_vendido === null : casi(h.pct_vendido, pctV, 0.006), `${h.pct_vendido} vs ${pctV}`);

      console.log('=== 5. Buscar por palabras ===');
      const q = [h.color, String(h.calibre ?? '').replace('/', '-')].join(' ').trim();
      const rq = await get('/reportes/venta-por-color' + qs + '&q=' + encodeURIComponent(q));
      ck(`"${q}" da 200`, rq.status === 200, rq.status);
      const hq = rq.data?.hilos.find((x) => x.producto_id === h.producto_id);
      ck('lo encuentra (el calibre con guion = con diagonal)', !!hq);
      ck('todos los encontrados tienen ese calibre',
        rq.data?.hilos.every((x) => !h.calibre || x.calibre === h.calibre), rq.data?.hilos.length);
      ck('el % del periodo se sigue midiendo contra TODO lo vendido',
        hq && hq.pct_del_periodo === h.pct_del_periodo && rq.data.periodo.kg_vendidos === rep.periodo.kg_vendidos,
        `${hq?.pct_del_periodo} vs ${h.pct_del_periodo}`);
      ck('regresa lo que se buscó', rq.data?.q === q, rq.data?.q);
      const nada = await get('/reportes/venta-por-color' + qs + '&q=' + encodeURIComponent('zzzz-no-existe-zzzz'));
      ck('una búsqueda sin coincidencias da la lista vacía', nada.status === 200 && nada.data.hilos.length === 0 &&
        nada.data.totales.num_hilos === 0, nada.data?.hilos?.length);
    }

    console.log('=== 6. Desde siempre, lo del periodo es lo vendido total ===');
    const todo = (await get(`/reportes/venta-por-color?desde=2000-01-01&hasta=${hasta}`)).data;
    ck('cada hilo: kilos del periodo = vendido desde siempre',
      todo.hilos.every((x) => casi(x.kg_vendidos, x.vendido_total)),
      todo.hilos.filter((x) => !casi(x.kg_vendidos, x.vendido_total)).map((x) => x.producto_id).join(',') || 'todos');

    console.log('=== 7. Fechas ===');
    const alReves = (await get(`/reportes/venta-por-color?desde=${hasta}&hasta=${desde}`)).data;
    ck('un rango al revés se voltea', alReves.rango.desde === desde && alReves.periodo.kg_vendidos === rep.periodo.kg_vendidos,
      JSON.stringify(alReves.rango));
    r = await get('/reportes/venta-por-color?desde=ayer&hasta=' + hasta);
    ck('una fecha mal escrita: 422, no 500', r.status === 422 && r.error?.code === 'VALIDACION', r.status);
  } finally {
    await db.end();
  }

  console.log(f ? `\n${f} FALLA(S)` : '\nTodo bien.');
  process.exit(f ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
