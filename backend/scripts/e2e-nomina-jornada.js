'use strict';

/**
 * Prueba de la NÓMINA POR DÍAS, HORARIO, HORAS EXTRA Y VACACIONES (2026-10-06).
 *
 * Recorre lo que hace la pantalla, por la API:
 *   · el horario de un empleado da sus días, sus horas, lo que vale su día y su hora;
 *   · el recibo paga por días trabajados y conserva las faltas al recalcular;
 *   · las vacaciones se pagan como días normales, cuentan contra su saldo por
 *     ley y no se pueden poner en una semana ya pagada;
 *   · las horas extra se cuentan contra el horario de ESE día, al doble.
 *
 * Todo lo crea con TMP y en una semana de 2031 que nadie usa, y lo borra al
 * final: el empleado TMP (con su horario y vacaciones) y esa semana (con los
 * recibos que el cálculo les hace a los demás). Compara una foto de las tablas
 * de nómina antes y después.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-nomina-jornada.js   # contra la base de pruebas
 *
 * Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';
const SEMANA = '2031-03-12'; // miércoles; la semana va del domingo 9 al sábado 15
const TABLAS = ['nomina_empleados', 'nomina_horarios', 'nomina_vacaciones', 'nomina_periodos', 'nomina_recibos', 'nomina_recibo_conceptos'];

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
  const t = jwt.sign({ sub: admin.id, tipo: 'usuario', rol_id: admin.rol_id, rol: admin.rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const api = async (me, r, b) => {
    const x = await fetch(B + r, {
      method: me,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };

  const [[existe]] = await db.query('SELECT COUNT(*) n FROM nomina_periodos WHERE fecha_inicio = ?', ['2031-03-09']);
  if (Number(existe.n)) {
    console.error('  ✗ Ya hay una nómina en la semana de prueba (2031-03-09). Revísala antes de correr esto.');
    process.exit(1);
  }

  const correo = `tmp-nomina-${Date.now()}@prueba.local`;
  const [u] = await db.query(
    `INSERT INTO usuarios (nombre, correo, contrasena_hash, rol_id, activo) VALUES (?, ?, ?, ?, 0)`,
    ['TMP Nómina Jornada', correo, '$2b$10$TMPsinAccesoTMPsinAccesoTMPsinAccesoTMPsinAccesoTMPsi', cajero.id]
  );
  const uid = u.insertId;
  let periodoId = null;

  // Lunes a viernes de 9 a 18 y sábado de 10 a 14, con una hora de comida:
  // 5 × 8 + 3 = 43 horas. $1,800 a la semana → $300 el día, $41.86 la hora.
  const HORARIO = [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, hora_entrada: '09:00', hora_salida: '18:00' }))
    .concat([{ dia_semana: 6, hora_entrada: '10:00', hora_salida: '14:00' }]);

  try {
    console.log('=== 1. El horario dice sus días, sus horas y lo que vale su día y su hora ===');
    let r = await api('PUT', `/nomina/empleados/${uid}`, {
      sueldo_base_semanal: 1800, paga_comision: false, activo: true,
      fecha_ingreso: '2023-01-10', comida_min: 60, horario: HORARIO,
    });
    ck('se guarda', r.status === 200, r.error);
    ck('trabaja 6 días', r.data?.dias_laborales === 6, r.data?.dias_laborales);
    ck('43 horas a la semana', igual(r.data?.horas_semana, 43), r.data?.horas_semana);
    ck('su día vale $300', igual(r.data?.salario_diario, 300), r.data?.salario_diario);
    ck('su hora vale $41.86', igual(r.data?.valor_hora, 41.86), r.data?.valor_hora);
    ck('su hora extra, al doble: $83.72', igual(r.data?.valor_hora_extra_calculado, 83.72), r.data?.valor_hora_extra_calculado);
    ck('lleva 3 años: le tocan 16 días por ley', r.data?.vacaciones?.anios === 3 && r.data?.vacaciones?.corresponden === 16, r.data?.vacaciones);

    r = await api('PUT', `/nomina/empleados/${uid}`, {
      sueldo_base_semanal: 1800, horario: [{ dia_semana: 1, hora_entrada: '18:00', hora_salida: '09:00' }],
    });
    ck('una salida antes de la entrada se rechaza', r.status === 422 && r.error?.code === 'HORARIO_INVALIDO', r.error);
    r = await api('PUT', `/nomina/empleados/${uid}`, {
      sueldo_base_semanal: 1800, horario: [HORARIO[0], HORARIO[0]],
    });
    ck('un día repetido se rechaza', r.status === 422, r.error?.message);
    r = await api('PUT', `/nomina/empleados/${uid}`, { sueldo_base_semanal: 1800, paga_comision: false, activo: true });
    ck('guardar sin horario conserva el que tenía', r.data?.horario?.length === 6 && r.data?.fecha_ingreso === '2023-01-10', r.data?.horario?.length);

    console.log('=== 2. El recibo paga por días ===');
    r = await api('POST', '/nomina/periodos', { fecha: SEMANA });
    periodoId = r.data?.id;
    ck('se crea la semana de prueba', r.status === 201 && periodoId, r.error);
    r = await api('POST', `/nomina/periodos/${periodoId}/calcular`);
    let rec = r.data?.recibos?.find((x) => x.usuario_id === uid);
    ck('el recibo trae sus 6 días', Number(rec?.dias_laborales) === 6 && Number(rec?.dias_trabajados) === 6, rec && [rec.dias_laborales, rec.dias_trabajados]);
    ck('6 de 6 días = $1,800', igual(rec?.sueldo_base, 1800) && igual(rec?.total_pagar, 1800), rec?.total_pagar);
    ck('el recibo congela su día y su hora', igual(rec?.salario_diario, 300) && igual(rec?.valor_hora, 41.86));
    ck('el recibo trae su horario', rec?.horario?.length === 6);

    r = await api('PATCH', `/nomina/recibos/${rec.id}/dias`, { dias_trabajados: 5 });
    rec = r.data?.recibos?.find((x) => x.usuario_id === uid);
    ck('faltó un día: 5 × $300 = $1,500', igual(rec?.sueldo_base, 1500) && igual(rec?.total_pagar, 1500), rec?.total_pagar);
    r = await api('PATCH', `/nomina/recibos/${rec.id}/dias`, { dias_trabajados: 7 });
    ck('más días que su horario se rechaza', r.status === 422 && r.error?.code === 'DIAS_DE_MAS', r.error);
    r = await api('POST', `/nomina/periodos/${periodoId}/calcular`);
    rec = r.data?.recibos?.find((x) => x.usuario_id === uid);
    ck('recalcular conserva la falta', Number(rec?.dias_trabajados) === 5, rec?.dias_trabajados);

    console.log('=== 3. Vacaciones ===');
    r = await api('POST', `/nomina/empleados/${uid}/vacaciones`, { fecha_inicio: '2031-03-11', fecha_fin: '2031-03-12', notas: 'TMP' });
    ck('se registran martes y miércoles: 2 días', r.status === 201 && Number(r.data?.registros?.[0]?.dias) === 2, r.error ?? r.data?.registros?.[0]);
    r = await api('GET', `/nomina/periodos/actual?fecha=${SEMANA}`);
    rec = r.data?.periodo?.recibos?.find((x) => x.usuario_id === uid);
    ck('la semana se recalculó sola: 2 de vacaciones', Number(rec?.dias_vacaciones) === 2, rec?.dias_vacaciones);
    ck('la falta se conserva: trabajó 3', Number(rec?.dias_trabajados) === 3, rec?.dias_trabajados);
    ck('las vacaciones se pagan como días normales: $600', igual(rec?.pago_vacaciones, 600), rec?.pago_vacaciones);
    ck('sigue en $1,500 (3 trabajados + 2 de vacaciones)', igual(rec?.total_pagar, 1500), rec?.total_pagar);

    r = await api('POST', `/nomina/empleados/${uid}/vacaciones`, { fecha_inicio: '2031-03-12', fecha_fin: '2031-03-13' });
    ck('encimadas se rechazan', r.status === 409 && r.error?.code === 'VACACIONES_ENCIMADAS', r.error);
    r = await api('POST', `/nomina/empleados/${uid}/vacaciones`, { fecha_inicio: '2031-04-01', fecha_fin: '2031-05-30' });
    ck('más días de los que le quedan se rechaza', r.status === 422 && r.error?.code === 'VACACIONES_INSUFICIENTES', r.error?.message);
    r = await api('POST', `/nomina/empleados/${uid}/vacaciones`, { fecha_inicio: '2031-03-15', fecha_fin: '2031-03-15' });
    ck('un sábado gasta 1 día (trabaja sábados)', r.status === 201, r.error);
    const sabado = r.data?.registros?.find((x) => x.fecha_inicio === '2031-03-15');
    r = await api('DELETE', `/nomina/vacaciones/${sabado?.id}`);
    ck('y se puede quitar', r.status === 200, r.error);
    r = await api('POST', `/nomina/empleados/${uid}/vacaciones`, { fecha_inicio: '2031-03-16', fecha_fin: '2031-03-16' });
    ck('un domingo (su descanso) no gasta días', r.status === 422 && r.error?.code === 'SIN_DIAS_HABILES', r.error);
    r = await api('GET', `/nomina/empleados/${uid}/vacaciones`);
    ck('el saldo de hoy no cuenta las de 2031', r.data?.saldo?.tomados === 0 && r.data?.saldo?.restan === 16, r.data?.saldo);

    console.log('=== 4. Horas extra contra su horario de ese día, al doble ===');
    r = await api('POST', `/nomina/recibos/${rec.id}/horas-extra`, { fecha: '2031-03-13', hora_salida: '20:00' });
    rec = r.data?.recibos?.find((x) => x.usuario_id === uid);
    let he = rec?.conceptos?.find((c) => c.fecha === '2031-03-13');
    ck('jueves salió a las 20:00: 2 h', r.status === 201 && Number(he?.cantidad) === 2, r.error ?? he);
    ck('2 h × $41.86 × 2 = $167.44', igual(he?.importe, 167.44), he?.importe);
    ck('el recibo lo suma', igual(rec?.total_pagar, 1667.44), rec?.total_pagar);
    ck('dice contra qué horario', /salió 20:00 \(su salida: 18:00\)/.test(he?.descripcion ?? ''), he?.descripcion);
    r = await api('POST', `/nomina/recibos/${rec.id}/horas-extra`, { fecha: '2031-03-13', hora_salida: '21:00' });
    ck('el mismo día dos veces se rechaza', r.status === 409, r.error);
    r = await api('POST', `/nomina/recibos/${rec.id}/horas-extra`, { fecha: '2031-03-14', hora_salida: '17:30' });
    ck('salir antes de su hora no es extra', r.status === 422 && r.error?.code === 'SIN_HORAS_EXTRA', r.error?.message);
    r = await api('POST', `/nomina/recibos/${rec.id}/horas-extra`, { fecha: '2031-03-14', hora_entrada: '07:30' });
    he = r.data?.recibos?.find((x) => x.usuario_id === uid)?.conceptos?.find((c) => c.fecha === '2031-03-14');
    ck('viernes entró a las 7:30: 1.5 h', Number(he?.cantidad) === 1.5 && igual(he?.importe, 125.58), he && [he.cantidad, he.importe]);
    r = await api('POST', `/nomina/recibos/${rec.id}/horas-extra`, { fecha: '2031-03-09', hora_salida: '14:00' });
    ck('en su descanso pide entrada y salida', r.status === 422, r.error?.message);
    r = await api('POST', `/nomina/recibos/${rec.id}/horas-extra`, { fecha: '2031-03-09', hora_entrada: '10:00', hora_salida: '14:30' });
    he = r.data?.recibos?.find((x) => x.usuario_id === uid)?.conceptos?.find((c) => c.fecha === '2031-03-09');
    ck('domingo de 10:00 a 14:30: todo extra, 4.5 h = $376.74', Number(he?.cantidad) === 4.5 && igual(he?.importe, 376.74), he && [he.cantidad, he.importe]);
    r = await api('POST', `/nomina/recibos/${rec.id}/horas-extra`, { fecha: '2031-03-20', hora_salida: '20:00' });
    ck('un día de otra semana se rechaza', r.status === 422 && r.error?.code === 'FECHA_FUERA_DE_SEMANA', r.error);
    rec = r.data?.recibos?.find((x) => x.usuario_id === uid) ?? (await api('GET', `/nomina/periodos/actual?fecha=${SEMANA}`)).data.periodo.recibos.find((x) => x.usuario_id === uid);
    ck('total: 1500 + 167.44 + 125.58 + 376.74 = $2,169.76', igual(rec?.total_pagar, 2169.76), rec?.total_pagar);

    console.log('=== 5. Quitar vacaciones devuelve los días ===');
    r = await api('GET', `/nomina/empleados/${uid}/vacaciones`);
    const vac = r.data?.registros?.find((x) => x.fecha_inicio === '2031-03-11');
    r = await api('DELETE', `/nomina/vacaciones/${vac?.id}`);
    r = await api('GET', `/nomina/periodos/actual?fecha=${SEMANA}`);
    rec = r.data?.periodo?.recibos?.find((x) => x.usuario_id === uid);
    ck('vuelve a 5 trabajados, sin vacaciones', Number(rec?.dias_trabajados) === 5 && igual(rec?.pago_vacaciones, 0), rec && [rec.dias_trabajados, rec.pago_vacaciones]);
    ck('las horas extra se quedan', rec?.conceptos?.filter((c) => c.clave === 'horas_extra').length === 3);

    console.log('=== 6. Una semana pagada ya no se mueve ===');
    await api('POST', `/nomina/empleados/${uid}/vacaciones`, { fecha_inicio: '2031-03-12', fecha_fin: '2031-03-12' });
    r = await api('PATCH', `/nomina/periodos/${periodoId}/estado`, { estado: 'pagado' });
    ck('se marca pagada', r.status === 200, r.error);
    r = await api('POST', `/nomina/empleados/${uid}/vacaciones`, { fecha_inicio: '2031-03-13', fecha_fin: '2031-03-13' });
    ck('no se le agregan vacaciones', r.status === 409 && r.error?.code === 'SEMANA_PAGADA', r.error?.message);
    r = await api('GET', `/nomina/empleados/${uid}/vacaciones`);
    const pagada = r.data?.registros?.find((x) => x.fecha_inicio === '2031-03-12');
    r = await api('DELETE', `/nomina/vacaciones/${pagada?.id}`);
    ck('ni se le quitan las que ya pagó', r.status === 409, r.error?.message);
    r = await api('PATCH', `/nomina/recibos/${rec.id}/dias`, { dias_trabajados: 4 });
    ck('ni se le cambian los días', r.status === 409, r.error?.code);
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    if (periodoId) await db.query('DELETE FROM nomina_periodos WHERE id = ?', [periodoId]);
    await db.query('DELETE FROM usuarios WHERE id = ? AND correo LIKE ?', [uid, 'tmp-nomina-%']);
    const despues = await foto();
    ck('las tablas de nómina quedaron como estaban', JSON.stringify(antes) === JSON.stringify(despues), { antes, despues });
    await db.end();
  }
  console.log(f ? `\n${f} FALLAS` : '\nTodo bien.');
  process.exit(f ? 1 : 0);
})();
