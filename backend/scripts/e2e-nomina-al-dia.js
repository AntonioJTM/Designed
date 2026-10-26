'use strict';

/**
 * Prueba de la auditoría del 2026-10-26 en la NÓMINA:
 *
 *   · #8 · No se paga una nómina que ya no cuadra (decisión del usuario: "no dejar
 *     pagarla hasta recalcular"): si después de calcularla se liquida otra venta de
 *     esa semana, el periodo trae `por_recalcular` y pagarla da 409
 *     NOMINA_POR_RECALCULAR; al recalcularla, se paga.
 *   · #7 · La venta que se CANCELA después de pagarse su comisión: la siguiente nómina
 *     que se calcule la descuenta (un renglón 'devolucion' en negativo, `cancelada`),
 *     una sola vez aunque se recalcule.
 *
 * Todo en semanas de marzo de 2032 que nadie usa, con un empleado y ventas TMP
 * fechadas a mano, y se borra al final. Compara una foto de las tablas.
 *
 *   cd backend
 *   DB_NAME=desarrollo PORT=3210 node src/server.js &
 *   DB_NAME=desarrollo E2E_ACEPTO_PRODUCCION=si node scripts/e2e-nomina-al-dia.js
 *
 * Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';
// G: 7 a 13 de marzo de 2032; H: 14 a 20.
const SEMANAS = { G: '2032-03-10', H: '2032-03-17' };
const DOMINGOS = ['2032-03-07', '2032-03-14'];
const TABLAS = ['nomina_empleados', 'nomina_periodos', 'nomina_recibos', 'nomina_comisiones', 'pedidos', 'pagos', 'usuarios'];

let f = 0;
const ck = (n, ok, d) => {
  console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + JSON.stringify(d) : ''));
  if (!ok) f++;
};
const igual = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  const db = await m.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const foto = async () => {
    const r = {};
    for (const t of TABLAS) r[t] = Number((await db.query(`SELECT COUNT(*) n FROM ${t}`))[0][0].n);
    return r;
  };
  const antes = await foto();
  const [[existe]] = await db.query('SELECT COUNT(*) n FROM nomina_periodos WHERE fecha_inicio IN (?)', [DOMINGOS]);
  if (Number(existe.n)) {
    console.error('  ✗ Ya hay una nómina en las semanas de prueba (marzo de 2032). Revísala antes de correr esto.');
    process.exit(1);
  }

  const [[admin]] = await db.query(
    `SELECT u.id, r.id AS rol_id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = 'administrador' AND u.activo = 1 ORDER BY u.id LIMIT 1`
  );
  const [[cajero]] = await db.query("SELECT id FROM roles WHERE nombre = 'cajero' LIMIT 1");
  const [[efectivo]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Efectivo%' ORDER BY id LIMIT 1");
  const t = jwt.sign({ sub: admin.id, tipo: 'usuario', rol_id: admin.rol_id, rol: admin.rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const api = async (me, r, b) => {
    const x = await fetch(B + r, {
      method: me, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };

  const SUF = Date.now().toString(36).toUpperCase();
  const [u] = await db.query(
    'INSERT INTO usuarios (nombre, correo, contrasena_hash, rol_id, activo) VALUES (?, ?, ?, ?, 0)',
    ['TMP Lupe Vendedora', `tmp-nomina-aldia-${SUF}@prueba.local`, '$2b$10$TMPsinAccesoTMPsinAccesoTMPsinAccesoTMPsinAccesoTMPsi', cajero.id]
  );
  const uid = u.insertId;
  const periodos = {};
  const venta = async (n, subtotal, cuando) => {
    const [r] = await db.query(
      `INSERT INTO pedidos (numero_pedido, canal, encargo, metodo_entrega, usuario_id, estado, inventario_descontado,
                            subtotal, descuento, impuestos, costo_envio, total, creado_en)
       VALUES (?, 'punto_venta', 0, 'recoger', ?, 'pagado', 1, ?, 0, 0, 0, ?, ?)`,
      [`TMPAD-${SUF}-${n}`, uid, subtotal, subtotal, cuando]
    );
    await db.query("INSERT INTO pagos (pedido_id, metodo_pago_id, monto, estado, creado_en) VALUES (?, ?, ?, 'completado', ?)",
      [r.insertId, efectivo.id, subtotal, cuando]);
    return r.insertId;
  };
  const recibo = (p) => p?.recibos?.find((x) => x.usuario_id === uid);

  try {
    let r = await api('PUT', `/nomina/empleados/${uid}`, {
      sueldo_base_semanal: 1000, paga_comision: true, porcentaje_comision: 10, activo: true, fecha_ingreso: '2025-01-10',
    });
    ck('vendedora TMP con 10% de comisión', r.status === 200, r.error);

    // ---------------------------------------------------------------- #8
    console.log('\n=== Una venta nueva después de calcular: no se paga hasta recalcular ===');
    const v1 = await venta(1, 1000, '2032-03-08 10:00:00');
    r = await api('POST', '/nomina/periodos', { fecha: SEMANAS.G });
    periodos.G = r.data?.id;
    r = await api('POST', `/nomina/periodos/${periodos.G}/calcular`);
    ck('semana G calculada: $1,000 vendidos, $100 de comisión', igual(recibo(r.data)?.comision, 100), recibo(r.data)?.comision);
    ck('y al día (sin nada por recalcular)', !r.data?.por_recalcular, r.data?.por_recalcular);

    const v2 = await venta(2, 500, '2032-03-09 11:00:00');
    r = await api('GET', `/nomina/periodos/actual?fecha=${SEMANAS.G}`);
    const pr = r.data?.periodo?.por_recalcular;
    ck('el periodo dice que entró una venta (TMPAD-…-2)', pr?.nuevas?.length === 1 && pr.nuevas[0].numero_pedido.endsWith('-2'), pr);
    r = await api('PATCH', `/nomina/periodos/${periodos.G}/estado`, { estado: 'pagado' });
    ck('pagarla da 409 NOMINA_POR_RECALCULAR y lo dice', r.status === 409 && r.error?.code === 'NOMINA_POR_RECALCULAR'
      && /Vuelve a calcularla/.test(r.error?.message ?? ''), r.error);
    r = await api('POST', `/nomina/periodos/${periodos.G}/calcular`);
    ck('recalculada: $1,500 y $150 de comisión, ya al día', igual(recibo(r.data)?.comision, 150) && !r.data?.por_recalcular,
      [recibo(r.data)?.comision, r.data?.por_recalcular]);
    r = await api('PATCH', `/nomina/periodos/${periodos.G}/estado`, { estado: 'pagado' });
    ck('ahora sí se paga', r.status === 200 && r.data?.estado === 'pagado', r.error ?? r.data?.estado);

    // ---------------------------------------------------------------- #7
    console.log('\n=== La venta que se cancela después de pagarse: la siguiente nómina la descuenta ===');
    // Se cancela el lunes 15 (ya pagada su comisión en G).
    await db.query("UPDATE pedidos SET estado = 'cancelado', actualizado_en = '2032-03-15 09:00:00' WHERE id = ?", [v1]);
    // Y una venta de la semana H que se cancela en la misma semana: nunca paga.
    const v3 = await venta(3, 300, '2032-03-16 10:00:00');
    await db.query("UPDATE pedidos SET estado = 'cancelado', actualizado_en = '2032-03-16 12:00:00' WHERE id = ?", [v3]);
    r = await api('POST', '/nomina/periodos', { fecha: SEMANAS.H });
    periodos.H = r.data?.id;
    r = await api('POST', `/nomina/periodos/${periodos.H}/calcular`);
    ck('semana H: −$100 de comisión por la venta cancelada', igual(recibo(r.data)?.comision, -100), recibo(r.data)?.comision);
    let rep = (await api('GET', `/nomina/periodos/${periodos.H}/comisiones?usuario_id=${uid}`)).data?.vendedores?.[0];
    const linea = rep?.ventas?.find((x) => x.numero_pedido.endsWith('-1'));
    ck('el reporte lo dice: un descuento por cancelación de $1,000', linea?.tipo === 'devolucion' && linea?.cancelada === true
      && igual(linea?.venta_neta, -1000) && igual(linea?.comision, -100), linea);
    ck('la cancelada en su misma semana ni aparece', !(rep?.ventas ?? []).some((x) => x.numero_pedido.endsWith('-3')), rep?.ventas?.map((x) => x.numero_pedido));
    r = await api('POST', `/nomina/periodos/${periodos.H}/calcular`);
    ck('recalcular no lo descuenta dos veces', igual(recibo(r.data)?.comision, -100), recibo(r.data)?.comision);
    r = await api('GET', `/nomina/periodos/${periodos.H}/pdf?usuario_id=${uid}`);
    ck('el PDF de la semana H sale', r.status === 200 || r.status === undefined);
    void v2;
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    for (const p of Object.values(periodos).filter(Boolean)) await db.query('DELETE FROM nomina_periodos WHERE id = ?', [p]);
    const [peds] = await db.query('SELECT id FROM pedidos WHERE numero_pedido LIKE ?', [`TMPAD-${SUF}-%`]);
    if (peds.length) await db.query('DELETE FROM pagos WHERE pedido_id IN (?)', [peds.map((p) => p.id)]);
    await db.query('DELETE FROM pedidos WHERE numero_pedido LIKE ?', [`TMPAD-${SUF}-%`]);
    await db.query('DELETE FROM nomina_empleados WHERE usuario_id = ?', [uid]);
    await db.query('DELETE FROM usuarios WHERE id = ? AND correo LIKE ?', [uid, 'tmp-nomina-aldia-%']);
    const despues = await foto();
    ck('las tablas quedaron como estaban', JSON.stringify(antes) === JSON.stringify(despues), { antes, despues });
    await db.end();
  }
  console.log(f ? `\n${f} FALLAS` : '\nTodo bien.');
  process.exit(f ? 1 : 0);
})();
