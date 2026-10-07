'use strict';

/**
 * Prueba de VARIOS PUESTOS POR PERSONA (2026-10-06): en Personal, a alguien se
 * le da su puesto principal y los que tiene además; puede lo de TODOS juntos.
 *
 *   · al dar de alta, el principal no se guarda dos veces;
 *   · su perfil trae la SUMA de los permisos de sus puestos, y las guardas del
 *     servidor la respetan;
 *   · quitarle un puesto vale EN EL ACTO, con el mismo token;
 *   · el puesto de administrador, tampoco como extra, lo da alguien que no sea
 *     administrador; y a quien lo tiene de extra solo lo toca un administrador;
 *   · quien es administrador de extra entra a Permisos;
 *   · "Sin acceso" ya no pasa ninguna guarda aunque su token siga vivo;
 *   · Permisos cuenta a la persona en cada uno de sus puestos.
 *
 * Crea dos empleados "TMP …" y un puesto "tmp personal e2e" y los borra al
 * final; compara los conteos antes y después.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-varios-puestos.js   # contra la base de pruebas
 *
 * Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';
const NO_EXISTE = 999999999;
const MARCA = Date.now();
const PUESTO_TMP = 'tmp personal e2e';

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
      `SELECT (SELECT COUNT(*) FROM usuarios) usuarios, (SELECT COUNT(*) FROM roles) roles,
              (SELECT COUNT(*) FROM usuario_roles) usuario_roles, (SELECT COUNT(*) FROM rol_permisos) rol_permisos`
    );
    return r;
  };
  const antes = await conteos();
  const [roles] = await db.query('SELECT id, nombre FROM roles');
  const rol = (n) => roles.find((r) => r.nombre === n)?.id;
  const [ADMIN, CAJERO, ALMACEN] = [rol('administrador'), rol('cajero'), rol('almacenista')];
  if (!ADMIN || !CAJERO || !ALMACEN) throw new Error('Faltan los puestos administrador, cajero o almacenista');

  const [[admin]] = await db.query(
    `SELECT u.id, u.rol_id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = 'administrador' AND u.activo = 1 ORDER BY u.id LIMIT 1`
  );
  const firmar = (u) => jwt.sign({ sub: u.id, tipo: 'usuario', rol_id: u.rol_id, rol: u.rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const como = (token) => async (me, r, b) => {
    const x = await fetch(B + r, {
      method: me,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };
  const comoAdmin = como(firmar(admin));
  const negado = (r) => r.status === 403 && r.error?.code === 'SIN_PERMISO';
  const paso = (r) => r.status !== 403 && r.status !== 401;

  // Lo que deberían sumar cajero + almacenista, según la base.
  const [filas] = await db.query(
    `SELECT DISTINCT p.clave FROM rol_permisos rp JOIN permisos p ON p.id = rp.permiso_id WHERE rp.rol_id IN (?, ?)`,
    [CAJERO, ALMACEN]
  );
  const suma = new Set(filas.map((x) => x.clave));
  const [solo] = await db.query(
    `SELECT p.clave FROM rol_permisos rp JOIN permisos p ON p.id = rp.permiso_id WHERE rp.rol_id = ?`, [CAJERO]
  );
  const delCajero = new Set(solo.map((x) => x.clave));

  let puestoTmp = null;
  try {
    let r = await comoAdmin('GET', '/permisos');
    const personasAlmacen = r.data?.roles?.find((x) => x.id === ALMACEN)?.personas;

    console.log('=== 1. Alta con dos puestos ===');
    r = await comoAdmin('POST', '/usuarios', {
      rol_id: CAJERO, otros_roles: [ALMACEN, CAJERO, ALMACEN], nombre: 'TMP Varios Puestos',
      correo: `tmp.puestos.${MARCA}@prueba.local`, contrasena: 'tmp-12345678',
    });
    ck('se da de alta', r.status === 201, r.error);
    const uno = r.data;
    ck('principal cajero y además almacenista, sin repetir', uno?.rol === 'cajero' &&
      JSON.stringify(uno?.otros_roles?.map((x) => x.id)) === JSON.stringify([ALMACEN]), uno?.otros_roles);
    const [[enBase]] = await db.query('SELECT COUNT(*) n FROM usuario_roles WHERE usuario_id = ?', [uno.id]);
    ck('en la base, un solo renglón extra', Number(enBase.n) === 1, enBase.n);
    r = await comoAdmin('GET', '/usuarios');
    ck('el listado trae sus otros puestos', r.data?.find((x) => x.id === uno.id)?.otros_roles?.[0]?.nombre === 'almacenista');
    r = await comoAdmin('GET', '/permisos');
    ck('Permisos lo cuenta también en almacenista', r.data?.roles?.find((x) => x.id === ALMACEN)?.personas === personasAlmacen + 1,
      [personasAlmacen, r.data?.roles?.find((x) => x.id === ALMACEN)?.personas]);

    console.log('\n=== 2. Puede lo de los dos puestos ===');
    const comoUno = como(firmar({ id: uno.id, rol_id: CAJERO, rol: 'cajero' }));
    r = await comoUno('GET', '/usuarios/perfil');
    const tiene = new Set(r.data?.permisos ?? []);
    ck('su perfil trae la suma de cajero y almacenista', tiene.size === suma.size && [...suma].every((c) => tiene.has(c)),
      { tiene: tiene.size, suma: suma.size });
    ck('el perfil dice sus otros puestos', r.data?.otros_roles?.[0]?.nombre === 'almacenista');
    ck('pasa la guarda de almacenista (ajuste/merma)', paso(await comoUno('POST', '/inventario/movimientos', {})));
    ck('y la de cajero (meter efectivo)', paso(await comoUno('POST', `/caja/sesiones/${NO_EXISTE}/movimientos`, { tipo: 'ingreso', monto: 1 })));

    console.log('\n=== 3. Quitarle un puesto vale en el acto ===');
    r = await comoAdmin('PUT', `/usuarios/${uno.id}`, { otros_roles: [] });
    ck('se le quita almacenista', r.status === 200 && r.data?.otros_roles?.length === 0, r.error);
    ck('con el MISMO token ya no pasa la guarda de almacenista',
      delCajero.has('hacer:ajuste_merma') || negado(await comoUno('POST', '/inventario/movimientos', {})));
    r = await comoUno('GET', '/usuarios/perfil');
    ck('su perfil ya solo trae lo de cajero', (r.data?.permisos ?? []).length === delCajero.size, (r.data?.permisos ?? []).length);

    console.log('\n=== 4. El puesto de administrador lo da solo un administrador ===');
    r = await comoAdmin('POST', '/permisos/roles', { nombre: PUESTO_TMP, descripcion: 'Prueba e2e-varios-puestos' });
    puestoTmp = r.data?.roles?.find((x) => x.nombre === PUESTO_TMP)?.id;
    ck('puesto de prueba con permiso de Personal', !!puestoTmp, r.error);
    r = await comoAdmin('PUT', `/permisos/roles/${puestoTmp}`, { claves: ['ver:personal'] });
    ck('se le da «Personal»', r.status === 200, r.error);
    r = await comoAdmin('POST', '/usuarios', {
      rol_id: CAJERO, otros_roles: [puestoTmp], nombre: 'TMP Jefa de Personal',
      correo: `tmp.puestos.jefa.${MARCA}@prueba.local`, contrasena: 'tmp-12345678',
    });
    const jefa = r.data;
    ck('cajera que además lleva Personal', r.status === 201 && jefa?.otros_roles?.[0]?.id === puestoTmp, r.error);
    const comoJefa = como(firmar({ id: jefa.id, rol_id: CAJERO, rol: 'cajero' }));
    ck('entra a Personal por su puesto EXTRA', (await comoJefa('GET', '/usuarios')).status === 200);
    r = await comoJefa('PUT', `/usuarios/${uno.id}`, { otros_roles: [ADMIN] });
    ck('no puede dar administrador como puesto extra', r.status === 403 && r.error?.code === 'SOLO_ADMINISTRADOR', r.error);
    r = await comoJefa('POST', '/usuarios', {
      rol_id: CAJERO, otros_roles: [ADMIN], nombre: 'TMP No Debe', correo: `tmp.puestos.no.${MARCA}@prueba.local`, contrasena: 'tmp-12345678',
    });
    ck('ni al dar de alta', r.status === 403 && r.error?.code === 'SOLO_ADMINISTRADOR', r.error);
    r = await comoJefa('PUT', `/usuarios/${uno.id}`, { otros_roles: [ALMACEN] });
    ck('almacenista sí lo puede dar', r.status === 200 && r.data?.otros_roles?.[0]?.id === ALMACEN, r.error);

    console.log('\n=== 5. Administrador de extra ===');
    r = await comoAdmin('PUT', `/usuarios/${uno.id}`, { otros_roles: [ALMACEN, ADMIN] });
    ck('el administrador sí se lo da', r.status === 200 && r.data?.otros_roles?.length === 2, r.error);
    ck('entra a Permisos (que es solo del administrador)', (await comoUno('GET', '/permisos')).status === 200);
    r = await comoUno('GET', '/usuarios/perfil');
    const total = (await comoAdmin('GET', '/usuarios/perfil')).data?.permisos?.length;
    ck('y lo puede todo', (r.data?.permisos ?? []).length === total, [(r.data?.permisos ?? []).length, total]);
    r = await comoJefa('PUT', `/usuarios/${uno.id}`, { nombre: 'TMP Varios Puestos 2' });
    ck('a quien es administrador de extra no lo toca alguien que no lo es', r.status === 403 && r.error?.code === 'SOLO_ADMINISTRADOR', r.error);

    console.log('\n=== 6. Cambiarle el principal ===');
    r = await comoAdmin('PUT', `/usuarios/${uno.id}`, { rol_id: ALMACEN });
    ck('su nuevo principal sale de los demás', r.status === 200 && r.data?.rol === 'almacenista' &&
      JSON.stringify(r.data?.otros_roles?.map((x) => x.id)) === JSON.stringify([ADMIN]), r.data?.otros_roles);

    console.log('\n=== 7. Sin acceso no pasa nada ===');
    r = await comoAdmin('PUT', `/usuarios/${uno.id}`, { activo: false });
    ck('se le quita el acceso', r.status === 200 && !r.data?.activo, r.error);
    ck('su token vivo ya no entra a Permisos', (await comoUno('GET', '/permisos')).status === 403);
    ck('ni pasa la guarda de almacenista', negado(await comoUno('POST', '/inventario/movimientos', {})));
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    await db.query(`DELETE FROM usuarios WHERE correo LIKE 'tmp.puestos.%@prueba.local'`);
    await db.query('DELETE FROM roles WHERE nombre = ?', [PUESTO_TMP]);
    const despues = await conteos();
    ck('la base quedó como estaba', JSON.stringify(despues) === JSON.stringify(antes), { antes, despues });
    await db.end();
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
