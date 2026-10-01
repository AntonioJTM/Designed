'use strict';

/**
 * Aplica un archivo de migración a la base del entorno cargado.
 *
 *   node scripts/aplicar-migracion.js ../db/migrations/2026-09_algo.sql
 *   node --env-file=.env.produccion scripts/aplicar-migracion.js <archivo>
 *
 * Antes de escribir nada dice A QUÉ BASE va y espera confirmación, porque la
 * base del servidor se llama IGUAL que la local ("desarrollo") y lo único que
 * las distingue es el host. Con `--si` no pregunta (para usarlo en un script).
 *
 * NO lleva registro de lo aplicado: quién está y quién falta lo dice
 * `estado-migraciones.js` mirando la estructura real de la base, que es la
 * única fuente que no miente. Lo aprendimos el 2026-09-05, cuando una
 * migración que la bitácora daba por aplicada llevaba semanas sin correr.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

(async () => {
  const archivo = process.argv[2];
  const sinPreguntar = process.argv.includes('--si');
  if (!archivo) {
    console.error('Uso: node scripts/aplicar-migracion.js <archivo.sql> [--si]');
    process.exit(2);
  }
  const ruta = path.resolve(archivo);
  if (!fs.existsSync(ruta)) {
    console.error('No existe:', ruta);
    process.exit(2);
  }
  const sql = fs.readFileSync(ruta, 'utf8');

  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  const [[donde]] = await c.query('SELECT @@hostname h, DATABASE() db');
  const esRemota = !['localhost', '127.0.0.1'].includes(process.env.DB_HOST);

  console.log(`\n  Archivo : ${path.basename(ruta)}`);
  console.log(`  Base    : ${donde.db}`);
  console.log(`  Servidor: ${donde.h}  (${process.env.DB_HOST})`);
  if (esRemota) console.log('\n  ⚠  Es una base REMOTA. Asegúrate de tener respaldo.');

  if (!sinPreguntar) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const r = (await rl.question('\n  ¿Aplicar? (escribe "si"): ')).trim().toLowerCase();
    rl.close();
    if (r !== 'si') {
      console.log('  Cancelado. No se tocó nada.');
      await c.end();
      process.exit(1);
    }
  }

  try {
    await c.query(sql);
    console.log('\n  ✔ Aplicada.');
  } catch (e) {
    console.error('\n  ✗ FALLÓ:', e.code || '', e.message);
    console.error('    La migración pudo quedar A MEDIAS: MySQL no revierte los');
    console.error('    ALTER TABLE. Revisa la estructura antes de reintentar.');
    await c.end();
    process.exit(1);
  }
  await c.end();
})().catch((e) => {
  console.error('ERROR:', e.code || '', e.message);
  process.exit(2);
});
