'use strict';

/**
 * Prueba del NOMBRE de la solicitud de cancelación (2026-10-26, usuario: "cuando se
 * haga la solicitud de cancelación de notas en espera o notas pendientes de pago,
 * no diga venta"). Una cajera que solo PIDE cancelar pide cancelar:
 *
 *   · una nota en espera      → «Cancelar una nota en espera»;
 *   · una nota pendiente de pago → «Cancelar una nota pendiente de pago»;
 *   · una venta de contado    → «Cancelar una venta».
 *
 * Lo mismo en la ventana que pide autorización (428) y en la lista de
 * Autorizaciones (lo que pidió y lo que hay por autorizar). Si la nota en espera
 * se entrega mientras tanto, la solicitud ya dice «venta».
 *
 * Crea "TMPNC …" (hilo, caja, turno, cliente y una cajera) y lo borra al final.
 *
 *   cd backend
 *   DB_NAME=desarrollo PORT=3210 node src/server.js &
 *   DB_NAME=desarrollo E2E_ACEPTO_PRODUCCION=si node scripts/e2e-nombre-cancelacion.js
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
  const [[cajero]] = await db.query("SELECT id FROM roles WHERE nombre = 'cajero' LIMIT 1");
  const firmar = (u) => jwt.sign({ sub: u.id, tipo: 'usuario', rol_id: u.rol_id, rol: u.rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const pedir = async (token, me, r, b, extra = {}) => {
    const x = await fetch(B + r, {
      method: me,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...extra },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };
  const tAdmin = firmar({ ...admin, rol: 'administrador' });
  const api = (me, r, b) => pedir(tAdmin, me, r, b);

  try {
    const [[tienda]] = await db.query('SELECT id FROM almacenes WHERE activo = 1 AND es_punto_venta = 1 ORDER BY id LIMIT 1');
    const [[cat]] = await db.query('SELECT id FROM categorias ORDER BY id LIMIT 1');
    const [[kg]] = await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");
    const [[efectivo]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Efectivo%' ORDER BY id LIMIT 1");

    let r = await api('POST', '/productos', {
      categoria_id: cat.id, unidad_medida_id: kg.id, nombre: 'TMPNC ROJO ' + SUF, precio_kg: 100, multipresentacion: true,
    });
    const paquete = (await api('GET', `/productos/${r.data.id}`)).data.variantes[0];
    await api('POST', '/inventario/movimientos', { variante_id: paquete.id, almacen_id: tienda.id, tipo: 'entrada', cantidad: 40, motivo: 'TMPNC' });
    const cj = (await api('POST', '/caja/cajas', { almacen_id: tienda.id, nombre: 'TMPNC Caja ' + SUF })).data;
    const sesion = (await api('POST', '/caja/sesiones', { caja_id: cj.id, monto_inicial: 0 })).data;
    const cli = (await api('POST', '/clientes', { nombre: 'TMPNC Cliente ' + SUF, telefono: '4450000020' })).data;
    r = await api('POST', '/usuarios', {
      nombre: `TMPNC Cajera ${SUF}`, correo: `tmpnc.cajera.${SUF.toLowerCase()}@prueba.local`,
      contrasena: 'clave-de-prueba-1', rol_id: cajero.id, todas_las_tiendas: false, tiendas: [tienda.id],
    });
    const cajera = { id: Number(r.data?.id), rol_id: cajero.id, rol: 'cajero' };
    const tCajera = firmar(cajera);
    ck('hilo, caja, turno, cliente y una cajera que solo PIDE cancelar', !!sesion?.id && !!cli?.id && cajera.id > 0, r.error);

    const base = { canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: cli.id, items: [{ variante_id: paquete.id, cantidad: 2 }] };
    const enEspera = (await api('POST', '/pedidos', { ...base, encargo: true, metodo_entrega: 'recoger' })).data;
    const pendiente = (await api('POST', '/pedidos', { ...base, pendiente_pago: true })).data;
    const venta = (await api('POST', '/pedidos', { ...base, pagos: [{ metodo_pago_id: efectivo.id, monto: 200 }] })).data;
    ck('una nota en espera, una pendiente de pago y una venta', !!enEspera?.id && !!pendiente?.id && !!venta?.id);

    console.log('\n=== 1. La ventana que pide autorización (428) ===');
    const nombre428 = async (id) => (await pedir(tCajera, 'PATCH', `/pedidos/${id}/estado`, { estado: 'cancelado' })).error;
    let e = await nombre428(enEspera.id);
    ck('nota en espera: «Cancelar una nota en espera»', e?.code === 'NECESITA_AUTORIZACION' && e?.detalles?.nombre === 'Cancelar una nota en espera', e?.detalles?.nombre);
    ck('y el mensaje lo dice', e?.message === '«Cancelar una nota en espera» necesita autorización.', e?.message);
    e = await nombre428(pendiente.id);
    ck('nota pendiente de pago: «Cancelar una nota pendiente de pago»', e?.detalles?.nombre === 'Cancelar una nota pendiente de pago', e?.detalles?.nombre);
    e = await nombre428(venta.id);
    ck('venta de contado: «Cancelar una venta»', e?.detalles?.nombre === 'Cancelar una venta', e?.detalles?.nombre);

    console.log('\n=== 2. La lista de Autorizaciones ===');
    for (const p of [enEspera, pendiente, venta]) {
      r = await pedir(tCajera, 'PATCH', `/pedidos/${p.id}/estado`, { estado: 'cancelado' }, { 'X-Pedir-Autorizacion': 'si' });
      if (r.status !== 202) ck(`se pide la cancelación de ${p.numero_pedido}`, false, r.error);
    }
    const nombreEn = (lista, p) => lista.find((a) => a.resumen?.includes(p.numero_pedido))?.operacion_nombre;
    let mias = (await pedir(tCajera, 'GET', '/autorizaciones?vista=mias')).data?.filas ?? [];
    ck('en "Mis solicitudes": la nota en espera', nombreEn(mias, enEspera) === 'Cancelar una nota en espera', nombreEn(mias, enEspera));
    ck('la nota pendiente de pago', nombreEn(mias, pendiente) === 'Cancelar una nota pendiente de pago', nombreEn(mias, pendiente));
    ck('y la venta', nombreEn(mias, venta) === 'Cancelar una venta', nombreEn(mias, venta));
    const porAutorizar = (await api('GET', '/autorizaciones?vista=por_autorizar')).data?.filas ?? [];
    ck('quien autoriza ve lo mismo', nombreEn(porAutorizar, enEspera) === 'Cancelar una nota en espera'
      && nombreEn(porAutorizar, pendiente) === 'Cancelar una nota pendiente de pago', [nombreEn(porAutorizar, enEspera), nombreEn(porAutorizar, pendiente)]);
    ck('la lista no manda la ruta guardada', porAutorizar.every((a) => a.ruta === undefined));

    console.log('\n=== 3. Si se entrega mientras tanto, ya es una venta ===');
    r = await api('POST', `/pedidos/${enEspera.id}/entregar`, { pagos: [{ metodo_pago_id: efectivo.id, monto: 200 }], sesion_caja_id: sesion.id });
    mias = (await pedir(tCajera, 'GET', '/autorizaciones?vista=mias')).data?.filas ?? [];
    ck('la nota entregada ya dice «Cancelar una venta»', r.status === 200 && nombreEn(mias, enEspera) === 'Cancelar una venta', [r.status, nombreEn(mias, enEspera)]);

    console.log('\n=== 4. Ya aceptada (cancelada), en el historial sigue diciendo lo que era ===');
    const sol = mias.find((a) => a.resumen?.includes(pendiente.numero_pedido));
    r = await api('POST', `/autorizaciones/${sol?.id}/aprobar`, {});
    const [[cancelada]] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pendiente.id]);
    ck('se aceptó y la nota quedó cancelada', r.status === 200 && cancelada.estado === 'cancelado', [r.status, cancelada.estado, r.error?.message]);
    const historial = (await pedir(tCajera, 'GET', '/autorizaciones?vista=historial')).data?.filas ?? [];
    ck('el historial dice «Cancelar una nota pendiente de pago»', nombreEn(historial, pendiente) === 'Cancelar una nota pendiente de pago', nombreEn(historial, pendiente));
  } catch (err) {
    console.error(err);
    f++;
  } finally {
    console.log('\nLimpiando…');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    const [us] = await db.query("SELECT id FROM usuarios WHERE nombre LIKE 'TMPNC %'");
    const uids = us.map((x) => x.id);
    if (uids.length) await db.query('DELETE FROM autorizaciones WHERE solicitante_id IN (?)', [uids]);
    const [prods] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPNC %'");
    const pr = prods.map((x) => x.id);
    const [vs] = pr.length ? await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [pr]) : [[]];
    const vids = vs.map((v) => v.id);
    const [peds] = vids.length ? await db.query('SELECT DISTINCT pedido_id FROM pedido_detalle WHERE variante_id IN (?)', [vids]) : [[]];
    const pids = peds.map((x) => x.pedido_id);
    if (pids.length) {
      for (const tb of ['pagos', 'pedido_detalle', 'credito_movimientos']) await db.query(`DELETE FROM ${tb} WHERE pedido_id IN (?)`, [pids]);
      await db.query('DELETE FROM pedidos WHERE id IN (?)', [pids]);
    }
    const [cls] = await db.query("SELECT id FROM clientes WHERE nombre LIKE 'TMPNC %'");
    if (cls.length) await db.query('DELETE FROM clientes WHERE id IN (?)', [cls.map((x) => x.id)]);
    if (vids.length) {
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) {
        await db.query(`DELETE FROM ${tb} WHERE variante_id IN (?)`, [vids]);
      }
      await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
    }
    if (pr.length) await db.query('DELETE FROM productos WHERE id IN (?)', [pr]);
    const [cjs] = await db.query("SELECT id FROM cajas WHERE nombre LIKE 'TMPNC Caja%'");
    if (cjs.length) {
      const [ses] = await db.query('SELECT id FROM sesiones_caja WHERE caja_id IN (?)', [cjs.map((x) => x.id)]);
      await borrarTurnosPropios(db, ses.map((x) => x.id));
      await borrarCajasSinTurnos(db, cjs.map((x) => x.id));
    }
    if (uids.length) {
      for (const tb of ['usuario_almacenes', 'usuario_roles']) await db.query(`DELETE FROM ${tb} WHERE usuario_id IN (?)`, [uids]);
      await db.query('DELETE FROM usuarios WHERE id IN (?)', [uids]);
    }
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    const [[{ n }]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPNC %') + (SELECT COUNT(*) FROM usuarios WHERE nombre LIKE 'TMPNC %')
            + (SELECT COUNT(*) FROM clientes WHERE nombre LIKE 'TMPNC %') + (SELECT COUNT(*) FROM cajas WHERE nombre LIKE 'TMPNC Caja%') AS n`
    );
    ck('no quedó basura (TMPNC)', Number(n) === 0, n);
    await db.end();
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
