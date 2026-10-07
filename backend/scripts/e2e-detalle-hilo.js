'use strict';

/**
 * Prueba del DETALLE DE UN HILO (2026-10-06): Inventario → clic en el hilo →
 * dónde está, sus lotes y los paquetes de cada lote.
 *
 * NO ESCRIBE NADA. Toma los hilos con paquetes de la base y comprueba que lo que
 * contesta el servidor cuadra con la base:
 *   · el saldo de cada presentación es la suma de `inventario`;
 *   · cada lote cuenta sus paquetes por estado igual que `variante_codigos`, y
 *     los disponibles por almacén suman lo del lote;
 *   · los paquetes de un lote son exactamente los suyos, también "sin lote";
 *   · un hilo que no existe da 404, sin decir el lote da 422, y un cliente no
 *     entra.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-detalle-hilo.js   # contra la base de pruebas
 *
 * Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';
const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

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
  const [[cajero]] = await db.query(
    `SELECT u.id, u.rol_id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = 'cajero' AND u.activo = 1 ORDER BY u.id LIMIT 1`
  );
  const t = jwt.sign({ sub: cajero.id, tipo: 'usuario', rol_id: cajero.rol_id, rol: cajero.rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const tCliente = jwt.sign({ sub: 999999999, tipo: 'cliente' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const api = async (r, token = t) => {
    const x = await fetch(B + r, { headers: { Authorization: 'Bearer ' + token } });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };

  try {
    // Los cinco hilos con más paquetes (y uno con paquetes sin lote, si hay).
    const [hilos] = await db.query(
      `SELECT pv.producto_id, COUNT(*) n FROM variante_codigos vc JOIN producto_variantes pv ON pv.id = vc.variante_id
        GROUP BY pv.producto_id ORDER BY n DESC LIMIT 5`
    );
    const [[sinLote]] = await db.query(
      `SELECT pv.producto_id FROM variante_codigos vc JOIN producto_variantes pv ON pv.id = vc.variante_id
        WHERE vc.lote IS NULL OR TRIM(vc.lote) = '' LIMIT 1`
    );
    const ids = [...new Set([...hilos.map((h) => h.producto_id), ...(sinLote ? [sinLote.producto_id] : [])])];
    if (!ids.length) throw new Error('No hay hilos con paquetes en esta base');

    for (const id of ids) {
      const r = await api(`/inventario/hilos/${id}`);
      const d = r.data;
      console.log(`\n=== ${d?.hilo?.producto} ${d?.hilo?.calibre ?? ''} (producto ${id}) ===`);
      ck('contesta', r.status === 200, r.error);

      // Saldos = inventario.
      const [saldos] = await db.query(
        `SELECT i.variante_id, SUM(i.cantidad) kg FROM inventario i JOIN producto_variantes pv ON pv.id = i.variante_id
          WHERE pv.producto_id = ? GROUP BY i.variante_id`, [id]
      );
      const bien = saldos.every((s) => r3(d.presentaciones.find((p) => p.variante_id === s.variante_id)?.total ?? 0) === r3(s.kg));
      ck('el saldo de cada presentación es el de inventario', bien);

      // Lotes = variante_codigos por estado.
      const [porLote] = await db.query(
        `SELECT NULLIF(TRIM(vc.lote), '') lote, vc.estado, COUNT(*) n, SUM(vc.peso_kg) kg
           FROM variante_codigos vc JOIN producto_variantes pv ON pv.id = vc.variante_id
          WHERE pv.producto_id = ? GROUP BY NULLIF(TRIM(vc.lote), ''), vc.estado`, [id]
      );
      let cuadra = true;
      for (const g of porLote) {
        const l = d.lotes.find((x) => x.lote === g.lote);
        const parte = g.estado === 'disponible' ? l?.disponibles : g.estado === 'vendido' ? l?.vendidos : l?.desarmados;
        if (!parte || parte.bultos !== Number(g.n) || (g.estado !== 'desarmado' && r3(parte.kg) !== r3(g.kg))) {
          cuadra = false;
          console.log('   no cuadra', g, parte);
        }
      }
      ck('cada lote cuenta sus paquetes por estado igual que la base', cuadra);
      ck('los disponibles por almacén suman lo del lote', d.lotes.every(
        (l) => l.disponibles.por_almacen.reduce((s, a) => s + a.bultos, 0) === l.disponibles.bultos
      ));
      ck('el resumen suma los lotes', d.resumen.bultos_disponibles === d.lotes.reduce((s, l) => s + l.disponibles.bultos, 0));

      // Los paquetes de cada lote.
      let todos = true;
      for (const l of d.lotes) {
        const q = l.lote === null ? 'sin_lote=1' : `lote=${encodeURIComponent(l.lote)}`;
        const b = await api(`/inventario/hilos/${id}/bultos?${q}`);
        if (b.status !== 200 || b.data.length !== l.bultos) {
          todos = false;
          console.log('   lote', l.lote, 'esperaba', l.bultos, 'llegaron', b.data?.length, b.error);
        }
      }
      ck('cada lote trae exactamente sus paquetes', todos);
    }

    console.log('\n=== Lo que no debe pasar ===');
    let r = await api('/inventario/hilos/999999999');
    ck('un hilo que no existe: 404', r.status === 404, r.status);
    r = await api(`/inventario/hilos/${ids[0]}/bultos`);
    ck('sin decir el lote: 422', r.status === 422 && r.error?.code === 'FALTA_LOTE', r.error?.code);
    r = await api(`/inventario/hilos/${ids[0]}`, tCliente);
    ck('un cliente no entra', r.status === 403, r.status);
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    await db.end();
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
