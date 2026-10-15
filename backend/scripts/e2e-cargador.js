'use strict';

/**
 * Prueba del puesto CARGADOR (2026-10-14): trabaja en la tienda pero NO entra al
 * sistema (`roles.entra_al_sistema = 0`).
 *
 *   · se da de alta sin correo ni contraseña, y no se combina con otros puestos;
 *   · a quien sí entra se le siguen exigiendo correo y contraseña;
 *   · no sale en Permisos y su columna no se puede guardar;
 *   · sí sale en Nómina;
 *   · un cargador que pasa a cajero entra con su correo y contraseña nuevos;
 *   · al volver a cargador pierde el correo, la contraseña y, EN EL ACTO, lo que
 *     podía hacer (aunque su token siga vivo).
 *
 * Crea empleados "TMP Cargador …" y los borra al final; compara los conteos.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-cargador.js   # contra la base de pruebas
 *
 * Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';
const MARCA = Date.now();
const CORREO = `tmp.cargador.${MARCA}@prueba.local`;

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
  const conteos = async () => {
    const [[r]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM usuarios) usuarios, (SELECT COUNT(*) FROM usuario_roles) usuario_roles,
              (SELECT COUNT(*) FROM nomina_empleados) nomina, (SELECT COUNT(*) FROM rol_permisos) rol_permisos`
    );
    return r;
  };
  const antes = await conteos();
  const [roles] = await db.query('SELECT id, nombre FROM roles');
  const rol = (n) => roles.find((r) => r.nombre === n)?.id;
  const [CAJERO, ALMACEN, CARGADOR] = [rol('cajero'), rol('almacenista'), rol('cargador')];
  if (!CAJERO || !ALMACEN) throw new Error('Faltan los puestos cajero o almacenista');
  if (!CARGADOR) throw new Error('Falta el puesto cargador: aplica la migración 2026-10_puesto_cargador.sql');

  const [[admin]] = await db.query(
    `SELECT u.id, u.rol_id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = 'administrador' AND u.activo = 1 ORDER BY u.id LIMIT 1`
  );
  const firmar = (u) => jwt.sign({ sub: u.id, tipo: 'usuario', rol_id: u.rol_id, rol: u.rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const pedir = async (token, me, r, b) => {
    const x = await fetch(B + r, {
      method: me,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };
  const comoAdmin = (me, r, b) => pedir(firmar(admin), me, r, b);
  const codigo = (r) => r.error?.code;

  try {
    console.log('=== 1. El puesto existe y no entra al sistema ===');
    let r = await comoAdmin('GET', '/usuarios/roles');
    const enLista = r.data?.find((x) => x.id === CARGADOR);
    ck('la lista de puestos trae al cargador sin acceso', enLista?.entra_al_sistema === false, enLista);
    ck('los demás sí entran', r.data?.find((x) => x.id === CAJERO)?.entra_al_sistema === true);

    console.log('\n=== 2. Alta del cargador ===');
    r = await comoAdmin('POST', '/usuarios', { rol_id: CARGADOR, nombre: 'TMP Cargador Uno', telefono: '7781234567' });
    ck('se da de alta sin correo ni contraseña', r.status === 201, r.error);
    const uno = r.data;
    ck('vuelve sin correo y marcado sin acceso', uno?.correo === null && Number(uno?.entra_al_sistema) === 0, uno);
    const [[fila]] = await db.query('SELECT correo, contrasena_hash FROM usuarios WHERE id = ?', [uno.id]);
    ck('en la base, correo y contraseña en NULL', fila.correo === null && fila.contrasena_hash === null);

    r = await comoAdmin('POST', '/usuarios', {
      rol_id: CARGADOR, nombre: 'TMP Cargador No', correo: `no.${CORREO}`, contrasena: 'tmp-12345678',
    });
    ck('con correo y contraseña: 422 PUESTO_SIN_ACCESO', r.status === 422 && codigo(r) === 'PUESTO_SIN_ACCESO', r.error);
    r = await comoAdmin('POST', '/usuarios', { rol_id: CARGADOR, otros_roles: [CAJERO], nombre: 'TMP Cargador No' });
    ck('con otros puestos: 422 PUESTO_SIN_ACCESO', r.status === 422 && codigo(r) === 'PUESTO_SIN_ACCESO', r.error);
    r = await comoAdmin('POST', '/usuarios', {
      rol_id: CAJERO, otros_roles: [CARGADOR], nombre: 'TMP Cargador No', correo: `no.${CORREO}`, contrasena: 'tmp-12345678',
    });
    ck('como "también trabaja como": 422 PUESTO_SIN_ACCESO', r.status === 422 && codigo(r) === 'PUESTO_SIN_ACCESO', r.error);

    console.log('\n=== 3. A quien sí entra se le siguen pidiendo correo y contraseña ===');
    r = await comoAdmin('POST', '/usuarios', { rol_id: CAJERO, nombre: 'TMP Cargador No', contrasena: 'tmp-12345678' });
    ck('cajero sin correo: 422 FALTA_CORREO', r.status === 422 && codigo(r) === 'FALTA_CORREO', r.error);
    r = await comoAdmin('POST', '/usuarios', { rol_id: CAJERO, nombre: 'TMP Cargador No', correo: `no.${CORREO}` });
    ck('cajero sin contraseña: 422 FALTA_CONTRASENA', r.status === 422 && codigo(r) === 'FALTA_CONTRASENA', r.error);
    const [[nadie]] = await db.query("SELECT COUNT(*) n FROM usuarios WHERE nombre = 'TMP Cargador No'");
    ck('ninguno de los rechazados quedó guardado', Number(nadie.n) === 0, nadie.n);

    console.log('\n=== 4. Permisos y Nómina ===');
    r = await comoAdmin('GET', '/permisos');
    ck('Permisos no enseña al cargador', r.status === 200 && !r.data?.roles?.some((x) => x.id === CARGADOR));
    r = await comoAdmin('PUT', `/permisos/roles/${CARGADOR}`, { claves: ['ver:pos'] });
    ck('su columna no se guarda: 422 PUESTO_SIN_ACCESO', r.status === 422 && codigo(r) === 'PUESTO_SIN_ACCESO', r.error);
    r = await comoAdmin('GET', '/nomina/empleados');
    const enNomina = r.data?.find((x) => Number(x.usuario_id) === uno.id);
    ck('sale en Nómina, con su puesto', enNomina?.rol === 'cargador', enNomina);
    r = await comoAdmin('PUT', `/nomina/empleados/${uno.id}`, { sueldo_base_semanal: 1500, activo: true });
    ck('se le pone sueldo en Nómina', r.status === 200, r.error);

    console.log('\n=== 5. Aunque tuviera un token, no puede nada ===');
    const comoUno = (me, ruta, b) => pedir(firmar({ id: uno.id, rol_id: CARGADOR, rol: 'cargador' }), me, ruta, b);
    r = await comoUno('GET', '/usuarios/perfil');
    ck('su perfil no trae ningún permiso', r.status === 200 && (r.data?.permisos ?? []).length === 0, r.data?.permisos);
    r = await comoUno('GET', '/usuarios');
    ck('no pasa la guarda de Personal', r.status === 403, r.status);

    console.log('\n=== 6. Edición ===');
    r = await comoAdmin('PUT', `/usuarios/${uno.id}`, { nombre: 'TMP Cargador Uno B', contrasena: 'tmp-12345678' });
    ck('al cargador no se le pone contraseña: 422', r.status === 422 && codigo(r) === 'PUESTO_SIN_ACCESO', r.error);
    r = await comoAdmin('PUT', `/usuarios/${uno.id}`, { nombre: 'TMP Cargador Uno B', telefono: null });
    ck('se le cambia el nombre', r.status === 200 && r.data?.nombre === 'TMP Cargador Uno B' && r.data?.correo === null, r.error);
    r = await comoAdmin('PUT', `/usuarios/${uno.id}`, { rol_id: CAJERO, otros_roles: [] });
    ck('pasa a cajero sin correo: 422 FALTA_CORREO', r.status === 422 && codigo(r) === 'FALTA_CORREO', r.error);
    r = await comoAdmin('PUT', `/usuarios/${uno.id}`, { rol_id: CAJERO, otros_roles: [ALMACEN], correo: CORREO });
    ck('pasa a cajero sin contraseña: 422 FALTA_CONTRASENA', r.status === 422 && codigo(r) === 'FALTA_CONTRASENA', r.error);
    r = await comoAdmin('PUT', `/usuarios/${uno.id}`, {
      rol_id: CAJERO, otros_roles: [ALMACEN], correo: CORREO, contrasena: 'tmp-12345678',
    });
    ck('pasa a cajero con correo y contraseña', r.status === 200 && r.data?.correo === CORREO && r.data?.otros_roles?.[0]?.id === ALMACEN, r.error ?? r.data);
    r = await pedir(null, 'POST', '/usuarios/login', { correo: CORREO, contrasena: 'tmp-12345678' });
    ck('ya entra al sistema', r.status === 200 && !!r.data?.token, r.error);
    const tokenCajero = r.data?.token;
    ck('y puede lo de cajero', (r.data?.usuario?.permisos ?? []).length > 0);

    r = await comoAdmin('PUT', `/usuarios/${uno.id}`, { rol_id: CAJERO, correo: `otro.${CORREO}` });
    ck('el correo de quien ya entra no se cambia: 422', r.status === 422 && codigo(r) === 'CORREO_NO_SE_CAMBIA', r.error);

    console.log('\n=== 7. De vuelta a cargador ===');
    r = await comoAdmin('PUT', `/usuarios/${uno.id}`, { rol_id: CARGADOR });
    ck('vuelve a cargador', r.status === 200 && r.data?.correo === null && (r.data?.otros_roles ?? []).length === 0, r.error ?? r.data);
    const [[sin]] = await db.query('SELECT correo, contrasena_hash FROM usuarios WHERE id = ?', [uno.id]);
    ck('se le quitaron correo y contraseña', sin.correo === null && sin.contrasena_hash === null);
    r = await pedir(null, 'POST', '/usuarios/login', { correo: CORREO, contrasena: 'tmp-12345678' });
    ck('ya no entra: 401', r.status === 401, r.status);
    r = await pedir(tokenCajero, 'GET', '/usuarios/perfil');
    ck('su token de cajero ya no trae permisos', r.status === 200 && (r.data?.permisos ?? []).length === 0, r.data?.permisos);
  } finally {
    await db.query("DELETE FROM usuarios WHERE nombre LIKE 'TMP Cargador%' OR correo LIKE 'tmp.cargador.%@prueba.local' OR correo LIKE '%.tmp.cargador.%@prueba.local'");
    const despues = await conteos();
    ck('la base quedó como estaba', JSON.stringify(antes) === JSON.stringify(despues), { antes, despues });
    await db.end();
  }
  console.log(f ? `\n${f} FALLA(S)` : '\nTodo bien.');
  process.exit(f ? 1 : 0);
})().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
