'use strict';

/**
 * Prueba de los PERMISOS POR PUESTO (rediseño 2026-10): que cada puesto entre
 * solo a lo suyo y que el servidor —no solo el menú— niegue las acciones que el
 * puesto no tiene.
 *
 * NO ESCRIBE NADA. Cada intento usa ids que no existen (pedido, turno, traspaso)
 * o un cuerpo que no pasa la validación, así que:
 *   · al puesto SIN permiso le toca 403 SIN_PERMISO;
 *   · al que SÍ lo tiene, 404 o 422 — señal de que pasó la guarda y el error
 *     es del dato, no del permiso.
 * Si a alguna guarda se le olvidara su permiso, el intento tampoco haría nada:
 * apunta a un id que no existe.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   node scripts/e2e-permisos.js   # BASE=http://localhost:3210/api/v1
 *
 * Usa los permisos de la migración `2026-10_permisos_por_puesto.sql` tal como
 * vienen; si el administrador los cambió, las expectativas de cajero, gerente y
 * almacenista hay que ajustarlas. Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');
// «Ver costos» no se ofrece mientras la tienda no lleve el costo (permisos/service.js).
const TOTAL = require('../src/modules/permisos/catalogo').CATALOGO.length -
  (require('../src/modules/permisos/service').SE_LLEVA_COSTO ? 0 : 1);

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';
const NO_EXISTE = 999999999;

let f = 0;
const ck = (n, ok, d) => {
  console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + d : ''));
  if (!ok) f++;
};

(async () => {
  const db = await m.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  // Un usuario real de cada puesto: el token lleva su id y su rol_id.
  const [usuarios] = await db.query(
    `SELECT u.id, r.id AS rol_id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.activo = 1 ORDER BY u.id`
  );
  await db.end();
  const de = (rol) => usuarios.find((u) => u.rol === rol);
  const token = (u) => jwt.sign({ sub: u.id, tipo: 'usuario', rol_id: u.rol_id, rol: u.rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const como = (rol) => {
    const u = de(rol);
    if (!u) throw new Error(`No hay un usuario activo con puesto ${rol}`);
    const t = token(u);
    return async (me, r, b) => {
      const x = await fetch(B + r, {
        method: me,
        headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      return { status: x.status, ...(await x.json().catch(() => ({}))) };
    };
  };
  const admin = como('administrador');
  const gerente = como('gerente');
  const cajero = como('cajero');
  const almacen = como('almacenista');
  const negado = (r) => r.status === 403 && r.error?.code === 'SIN_PERMISO';
  const paso = (r) => r.status !== 403 && r.status !== 401;

  try {
    console.log('=== 1. La pantalla Permisos es solo del administrador ===');
    let r = await admin('GET', '/permisos');
    ck('el administrador la abre', r.status === 200, r.status);
    ck(`con el catálogo completo (${TOTAL})`, r.data?.catalogo?.length === TOTAL, r.data?.catalogo?.length);
    ck('y la migración aplicada', r.data?.falta_migracion === false, r.data?.falta_migracion);
    ck('el gerente no', (await gerente('GET', '/permisos')).status === 403);
    ck('el cajero no', (await cajero('GET', '/permisos')).status === 403);
    const rolAdmin = r.data?.roles?.find((x) => x.es_admin);
    const rolCajero = r.data?.roles?.find((x) => x.nombre === 'cajero');
    r = await admin('PUT', '/permisos/roles/' + rolAdmin?.id, { claves: [] });
    ck('al administrador no se le pueden quitar permisos', r.status === 422 && r.error?.code === 'ADMIN_FIJO', r.error?.code);
    r = await admin('PUT', '/permisos/roles/' + rolCajero?.id, { claves: ['ver:pos', 'ver:inventado'] });
    ck('una clave que no existe se rechaza', r.status === 422 && r.error?.code === 'PERMISO_DESCONOCIDO', r.error?.code);

    console.log('\n=== 2. El perfil trae los permisos del puesto ===');
    r = await cajero('GET', '/usuarios/perfil');
    const pc = new Set(r.data?.permisos ?? []);
    ck('el cajero: punto de venta, caja, clientes, fiar', ['ver:pos', 'ver:caja', 'ver:clientes', 'hacer:fiar'].every((k) => pc.has(k)), [...pc].join(' '));
    ck('pero no Hoy ni cancelar ventas', !pc.has('ver:hoy') && !pc.has('hacer:cancelar_venta'));
    r = await admin('GET', '/usuarios/perfil');
    ck(`el administrador: todo (${TOTAL})`, (r.data?.permisos ?? []).length === TOTAL, (r.data?.permisos ?? []).length);
    // El costo, solo administración y contabilidad (2026-10-06); al gerente se le quitó.
    const llevaCosto = require('../src/modules/permisos/service').SE_LLEVA_COSTO;
    ck(llevaCosto ? 'el administrador ve costos' : 'nadie ve costos mientras la tienda no los lleve',
      (r.data?.permisos ?? []).includes('hacer:ver_costos') === llevaCosto);
    if (de('gerente')) {
      r = await como('gerente')('GET', '/usuarios/perfil');
      ck('el gerente ya no ve costos', !(r.data?.permisos ?? []).includes('hacer:ver_costos'));
    }

    console.log('\n=== 3. Pantallas: lo que no se ve tampoco se consulta ===');
    ck('cajero → Hoy: no', negado(await cajero('GET', '/hoy')));
    ck('almacenista → Hoy: sí', (await almacen('GET', '/hoy')).status === 200);
    ck('cajero → Clientes · Cuánto debe: sí', (await cajero('GET', '/clientes/analisis/deuda')).status === 200);
    ck('almacenista → Clientes: no', negado(await almacen('GET', '/clientes/analisis/deuda')));
    ck('cajero → Cómo va el negocio: no', (await cajero('GET', '/analisis/tablero')).status === 403);
    ck('gerente → Cómo va el negocio: sí', (await gerente('GET', '/analisis/tablero')).status === 200);
    ck('gerente → Nómina: no', (await gerente('GET', '/nomina/periodos')).status === 403);
    ck('gerente → Personal: no', (await gerente('GET', '/usuarios')).status === 403);

    console.log('\n=== 4. Acciones: el servidor las niega aunque se manden a mano ===');
    // Corregir una deuda
    ck('cajero → corregir deuda: no', negado(await cajero('POST', `/clientes/${NO_EXISTE}/ajustes`, {})));
    ck('administrador → pasa la guarda (422 del dato)', paso(await admin('POST', `/clientes/${NO_EXISTE}/ajustes`, {})));
    // Cambiar precios
    ck('cajero → cambiar precio: no', negado(await cajero('PATCH', `/variantes/${NO_EXISTE}`, { precio: -1 })));
    ck('gerente → pasa la guarda', paso(await gerente('PATCH', `/variantes/${NO_EXISTE}`, { precio: -1 })));
    // Cancelar una venta
    ck('cajero → cancelar venta: no', negado(await cajero('PATCH', `/pedidos/${NO_EXISTE}/estado`, { estado: 'cancelado' })));
    ck('gerente → pasa la guarda (404)', paso(await gerente('PATCH', `/pedidos/${NO_EXISTE}/estado`, { estado: 'cancelado' })));
    // Fiar (el almacenista no tiene; el turno no existe, así que nadie vende de verdad)
    const venta = { canal: 'punto_venta', sesion_caja_id: NO_EXISTE, cliente_id: NO_EXISTE, a_credito: 1, items: [{ variante_id: NO_EXISTE, cantidad: 1 }] };
    ck('almacenista → fiar: no', negado(await almacen('POST', '/pedidos', venta)));
    // Sacar o meter efectivo
    ck('almacenista → mover efectivo: no', negado(await almacen('POST', `/caja/sesiones/${NO_EXISTE}/movimientos`, { tipo: 'ingreso', monto: 1 })));
    ck('cajero → pasa la guarda (404)', paso(await cajero('POST', `/caja/sesiones/${NO_EXISTE}/movimientos`, { tipo: 'ingreso', monto: 1 })));
    // Cajas: dar de alta es configuración
    ck('cajero → dar de alta una caja: no', negado(await cajero('POST', '/caja/cajas', {})));
    // Mercancía
    ck('cajero → ajuste/merma: no', negado(await cajero('POST', '/inventario/movimientos', {})));
    ck('almacenista → pasa la guarda (422)', paso(await almacen('POST', '/inventario/movimientos', {})));
    ck('cajero → bajar conos: no', negado(await cajero('POST', '/inventario/desarmes', {})));
    ck('almacenista → pasa la guarda (422)', paso(await almacen('POST', '/inventario/desarmes', {})));
    ck('cajero → enviar traspaso: no', negado(await cajero('POST', `/inventario/traspasos/${NO_EXISTE}/enviar`, {})));
    ck('almacenista → pasa la guarda (404)', paso(await almacen('POST', `/inventario/traspasos/${NO_EXISTE}/enviar`, {})));
    ck('cajero → recibir traspaso: no (no lo trae de fábrica)', negado(await cajero('POST', `/inventario/traspasos/${NO_EXISTE}/recibir`, {})));
    ck('almacenista → pasa la guarda', paso(await almacen('POST', `/inventario/traspasos/${NO_EXISTE}/recibir`, {})));
  } catch (e) {
    console.error(e);
    f++;
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
