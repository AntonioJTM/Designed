'use strict';

/**
 * Prueba de las CUENTAS DE BANCO PARA TRANSFERENCIAS (2026-10-06): se pueden
 * tener varias, cada una con banco, a nombre de, número de cuenta y CLABE; la
 * CLABE se revisa con su dígito de control; el cliente solo ve las activas.
 *
 * Crea sus cuentas con el banco "TMP …" y las borra al final; compara el
 * número de cuentas antes y después.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-cuentas-bancarias.js   # contra la base de pruebas
 *
 * Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';
// CLABE válidas (el último dígito cuadra) que no son de nadie.
const CLABE_A = '032180000118359719';
const CLABE_B = '000000000000000013';

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
  const [[{ antes }]] = await db.query('SELECT COUNT(*) antes FROM cuentas_bancarias');
  const [ocupadas] = await db.query('SELECT clabe FROM cuentas_bancarias WHERE clabe IN (?, ?)', [CLABE_A, CLABE_B]);
  if (ocupadas.length) {
    console.error('  ✗ Las CLABE de prueba ya están capturadas en esta base; revisa antes de correr esto.');
    process.exit(1);
  }

  const [[admin]] = await db.query(
    `SELECT u.id, r.id AS rol_id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = 'administrador' AND u.activo = 1 ORDER BY u.id LIMIT 1`
  );
  const t = jwt.sign({ sub: admin.id, tipo: 'usuario', rol_id: admin.rol_id, rol: admin.rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const api = async (me, r, b, conToken = true) => {
    const x = await fetch(B + r, {
      method: me,
      headers: { ...(conToken ? { Authorization: 'Bearer ' + t } : {}), 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };

  try {
    console.log('=== 1. Varias cuentas, con número de cuenta y CLABE ===');
    let r = await api('POST', '/configuracion/cuentas', {
      banco: 'TMP Banco Uno', titular: 'Tienda de hilos', numero_cuenta: '0123 4567 89', clabe: '032 180 00011835971 9',
    });
    const uno = r.data;
    ck('se agrega la primera', r.status === 201 && uno?.id, r.error);
    ck('los números se guardan sin espacios', uno?.numero_cuenta === '0123456789' && uno?.clabe === CLABE_A, uno);
    r = await api('POST', '/configuracion/cuentas', { banco: 'TMP Banco Dos', numero_cuenta: '9876543210' });
    const dos = r.data;
    ck('una segunda, solo con número de cuenta', r.status === 201 && dos?.clabe === null, r.error ?? dos);
    r = await api('GET', '/configuracion/cuentas');
    const mias = (r.data ?? []).filter((c) => c.banco.startsWith('TMP Banco'));
    ck('el panel las lista las dos', mias.length === 2, mias.length);

    console.log('=== 2. Lo que se rechaza ===');
    r = await api('POST', '/configuracion/cuentas', { banco: 'TMP Banco Tres' });
    ck('sin número de cuenta ni CLABE', r.status === 422 && r.error?.code === 'FALTA_CUENTA', r.error);
    r = await api('POST', '/configuracion/cuentas', { banco: 'TMP Banco Tres', clabe: '032180000118359718' });
    ck('una CLABE con el último dígito mal', r.status === 422 && r.error?.code === 'CLABE_INVALIDA', r.error?.message);
    r = await api('POST', '/configuracion/cuentas', { banco: 'TMP Banco Tres', clabe: '12345' });
    ck('una CLABE incompleta', r.status === 422 && r.error?.code === 'CLABE_INVALIDA', r.error?.message);
    r = await api('POST', '/configuracion/cuentas', { banco: 'TMP Banco Tres', numero_cuenta: '12AB34' });
    ck('un número de cuenta con letras', r.status === 422 && r.error?.code === 'NUMERO_CUENTA_INVALIDO', r.error);
    r = await api('POST', '/configuracion/cuentas', { banco: 'TMP Banco Tres', clabe: CLABE_A });
    ck('la misma CLABE dos veces', r.status === 409 && r.error?.code === 'CLABE_REPETIDA', r.error);

    console.log('=== 3. El cliente solo ve las activas ===');
    r = await api('GET', '/configuracion', undefined, false);
    let publicas = (r.data?.cuentas_bancarias ?? []).filter((c) => c.banco.startsWith('TMP Banco'));
    ck('sin sesión se ven las dos', publicas.length === 2, publicas.length);
    ck('sin fechas ni el estado', publicas[0] && !('activa' in publicas[0]) && !('creado_en' in publicas[0]));
    r = await api('PUT', `/configuracion/cuentas/${dos.id}`, { banco: 'TMP Banco Dos', numero_cuenta: '9876543210', clabe: CLABE_B, activa: false });
    ck('se edita: le agrega CLABE y la esconde', r.status === 200 && r.data?.clabe === CLABE_B && !r.data?.activa, r.error ?? r.data);
    r = await api('GET', '/configuracion', undefined, false);
    publicas = (r.data?.cuentas_bancarias ?? []).filter((c) => c.banco.startsWith('TMP Banco'));
    ck('la escondida ya no le sale al cliente', publicas.length === 1 && publicas[0].id === uno.id, publicas.map((c) => c.id));
    r = await api('GET', '/configuracion/cuentas');
    ck('pero el panel la sigue viendo', (r.data ?? []).some((c) => c.id === dos.id));

    console.log('=== 4. Quitar ===');
    r = await api('DELETE', `/configuracion/cuentas/${dos.id}`);
    ck('se quita', r.status === 200 && !(r.data ?? []).some((c) => c.id === dos.id), r.error);
    r = await api('DELETE', `/configuracion/cuentas/${dos.id}`);
    ck('quitarla otra vez da 404', r.status === 404, r.status);
    r = await api('POST', '/configuracion/cuentas', { banco: 'TMP Banco Cuatro', clabe: CLABE_A }, false);
    ck('sin sesión no se puede agregar', r.status === 401, r.status);
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    await db.query("DELETE FROM cuentas_bancarias WHERE banco LIKE 'TMP Banco%'");
    const [[{ despues }]] = await db.query('SELECT COUNT(*) despues FROM cuentas_bancarias');
    ck('las cuentas quedaron como estaban', Number(antes) === Number(despues), { antes, despues });
    await db.end();
  }
  console.log(f ? `\n${f} FALLAS` : '\nTodo bien.');
  process.exit(f ? 1 : 0);
})();
