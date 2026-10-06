'use strict';

/**
 * Pone al día las ventas a crédito que YA están pagadas y siguen 'pendiente'.
 *
 * Desde el 2026-10-06 el abono (y el ajuste que baja la deuda) da por pagadas
 * las ventas fiadas que cubre, de la más antigua a la más nueva
 * (clientes/model.js → liquidarVentasACredito). Las que se pagaron antes de eso
 * se quedaron 'pendiente'; esto les aplica la misma regla, cliente por cliente.
 *
 * Uso (desde backend/):
 *   node scripts/liquidar-ventas-credito.js --base <DB_NAME>                dice qué haría
 *   node scripts/liquidar-ventas-credito.js --base <DB_NAME> --confirmar    lo hace
 *
 * Se puede correr cuantas veces se quiera: solo mueve 'pendiente' → 'pagado'.
 */

require('dotenv').config();

const argv = process.argv.slice(2);
const base = argv[argv.indexOf('--base') + 1];
const CONFIRMAR = argv.includes('--confirmar');
if (!argv.includes('--base') || base !== process.env.DB_NAME) {
  console.error(`\n  ✗ Di qué base: --base ${process.env.DB_NAME || '<DB_NAME>'}\n`);
  process.exit(1);
}

const { pool } = require('../src/config/db');
const { liquidarVentasACredito, aplicarAbonos } = require('../src/modules/clientes/model');

async function main() {
  console.log(`\n  Ventas a crédito ya pagadas → base "${process.env.DB_NAME}" en ${process.env.DB_HOST}`);
  const [clientes] = await pool.query(
    `SELECT DISTINCT m.cliente_id AS id, c.nombre
       FROM credito_movimientos m JOIN clientes c ON c.id = m.cliente_id
      ORDER BY m.cliente_id`
  );

  // Todo en una transacción: sin --confirmar se deshace al final.
  const conn = await pool.getConnection();
  let total = 0;
  try {
    await conn.beginTransaction();
    for (const c of clientes) {
      const folios = await liquidarVentasACredito(conn, c.id);
      if (folios.length) {
        total += folios.length;
        console.log(`    ${c.nombre}: ${folios.join(', ')}`);
      }
    }
    if (CONFIRMAR) await conn.commit();
    else await conn.rollback();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  if (!total) console.log('    (ninguna)');

  // Al revés: fiadas que alguien marcó pagadas A MANO y todavía se deben (antes
  // del 2026-10-06 el cambio de estado lo dejaba). No se tocan: se avisan, para
  // que la tienda decida si se cobra o se regresa a 'pendiente'.
  const raras = [];
  for (const c of clientes) {
    const deudas = (await aplicarAbonos(pool, c.id)).filter((d) => d.pedidoId != null && d.porPagar > 0.004);
    if (!deudas.length) continue;
    const [peds] = await pool.query(
      `SELECT id, numero_pedido, estado FROM pedidos
        WHERE id IN (:ids) AND estado IN ('pagado', 'en_preparacion', 'enviado', 'entregado')`,
      { ids: deudas.map((d) => d.pedidoId) }
    );
    for (const p of peds) {
      const d = deudas.find((x) => x.pedidoId === Number(p.id));
      raras.push(`${c.nombre}: ${p.numero_pedido} dice "${p.estado}" y se deben $${d.porPagar.toFixed(2)}`);
    }
  }
  if (raras.length) {
    console.log('\n  ⚠ Marcadas pagadas a mano y todavía se deben (no se tocan):');
    for (const r of raras) console.log(`    ${r}`);
  }
  console.log(
    CONFIRMAR
      ? `\n  ✔ ${total} venta(s) pasaron a 'pagado'.\n`
      : `\n  ${total} venta(s) pasarían a 'pagado'. (Solo se mostró: agrega --confirmar)\n`
  );
}

main()
  .catch((e) => {
    console.error('\n  ✗', e.message, '\n');
    process.exitCode = 1;
  })
  .finally(() => pool.end());
