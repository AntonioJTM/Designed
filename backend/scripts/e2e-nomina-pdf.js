'use strict';

/**
 * Prueba de las COMISIONES y del PDF de la nómina.
 *
 *   · El ENVÍO no cuenta (2026-10-07): un pedido de $1,000 + $120 de envío da
 *     $1,000 de venta neta.
 *   · La comisión se paga la semana en que la venta queda LIQUIDADA, completa y
 *     una sola vez (2026-10-07: "si vendió a crédito y cerré mi nómina, no se
 *     mete; cuando se liquide, ahí se agrega"): la de contado en su semana; la
 *     fiada, el apartado y el pedido cuando se terminan de pagar; lo que se
 *     liquidó en una semana ya cerrada entra en la siguiente; una nómina
 *     cancelada suelta sus ventas.
 *   · El reporte de comisiones dice qué venta paga cada recibo y qué falta por
 *     liquidar.
 *   · El PDF sale con el resumen y un recibo por persona; el de una persona, en
 *     UNA hoja; sin recibos, 409; una persona sin recibo, 404.
 *
 * Todo en semanas de 2031 que nadie usa, con un empleado, clientes y ventas
 * TMP fechadas a mano, y se borra al final. Compara una foto de las tablas antes
 * y después. Con SALIDA=<carpeta> guarda los PDF para mirarlos.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-nomina-pdf.js   # contra la base de pruebas
 *
 * Sale 1 si algo falla.
 */

const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';
// Semanas de prueba (domingo a sábado): A 11–17, B 18–24, C 25–31 de mayo y D 1–7 de junio de 2031.
const SEMANAS = { A: '2031-05-14', B: '2031-05-21', C: '2031-05-28', D: '2031-06-04' };
const DOMINGOS = ['2031-05-11', '2031-05-18', '2031-05-25', '2031-06-01'];
const TABLAS = ['nomina_empleados', 'nomina_horarios', 'nomina_vacaciones', 'nomina_periodos', 'nomina_recibos',
  'nomina_recibo_conceptos', 'nomina_comisiones', 'pedidos', 'pagos', 'credito_movimientos', 'clientes', 'usuarios'];

let f = 0;
const ck = (n, ok, d) => {
  console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + JSON.stringify(d) : ''));
  if (!ok) f++;
};
const igual = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
/** Cuántas hojas trae un PDF de pdfkit (los objetos de página van sin comprimir). */
const hojas = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

