#!/usr/bin/env node
'use strict';

/**
 * Pone al día el PESO DE UN CONO de los conos que ya existen (2026-10-19): lo
 * que pesaron al bajarlos —paquete escaneado + destare— entre cuántos salieron,
 * con todas sus bajadas (`inventario/peso-cono.js`). Desde ese día se recalcula
 * solo en cada bajada; esto es para los conos de antes.
 *
 *   node scripts/recalcular-peso-conos.js --base <DB_NAME>                dice qué haría
 *   node scripts/recalcular-peso-conos.js --base <DB_NAME> --confirmar    lo hace
 *
 * Solo cambia `producto_variantes.peso_kg` de los conos con bajadas: no mueve
 * kilos, ni kardex, ni precios. Se puede correr cuantas veces se quiera.
 */
require('dotenv').config();
const { pool } = require('../src/config/db');
const { pesoPorCono } = require('../src/modules/inventario/peso-cono');

const argv = process.argv.slice(2);
const base = argv[argv.indexOf('--base') + 1];
const CONFIRMAR = argv.includes('--confirmar');
if (!argv.includes('--base') || base !== process.env.DB_NAME) {
  console.error(`\n  ✗ Di qué base: --base ${process.env.DB_NAME || '<DB_NAME>'}\n`);
  process.exit(1);
}

(async () => {
  const [[{ b }]] = await pool.query('SELECT DATABASE() AS b');
  const [conos] = await pool.query(
    `SELECT pv.id, pv.sku, pv.peso_kg FROM producto_variantes pv
      WHERE pv.tipo_presentacion = 'cono'
        AND EXISTS (SELECT 1 FROM variante_conversiones c WHERE c.variante_destino_id = pv.id)
      ORDER BY pv.sku`
  );
  console.log(`\n  Peso de un cono → base "${b}"`);
  let cambian = 0;
  for (const c of conos) {
    const [bajadas] = await pool.query(
      'SELECT kg_consumidos, destare_kg, piezas_generadas FROM variante_conversiones WHERE variante_destino_id = :id',
      { id: c.id }
    );
    const peso = pesoPorCono(bajadas);
    const antes = c.peso_kg == null ? null : Number(c.peso_kg);
    if (peso == null || antes === peso) continue;
    cambian += 1;
    console.log(`    ${c.sku.padEnd(32)} ${String(antes ?? '—').padStart(8)} kg → ${String(peso).padStart(8)} kg  (${bajadas.length} bajada(s))`);
    if (CONFIRMAR) {
      await pool.query('UPDATE producto_variantes SET peso_kg = :peso WHERE id = :id', { peso, id: c.id });
    }
  }
  if (!cambian) console.log('    (ninguno cambia)');
  console.log(`\n  ${cambian} cono(s) ${CONFIRMAR ? 'puestos al día.' : 'cambiarían. (Solo se mostró: agrega --confirmar)'}\n`);
  await pool.end();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await pool.end();
  process.exit(1);
});
