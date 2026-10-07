'use strict';

/**
 * Prueba de los PRECIOS POR LISTA en la pantalla de presentaciones (2026-10-06):
 * "los cargo, le doy guardar y me regresa a 200". Se guardaban, pero
 * `GET /productos/:id` —con el que la pantalla recarga— no los traía, así que
 * volvían a verse vacíos.
 *
 *   · al personal, el detalle del producto trae los precios por lista de cada
 *     presentación, los que se acaban de guardar;
 *   · sin sesión (la ruta es pública) NO los trae;
 *   · dejar una lista vacía la quita (vuelve a pagar el público).
 *
 * Crea un hilo "TMPPL …" y lo borra al final.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-precios-lista.js   # contra la base de pruebas
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
  const t = jwt.sign({ sub: admin.id, tipo: 'usuario', rol_id: admin.rol_id, rol: 'administrador' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const api = async (me, r, b, conToken = true) => {
    const x = await fetch(B + r, {
      method: me,
      headers: { ...(conToken ? { Authorization: 'Bearer ' + t } : {}), 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };

  let productoId = null;
  try {
    const [listas] = await db.query('SELECT id, nombre FROM tipos_cliente WHERE es_publico = 0 ORDER BY id LIMIT 2');
    if (listas.length < 2) throw new Error('Hacen falta dos listas de precio que no sean la del público');
    const [cat] = (await db.query('SELECT id FROM categorias ORDER BY id LIMIT 1'))[0];
    const [kg] = (await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1"))[0];

    console.log('=== 1. Se guardan y se ven al recargar ===');
    let r = await api('POST', '/productos', {
      categoria_id: cat.id, unidad_medida_id: kg.id, nombre: 'TMPPL CAFE ' + Date.now().toString(36), precio_kg: 200, multipresentacion: true,
    });
    productoId = r.data?.id;
    ck('hilo de prueba con su presentación', r.status === 201 && !!productoId, r.error);
    r = await api('GET', `/productos/${productoId}`);
    const v = r.data?.variantes?.[0];
    ck('la presentación nace con su lista de precios vacía', Array.isArray(v?.precios) && v.precios.length === 0, v?.precios);

    r = await api('PUT', `/variantes/${v.id}/precios`, { tipo_cliente_id: listas[0].id, precio: 180 });
    ck(`se guarda ${listas[0].nombre} a $180`, r.status === 200, r.error);
    r = await api('PUT', `/variantes/${v.id}/precios`, { tipo_cliente_id: listas[1].id, precio: 160 });
    ck(`se guarda ${listas[1].nombre} a $160`, r.status === 200, r.error);

    r = await api('GET', `/productos/${productoId}`);
    const precios = r.data?.variantes?.[0]?.precios ?? [];
    const de = (id) => Number(precios.find((p) => p.tipo_cliente_id === id)?.precio);
    ck('al recargar el producto, el personal ve los dos precios', de(listas[0].id) === 180 && de(listas[1].id) === 160, precios);

    console.log('\n=== 2. El público no los ve ===');
    r = await api('GET', `/productos/${productoId}`, undefined, false);
    ck('sin sesión, el detalle no trae precios por lista', r.status === 200 && r.data?.variantes?.[0]?.precios === undefined,
      r.data?.variantes?.[0]?.precios);

    console.log('\n=== 3. Vaciar una lista la quita ===');
    r = await api('PUT', `/variantes/${v.id}/precios`, { tipo_cliente_id: listas[1].id, precio: null });
    ck('se quita', r.status === 200, r.error);
    r = await api('GET', `/productos/${productoId}`);
    const quedan = r.data?.variantes?.[0]?.precios ?? [];
    ck('queda solo la otra lista', quedan.length === 1 && quedan[0].tipo_cliente_id === listas[0].id, quedan);
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    if (productoId) {
      await db.query('DELETE FROM variante_precios WHERE variante_id IN (SELECT id FROM producto_variantes WHERE producto_id = ?)', [productoId]);
      await db.query('DELETE FROM producto_variantes WHERE producto_id = ?', [productoId]);
      await db.query('DELETE FROM productos WHERE id = ?', [productoId]);
    }
    const [[n]] = await db.query("SELECT COUNT(*) n FROM productos WHERE nombre LIKE 'TMPPL %'");
    ck('no quedó basura (TMPPL)', Number(n.n) === 0, n.n);
    await db.end();
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