(async () => {
  const db = await m.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const foto = async () => {
    const r = {};
    for (const t of TABLAS) {
      const [[x]] = await db.query(`SELECT COUNT(*) n FROM ${t}`);
      r[t] = Number(x.n);
    }
    return r;
  };
  const antes = await foto();

  const [[admin]] = await db.query(
    `SELECT u.id, r.id AS rol_id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = 'administrador' AND u.activo = 1 ORDER BY u.id LIMIT 1`
  );
  const [[cajero]] = await db.query("SELECT id FROM roles WHERE nombre = 'cajero' LIMIT 1");
  const [[efectivo]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Efectivo%' ORDER BY id LIMIT 1");
  const t = jwt.sign({ sub: admin.id, tipo: 'usuario', rol_id: admin.rol_id, rol: admin.rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const api = async (me, r, b) => {
    const x = await fetch(B + r, {
      method: me,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };
  const bajar = async (r) => {
    const x = await fetch(B + r, { headers: { Authorization: 'Bearer ' + t } });
    const buf = Buffer.from(await x.arrayBuffer());
    let error = null;
    if (!x.ok) error = JSON.parse(buf.toString('utf8')).error;
    return { status: x.status, tipo: x.headers.get('content-type'), nombre: x.headers.get('content-disposition'), buf, error };
  };

  const [[existe]] = await db.query('SELECT COUNT(*) n FROM nomina_periodos WHERE fecha_inicio IN (?)', [DOMINGOS]);
  if (Number(existe.n)) {
    console.error('  ✗ Ya hay una nómina en las semanas de prueba (mayo y junio de 2031). Revísala antes de correr esto.');
    process.exit(1);
  }

  const SUF = Date.now().toString(36).toUpperCase();
  const [u] = await db.query(
    `INSERT INTO usuarios (nombre, correo, contrasena_hash, rol_id, activo) VALUES (?, ?, ?, ?, 0)`,
    ['TMP Rosa Hernández', `tmp-nomina-pdf-${SUF}@prueba.local`, '$2b$10$TMPsinAccesoTMPsinAccesoTMPsinAccesoTMPsinAccesoTMPsi', cajero.id]
  );
  const uid = u.insertId;
  const cliente = async (nombre) => (await db.query('INSERT INTO clientes (nombre) VALUES (?)', [`TMP ${nombre} ${SUF}`]))[0].insertId;
  const doniaChela = await cliente('Doña Chela');
  const donJuan = await cliente('Don Juan');
  const periodos = {};

  // Una venta TMP de la vendedora, con su fecha.
  const venta = async (n, x) => {
    const total = x.subtotal + (x.envio ?? 0);
    const [r] = await db.query(
      `INSERT INTO pedidos (numero_pedido, canal, encargo, metodo_entrega, usuario_id, cliente_id, estado,
                            inventario_descontado, subtotal, descuento, impuestos, costo_envio, total, creado_en)
       VALUES (?, 'punto_venta', ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
      [`TMPNP-${SUF}-${n}`, x.encargo ?? 0, x.envio ? 'envio' : 'recoger', uid, x.cliente ?? null, x.estado ?? 'pagado',
        x.estado === 'apartado' ? 0 : 1, x.subtotal, x.envio ?? 0, total, x.cuando]
    );
    return r.insertId;
  };
  const pago = (pedido, monto, cuando) => db.query(
    `INSERT INTO pagos (pedido_id, metodo_pago_id, monto, estado, creado_en) VALUES (?, ?, ?, 'completado', ?)`,
    [pedido, efectivo.id, monto, cuando]
  );
  const credito = (clienteId, tipo, monto, cuando, pedido = null) => db.query(
    `INSERT INTO credito_movimientos (cliente_id, tipo, monto, pedido_id, creado_en) VALUES (?, ?, ?, ?, ?)`,
    [clienteId, tipo, monto, pedido, cuando]
  );
  const calcular = async (sem) => {
    let r = await api('POST', '/nomina/periodos', { fecha: SEMANAS[sem] });
    periodos[sem] = r.data?.id;
    r = await api('POST', `/nomina/periodos/${periodos[sem]}/calcular`);
    return r.data?.recibos?.find((x) => x.usuario_id === uid);
  };
  const reporte = async (sem) => (await api('GET', `/nomina/periodos/${periodos[sem]}/comisiones?usuario_id=${uid}`)).data?.vendedores?.[0];
  const folios = (lista) => (lista ?? []).map((v) => v.numero_pedido.split('-').pop()).sort().join(',');

  // Lunes a viernes de 9 a 18 y sábado de 10 a 14: $1,800 a la semana. Comisión del 3%.
  const HORARIO = [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, hora_entrada: '09:00', hora_salida: '18:00' }))
    .concat([{ dia_semana: 6, hora_entrada: '10:00', hora_salida: '14:00' }]);

  try {
    let r = await api('PUT', `/nomina/empleados/${uid}`, {
      sueldo_base_semanal: 1800, paga_comision: true, porcentaje_comision: 3, activo: true,
      fecha_ingreso: '2023-01-10', comida_min: 60, horario: HORARIO,
    });
    ck('empleada TMP: $1,800, 3% de comisión, lunes a sábado', r.status === 200, r.error);
    r = await api('POST', `/nomina/empleados/${uid}/vacaciones`, { fecha_inicio: '2031-05-15', fecha_fin: '2031-05-15', notas: 'TMP' });
    ck('un día de vacaciones (jueves 15)', r.status === 201, r.error);

    // Semana A: lo que vendió.
    const s1 = await venta(1, { subtotal: 500, cuando: '2031-05-12 10:00:00' });
    await pago(s1, 500, '2031-05-12 10:00:00');
    const s2 = await venta(2, { subtotal: 1000, envio: 120, encargo: 1, cliente: doniaChela, estado: 'entregado', cuando: '2031-05-12 11:00:00' });
    await pago(s2, 1120, '2031-05-12 11:00:00');
    const s3 = await venta(3, { subtotal: 800, cliente: doniaChela, estado: 'pendiente', cuando: '2031-05-13 12:00:00' });
    await credito(doniaChela, 'cargo', 800, '2031-05-13 12:00:00', s3);
    await credito(doniaChela, 'abono', 300, '2031-05-14 09:00:00');
    const s4 = await venta(4, { subtotal: 600, cliente: donJuan, estado: 'apartado', cuando: '2031-05-14 13:00:00' });
    await pago(s4, 100, '2031-05-14 13:00:00');
    await venta(5, { subtotal: 900, estado: 'cancelado', cuando: '2031-05-14 15:00:00' });
    const s7 = await venta(7, { subtotal: 200, cliente: donJuan, estado: 'pendiente', cuando: '2031-05-15 16:00:00' });
    await credito(donJuan, 'cargo', 200, '2031-05-15 16:00:00', s7);

    console.log('\n=== 1. Semana A: solo paga lo que quedó liquidado; el envío no cuenta ===');
    let rec = await calcular('A');
    ck('venta neta $1,500: contado $500 + pedido $1,000 (sin los $120 de envío)', igual(rec?.ventas_netas, 1500) && Number(rec?.num_pedidos) === 2,
      rec && [rec.ventas_netas, rec.num_pedidos]);
    ck('comisión 3% = $45 (la fiada, el apartado y la cancelada no)', igual(rec?.comision, 45), rec?.comision);
    let rep = await reporte('A');
    ck('el reporte dice qué ventas paga: la de contado y el pedido', folios(rep?.ventas) === '1,2' &&
      rep?.ventas?.find((v) => v.numero_pedido.endsWith('-2'))?.tipo === 'pedido', rep?.ventas?.map((v) => [v.numero_pedido, v.tipo]));
    ck('y qué falta por liquidar: la fiada (debe $500), el apartado (debe $500) y la fiada de Don Juan', folios(rep?.por_liquidar) === '3,4,7' &&
      igual(rep?.por_liquidar?.find((v) => v.numero_pedido.endsWith('-3'))?.falta, 500), rep?.por_liquidar?.map((v) => [v.numero_pedido, v.falta]));
    ck('su comisión por liquidar: 3% de $1,600 = $48', igual(rep?.por_liquidar_comision, 48), rep?.por_liquidar_comision);

    r = await api('POST', `/nomina/recibos/${rec.id}/horas-extra`, { fecha: '2031-05-13', hora_salida: '20:00' });
    ck('2 h extra el martes', r.status === 201 || r.status === 200, r.error);
    r = await api('POST', `/nomina/recibos/${rec.id}/conceptos`, { clave: 'descuento', importe: 100, descripcion: 'TMP préstamo' });
    ck('un descuento de $100', r.status === 201 || r.status === 200, r.error);

    console.log('\n=== 2. El PDF de la semana A ===');
    let x = await bajar(`/nomina/periodos/${periodos.A}/pdf`);
    const [[{ recibos }]] = await db.query('SELECT COUNT(*) AS recibos FROM nomina_recibos WHERE periodo_id = ?', [periodos.A]);
    ck('sale un PDF', x.status === 200 && x.tipo === 'application/pdf' && x.buf.subarray(0, 4).toString() === '%PDF', [x.status, x.tipo]);
    ck(`el resumen, el reporte de comisiones y un recibo por persona (${2 + Number(recibos)} hojas o más)`, hojas(x.buf) >= 2 + Number(recibos), hojas(x.buf));
    ck('se llama como la semana', /N%C3%B3mina%2011%20al%2017%20may%202031\.pdf/.test(x.nombre ?? ''), x.nombre);
    if (process.env.SALIDA) fs.writeFileSync(path.join(process.env.SALIDA, 'nomina-semana.pdf'), x.buf);
    x = await bajar(`/nomina/periodos/${periodos.A}/pdf?usuario_id=${uid}`);
    ck('el de una persona: su recibo en UNA hoja y detrás el detalle de sus comisiones', x.status === 200 && hojas(x.buf) === 2, hojas(x.buf));
    ck('y se llama con su nombre', /Recibo%20TMP%20Rosa/.test(x.nombre ?? ''), x.nombre);
    if (process.env.SALIDA) fs.writeFileSync(path.join(process.env.SALIDA, 'nomina-recibo.pdf'), x.buf);
    x = await bajar(`/nomina/periodos/${periodos.A}/pdf?usuario_id=999999999`);
    ck('una persona sin recibo esa semana: 404', x.status === 404, x.error?.code);
    x = await bajar('/nomina/periodos/999999999/pdf');
    ck('una semana que no existe: 404', x.status === 404, x.error?.code);

    r = await api('PATCH', `/nomina/periodos/${periodos.A}/estado`, { estado: 'pagado' });
    ck('se cierra la semana A (pagada)', r.status === 200, r.error);

    console.log('\n=== 3. Semana B: la fiada se termina de pagar ===');
    await credito(doniaChela, 'abono', 500, '2031-05-20 10:00:00');
    r = await api('POST', '/nomina/periodos', { fecha: SEMANAS.B });
    periodos.B = r.data?.id;
    x = await bajar(`/nomina/periodos/${periodos.B}/pdf`);
    ck('una nómina sin calcular no da PDF: 409 SIN_RECIBOS', x.status === 409 && x.error?.code === 'SIN_RECIBOS', x.error?.code);
    r = await api('POST', `/nomina/periodos/${periodos.B}/calcular`);
    rec = r.data?.recibos?.find((y) => y.usuario_id === uid);
    ck('la fiada de la semana A se paga en B, completa: $800 → $24', igual(rec?.ventas_netas, 800) && igual(rec?.comision, 24),
      rec && [rec.ventas_netas, rec.comision]);
    rep = await reporte('B');
    const fiada = rep?.ventas?.[0];
    ck('el reporte: fiada, vendida el 13 y liquidada el 20', fiada?.tipo === 'credito' && fiada?.vendida_en?.startsWith('2031-05-13') &&
      fiada?.liquidada_en?.startsWith('2031-05-20'), fiada);
    ck('lo de contado de la semana A no se vuelve a pagar', folios(rep?.ventas) === '3', folios(rep?.ventas));
    r = await api('PATCH', `/nomina/periodos/${periodos.B}/estado`, { estado: 'pagado' });
    ck('se cierra la semana B', r.status === 200, r.error);

    console.log('\n=== 4. Se liquida en una semana YA cerrada: entra en la siguiente ===');
    await credito(donJuan, 'abono', 200, '2031-05-22 10:00:00'); // la fiada de Don Juan, en la semana B ya pagada
    await pago(s4, 500, '2031-05-27 12:00:00'); // el apartado, en la semana C
    rec = await calcular('C');
    rep = await reporte('C');
    ck('la semana C paga la fiada liquidada el 22 (semana cerrada) y el apartado liquidado el 27: $800 → $24',
      igual(rec?.ventas_netas, 800) && igual(rec?.comision, 24) && folios(rep?.ventas) === '4,7', rep?.ventas?.map((v) => [v.numero_pedido, v.liquidada_en]));
    ck('ya no le queda nada por liquidar', (rep?.por_liquidar ?? []).length === 0, rep?.por_liquidar);
    r = await api('POST', `/nomina/periodos/${periodos.C}/calcular`);
    rec = r.data?.recibos?.find((y) => y.usuario_id === uid);
    ck('recalcular no duplica', igual(rec?.ventas_netas, 800) && Number(rec?.num_pedidos) === 2, rec && [rec.ventas_netas, rec.num_pedidos]);

    const [[todo]] = await db.query(
      `SELECT COALESCE(SUM(r.comision), 0) AS comision, COALESCE(SUM(r.ventas_netas), 0) AS neta
         FROM nomina_recibos r JOIN nomina_periodos p ON p.id = r.periodo_id
        WHERE r.usuario_id = ? AND p.estado <> 'cancelado'`, [uid]
    );
    ck('en total cada venta pagó UNA vez: $3,100 de venta neta, $93 de comisión', igual(todo.neta, 3100) && igual(todo.comision, 93), todo);

    console.log('\n=== 5. Una nómina cancelada suelta sus ventas ===');
    r = await api('PATCH', `/nomina/periodos/${periodos.C}/estado`, { estado: 'cancelado' });
    ck('se cancela la semana C', r.status === 200, r.error);
    rec = await calcular('D');
    ck('la semana D las vuelve a tomar ($800 → $24)', igual(rec?.ventas_netas, 800) && igual(rec?.comision, 24), rec && [rec.ventas_netas, rec.comision]);
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    for (const p of Object.values(periodos).filter(Boolean)) await db.query('DELETE FROM nomina_periodos WHERE id = ?', [p]);
    const [peds] = await db.query('SELECT id FROM pedidos WHERE numero_pedido LIKE ?', [`TMPNP-${SUF}-%`]);
    if (peds.length) await db.query('DELETE FROM pagos WHERE pedido_id IN (?)', [peds.map((p) => p.id)]);
    await db.query('DELETE FROM credito_movimientos WHERE cliente_id IN (?, ?)', [doniaChela, donJuan]);
    await db.query('DELETE FROM pedidos WHERE numero_pedido LIKE ?', [`TMPNP-${SUF}-%`]);
    await db.query('DELETE FROM clientes WHERE id IN (?, ?)', [doniaChela, donJuan]);
    await db.query('DELETE FROM usuarios WHERE id = ? AND correo LIKE ?', [uid, 'tmp-nomina-pdf-%']);
    const despues = await foto();
    ck('las tablas quedaron como estaban', JSON.stringify(antes) === JSON.stringify(despues), { antes, despues });
    await db.end();
  }
  console.log(f ? `\n${f} FALLAS` : '\nTodo bien.');
  process.exit(f ? 1 : 0);
})();
