'use strict';

/**
 * Prueba de CADA QUIEN, SUS TIENDAS (2026-10-15: "si abro una caja en Moroleón
 * no quiero que vea nada de la otra tienda ni del inventario; solo lo que hay en
 * su tienda y en su almacén. Lo de las dos tiendas solo lo ve el administrador").
 *
 * Da de alta una gerente "TMP Tiendas …" que SOLO es de una tienda y revisa,
 * con su sesión, que:
 *   · Personal guarda de qué tienda es, y no deja guardarla sin ninguna;
 *   · ve solo su tienda (y la matriz, para pedirle mercancía) en los almacenes,
 *     sus cajas, sus ventas, su inventario, su kardex y sus traspasos;
 *   · una venta, un almacén o un turno de otra tienda le dan 404;
 *   · Reportes, Cómo va el negocio, las miradas de Clientes y Nómina le dan 403;
 *   · el expediente de un cliente compartido le enseña solo las compras de su
 *     tienda, y lo que debe completo;
 *   · le pide a la matriz A CIEGAS: sin rechazo por existencias ni cuánto hay;
 *     el envío no lo puede hacer ella (es de la matriz);
 *   · al darle «Todas las tiendas», ve todo en el acto.
 *
 * Solo LEE, salvo la persona TMP (y sus tiendas) y una solicitud de traspaso que
 * se cancela y se borra. Compara los conteos al final.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-tiendas.js   # contra la base de pruebas
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
      `SELECT (SELECT COUNT(*) FROM usuarios) usuarios, (SELECT COUNT(*) FROM usuario_almacenes) usuario_almacenes,
              (SELECT COUNT(*) FROM traspasos) traspasos, (SELECT COUNT(*) FROM traspaso_detalle) traspaso_detalle,
              (SELECT COALESCE(SUM(cantidad_reservada), 0) FROM inventario) reservado,
              (SELECT COALESCE(SUM(cantidad), 0) FROM inventario) existencia,
              (SELECT COUNT(*) FROM movimientos_inventario) kardex`
    );
    return r;
  };
  const antes = await conteos();

  // La tienda de la prueba: una con mostrador, ventas y caja activa, que NO es
  // la matriz. La "otra": cualquier almacén con ventas que no sea ella.
  const [tiendas] = await db.query(
    `SELECT a.id, a.nombre, a.es_matriz,
            (SELECT COUNT(*) FROM pedidos p WHERE p.almacen_id = a.id) AS ventas,
            (SELECT COUNT(*) FROM cajas c WHERE c.almacen_id = a.id AND c.activo = 1) AS cajas
       FROM almacenes a WHERE a.activo = 1 ORDER BY a.id`
  );
  const mia = tiendas.find((a) => !Number(a.es_matriz) && Number(a.ventas) > 0 && Number(a.cajas) > 0);
  const matriz = tiendas.find((a) => Number(a.es_matriz));
  const otra = tiendas.find((a) => a.id !== mia?.id && Number(a.ventas) > 0);
  if (!mia || !matriz || !otra) throw new Error('Hacen falta una tienda con ventas y caja, la matriz y otra tienda con ventas');
  console.log(`Tienda de la prueba: ${mia.nombre} (${mia.id}) · otra: ${otra.nombre} (${otra.id}) · matriz: ${matriz.nombre} (${matriz.id})`);

  const [roles] = await db.query('SELECT id, nombre FROM roles');
  const GERENTE = roles.find((r) => r.nombre === 'gerente')?.id;
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

  let tmp = null;
  const creados = { traspasos: [] };
  try {
    console.log('=== 1. Personal: de qué tienda es ===');
    let r = await comoAdmin('POST', '/usuarios', {
      nombre: `TMP Tiendas ${MARCA}`, correo: `tmp.tiendas.${MARCA}@prueba.local`, contrasena: 'clave-de-prueba-1',
      rol_id: GERENTE, todas_las_tiendas: false, tiendas: [],
    });
    ck('sin ninguna tienda no se guarda (422 FALTA_TIENDA)', r.status === 422 && codigo(r) === 'FALTA_TIENDA', r.error);
    r = await comoAdmin('POST', '/usuarios', {
      nombre: `TMP Tiendas ${MARCA}`, correo: `tmp.tiendas.${MARCA}@prueba.local`, contrasena: 'clave-de-prueba-1',
      rol_id: GERENTE, todas_las_tiendas: false, tiendas: [mia.id],
    });
    ck('con su tienda se da de alta', r.status === 201, r.error);
    tmp = { id: r.data?.id, rol_id: GERENTE, rol: 'gerente' };
    ck('la ficha dice su tienda', r.data?.todas_las_tiendas == 0 && r.data?.tiendas?.map((t) => t.id).join() === String(mia.id), r.data?.tiendas);
    const yo = (me, ruta, b) => pedir(firmar(tmp), me, ruta, b);

    r = await yo('GET', '/usuarios/perfil');
    ck('su sesión sabe que solo ve su tienda', r.data?.alcance?.todas === false
      && r.data?.alcance?.almacenes?.map((a) => a.id).join() === String(mia.id), r.data?.alcance);

    console.log('=== 2. Almacenes y cajas ===');
    r = await yo('GET', '/almacenes');
    const ids = (r.data ?? []).map((a) => a.id).sort((a, b) => a - b);
    ck('ve su tienda y la matriz, nada más', ids.join() === [mia.id, matriz.id].sort((a, b) => a - b).join(), ids);
    ck('la matriz va marcada como no suya', r.data?.find((a) => a.id === matriz.id)?.mio === false);
    r = await yo('GET', '/caja/cajas');
    ck('solo las cajas de su tienda', (r.data ?? []).length > 0 && r.data.every((c) => Number(c.almacen_id) === mia.id), r.data?.map((c) => c.almacen_id));
    const [[cajaOtra]] = await db.query('SELECT id FROM cajas WHERE almacen_id <> ? ORDER BY id LIMIT 1', [mia.id]);
    if (cajaOtra) {
      r = await yo('GET', `/caja/sesiones/abierta?caja_id=${cajaOtra.id}`);
      ck('el turno de una caja de otra tienda: 404', r.status === 404, r.error);
    }

    console.log('=== 3. Ventas ===');
    r = await yo('GET', '/pedidos?limit=100');
    const [[vMia]] = await db.query('SELECT COUNT(*) n FROM pedidos WHERE almacen_id = ?', [mia.id]);
    ck('la lista trae solo las de su tienda', (r.data?.items ?? []).every((p) => Number(p.almacen_id ?? mia.id) === mia.id)
      && Number(r.data?.total) === Number(vMia.n), { total: r.data?.total, en_la_base: vMia.n });
    const [[pOtra]] = await db.query('SELECT id FROM pedidos WHERE almacen_id = ? ORDER BY id DESC LIMIT 1', [otra.id]);
    r = await yo('GET', `/pedidos/${pOtra.id}`);
    ck('una venta de otra tienda: 404 OTRA_TIENDA', r.status === 404 && codigo(r) === 'OTRA_TIENDA', r.error);
    r = await yo('PATCH', `/pedidos/${pOtra.id}/estado`, { estado: 'cancelado' });
    ck('…ni se cancela', r.status === 404, r.error);
    const [[pMia]] = await db.query('SELECT id FROM pedidos WHERE almacen_id = ? ORDER BY id DESC LIMIT 1', [mia.id]);
    r = await yo('GET', `/pedidos/${pMia.id}`);
    ck('una de su tienda sí la ve', r.status === 200, r.error);
    r = await yo('GET', '/pedidos/resumen');
    const [[sem]] = await db.query(
      `SELECT COUNT(*) n FROM pedidos WHERE almacen_id = ? AND estado NOT IN ('cancelado','devuelto')
          AND creado_en >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)`, [mia.id]
    );
    ck('las cifras de arriba son de su tienda', r.data?.semana?.ventas === Number(sem.n), { api: r.data?.semana, base: sem.n });

    console.log('=== 4. Inventario, kardex y traspasos ===');
    r = await yo('GET', `/inventario?almacen_id=${otra.id}`);
    ck('las existencias de otro almacén: 404', r.status === 404, r.error);
    r = await yo('GET', '/inventario?limit=200');
    ck('sus existencias son solo de su tienda', (r.data?.items ?? []).every((i) => Number(i.almacen_id) === mia.id), r.data?.total);
    r = await yo('GET', '/inventario/resumen');
    ck('el panorama trae solo su almacén', (r.data?.almacenes ?? []).map((a) => a.almacen_id).join() === String(mia.id),
      r.data?.almacenes?.map((a) => a.almacen_id));
    r = await yo('GET', '/inventario/movimientos?limit=200');
    ck('el kardex es solo de su tienda', (r.data?.items ?? []).every((x) => Number(x.almacen_id) === mia.id), r.data?.total);
    r = await yo('GET', '/inventario/traspasos?limit=100');
    ck('los traspasos son los que salen o llegan a su tienda',
      (r.data?.items ?? []).every((t) => Number(t.almacen_origen_id) === mia.id || Number(t.almacen_destino_id) === mia.id), r.data?.total);
    r = await yo('POST', '/inventario/movimientos', { variante_id: 1, almacen_id: otra.id, tipo: 'merma', cantidad: 1, motivo: 'TMP' });
    ck('un ajuste en otro almacén: 404, sin mover nada', r.status === 404, r.error);
    r = await yo('GET', `/variantes?almacen_id=${otra.id}&limit=5`);
    ck('buscar con las existencias de otra tienda: 404', r.status === 404, r.error);
    r = await yo('GET', `/variantes?almacen_id=${mia.id}&limit=5`);
    ck('…con las de la suya sí', r.status === 200, r.error);

    console.log('=== 5. Lo que suma todas las tiendas ===');
    for (const [ruta, que] of [
      ['/reportes/ventas', 'Reportes'], ['/analisis/tablero', 'Cómo va el negocio'],
      ['/clientes/analisis/frecuencia', 'las miradas de Clientes'],
    ]) {
      r = await yo('GET', ruta);
      ck(`${que}: 403 SOLO_TODAS_LAS_TIENDAS`, r.status === 403 && codigo(r) === 'SOLO_TODAS_LAS_TIENDAS', r.error);
    }
    r = await yo('GET', '/hoy');
    ck('Hoy: los turnos son de su tienda', (r.data?.cajas ?? []).every((c) => c.almacen === mia.nombre), r.data?.cajas?.map((c) => c.almacen));
    r = await yo('GET', '/notificaciones');
    ck('la campana no le avisa la cobranza de todas las tiendas', r.data?.cobranza?.num_clientes === 0 && r.data?.enfriados?.num_clientes === 0);

    console.log('=== 6. Un cliente compartido ===');
    const [[cli]] = await db.query(
      `SELECT cliente_id FROM pedidos WHERE cliente_id IS NOT NULL AND almacen_id = ?
          AND cliente_id NOT IN (SELECT cliente_id FROM pedidos WHERE almacen_id = ? AND cliente_id IS NOT NULL)
        GROUP BY cliente_id ORDER BY COUNT(*) DESC LIMIT 1`, [otra.id, mia.id]
    );
    if (cli) {
      const rA = await comoAdmin('GET', `/clientes/${cli.cliente_id}`);
      r = await yo('GET', `/clientes/${cli.cliente_id}`);
      ck('lo encuentra (el cliente es de todos)', r.status === 200, r.error);
      ck('sus compras de la otra tienda no salen', r.data?.total_pedidos === 0 && Number(r.data?.estadisticas?.num_pedidos) === 0,
        { suyas: r.data?.total_pedidos, todas: rA.data?.total_pedidos });
      ck('lo que debe sí, completo', r.data?.deuda_total?.total === rA.data?.deuda_total?.total, r.data?.deuda_total);
      const movs = r.data?.credito_movimientos ?? [];
      ck('los movimientos de la otra tienda van sin folio ni quién', movs.every((x) => !x.otra_tienda || (!x.numero_pedido && !x.registro)),
        movs.filter((x) => x.otra_tienda).length);
    } else {
      console.log('  (no hay un cliente que solo compre en la otra tienda: se salta)');
    }

    console.log('=== 7. Pedirle a la matriz A CIEGAS ===');
    const [[v]] = await db.query(
      `SELECT pv.id FROM producto_variantes pv JOIN inventario i ON i.variante_id = pv.id AND i.almacen_id = ?
        WHERE pv.tipo_presentacion = 'paquete' AND pv.activo = 1 AND pv.peso_kg > 0 ORDER BY pv.id LIMIT 1`, [matriz.id]
    );
    const pedido = { almacen_origen_id: matriz.id, almacen_destino_id: mia.id, notas: 'TMP prueba de tiendas', items: [{ variante_id: v.id, paquetes: 9999 }] };
    r = await comoAdmin('POST', '/inventario/traspasos', pedido);
    ck('quien ve todo y pide de más: 409 STOCK_INSUFICIENTE (control)', r.status === 409 && codigo(r) === 'STOCK_INSUFICIENTE', r.error);
    r = await yo('POST', '/inventario/traspasos', pedido);
    ck('ella sí puede pedirlo: no se le dice si hay', r.status === 201, r.error);
    if (r.data?.id) creados.traspasos.push(r.data.id);
    ck('la respuesta no dice cuánto hay en la matriz', (r.data?.lineas ?? []).every((l) => l.saldo_origen === undefined && l.apartado_origen === undefined), r.data?.lineas);
    if (r.data?.id) {
      const t = r.data.id;
      r = await yo('GET', `/inventario/traspasos/${t}`);
      ck('ve su solicitud', r.status === 200, r.error);
      r = await yo('POST', `/inventario/traspasos/${t}/enviar`, { codigos: ['NO-EXISTE'] });
      ck('surtirla no le toca (es de la matriz): 404', r.status === 404 && codigo(r) === 'OTRA_TIENDA', r.error);
      r = await yo('POST', `/inventario/traspasos/${t}/cancelar`, { motivo: 'TMP prueba' });
      ck('la puede cancelar (es para su tienda)', r.status === 200, r.error);
    }
    r = await yo('POST', '/inventario/traspasos', { ...pedido, almacen_origen_id: matriz.id, almacen_destino_id: otra.id === matriz.id ? mia.id : otra.id });
    if (otra.id !== matriz.id) ck('pedir para OTRA tienda: 404', r.status === 404, r.error);
    if (otra.id !== matriz.id) {
      r = await yo('POST', '/inventario/traspasos', { ...pedido, almacen_origen_id: otra.id, almacen_destino_id: mia.id });
      ck('a ciegas solo se le pide a la Matriz: a otra tienda, 404', r.status === 404, r.error);
    }

    console.log('=== 7b. Lo que encontró el revisor (2026-10-16) ===');
    // El lector de la caja: los paquetes de SU tienda, y de uno ajeno no se dice dónde ni en qué venta salió.
    const [[bMio]] = await db.query(
      `SELECT vc.codigo FROM variante_codigos vc
        WHERE vc.almacen_id = ? AND EXISTS (SELECT 1 FROM variante_codigos o WHERE o.variante_id = vc.variante_id AND o.almacen_id <> ?)
        LIMIT 1`, [mia.id, mia.id]
    );
    if (bMio) {
      r = await yo('GET', `/variantes/resolver/${encodeURIComponent(bMio.codigo)}`);
      const cods = r.data?.variante?.codigos ?? [];
      ck('el lector solo trae los paquetes de su tienda', r.status === 200 && cods.length > 0 && cods.every((b) => Number(b.almacen_id) === mia.id),
        [...new Set(cods.map((b) => b.almacen_id))]);
    }
    const [[bAjeno]] = await db.query(
      "SELECT codigo FROM variante_codigos WHERE almacen_id <> ? AND estado = 'vendido' AND consumido_id IS NOT NULL LIMIT 1", [mia.id]
    );
    if (bAjeno) {
      r = await yo('GET', `/variantes/resolver/${encodeURIComponent(bAjeno.codigo)}`);
      ck('un paquete vendido en otra tienda: ni dónde ni en qué venta', r.data?.bulto?.almacen === 'otra tienda' && r.data?.bulto?.consumido_folio == null,
        { almacen: r.data?.bulto?.almacen, folio: r.data?.bulto?.consumido_folio });
    }
    // El costo: ni en la venta, ni en el kardex, ni en la búsqueda; y no lo puede capturar.
    r = await yo('GET', `/pedidos/${pMia.id}`);
    ck('el detalle de su venta no trae el costo', (r.data?.detalle ?? []).length > 0 && r.data.detalle.every((d) => !('costo_unitario' in d)),
      r.data?.detalle?.[0] && Object.keys(r.data.detalle[0]).filter((k) => k.startsWith('costo')));
    const rA = await comoAdmin('GET', `/pedidos/${pMia.id}`);
    ck('…al administrador sí (control)', (rA.data?.detalle ?? []).every((d) => 'costo_unitario' in d));
    r = await yo('GET', '/inventario/movimientos?limit=20');
    ck('el kardex no trae el costo', (r.data?.items ?? []).every((m) => !('costo_unitario' in m)));
    r = await yo('GET', '/variantes?limit=5');
    ck('la búsqueda de presentaciones no trae el costo', (r.data?.items ?? r.data ?? []).every((x) => !('costo' in x)));
    r = await yo('PATCH', `/variantes/${v.id}`, { costo: 80 });
    ck('cambiar precio y peso ni acepta el costo (422)', r.status === 422, r.error?.code);
    r = await yo('POST', '/variantes', { producto_id: 1, sku: `TMP-COSTO-${MARCA}`, costo: 80 });
    ck('dar de alta una presentación con costo sin «Ver costos»: 403, sin crearla', r.status === 403, r.error);
    r = await yo('POST', '/inventario/movimientos', { variante_id: v.id, almacen_id: mia.id, tipo: 'merma', cantidad: 0.001, costo_unitario: 80, motivo: 'TMP' });
    ck('…tampoco en una merma: 403, sin mover nada', r.status === 403, r.error);
    // Quien es de la MATRIZ ve a qué tiendas surtir.
    r = await comoAdmin('PUT', `/usuarios/${tmp.id}`, { todas_las_tiendas: false, tiendas: [matriz.id] });
    ck('ahora es de la Matriz', r.status === 200, r.error);
    r = await yo('GET', '/almacenes');
    ck('quien es de la Matriz ve todas las tiendas para surtirles', (r.data ?? []).length === tiendas.length
      && r.data.filter((a) => a.mio).map((a) => a.id).join() === String(matriz.id), r.data?.map((a) => [a.id, a.mio]));

    console.log('=== 8. Con «Todas las tiendas» ve todo en el acto ===');
    r = await comoAdmin('PUT', `/usuarios/${tmp.id}`, { todas_las_tiendas: true });
    ck('se guarda', r.status === 200, r.error);
    r = await yo('GET', '/inventario/resumen');
    ck('el panorama ya trae todos los almacenes', (r.data?.almacenes ?? []).length >= 2, r.data?.almacenes?.length);
    r = await yo('GET', `/pedidos/${pOtra.id}`);
    ck('y la venta de la otra tienda', r.status === 200, r.error);
  } catch (e) {
    ck('sin errores inesperados', false, e.message);
  } finally {
    // Lo que se creó: la solicitud (ya cancelada, sin apartado) y la persona.
    for (const t of creados.traspasos) {
      await db.query('DELETE FROM traspaso_bultos WHERE detalle_id IN (SELECT id FROM traspaso_detalle WHERE traspaso_id = ?)', [t]);
      await db.query('DELETE FROM traspaso_detalle WHERE traspaso_id = ?', [t]);
      await db.query('DELETE FROM traspasos WHERE id = ?', [t]);
    }
    if (tmp?.id) await db.query("DELETE FROM usuarios WHERE id = ? AND nombre LIKE 'TMP Tiendas%'", [tmp.id]);
    const despues = await conteos();
    ck('la base quedó como estaba', JSON.stringify(despues) === JSON.stringify(antes), { antes, despues });
    await db.end();
    console.log(f ? `\n${f} FALLA(S)` : '\nTodo bien.');
    process.exit(f ? 1 : 0);
  }
})();
