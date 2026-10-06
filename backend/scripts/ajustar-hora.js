'use strict';

/**
 * Recorre a la HORA DE LA TIENDA (UTC-6) las fechas que se guardaron en UTC.
 *
 * El MariaDB del servidor corre en UTC y hasta el 2026-10-06 las conexiones no
 * decían en qué hora hablaban: NOW() y CURRENT_TIMESTAMP guardaban la hora UTC
 * (una venta de las 23:09 quedó a las 05:09 del día siguiente y Pedidos no la
 * enseñaba). Desde entonces cada conexión habla en la hora de la tienda
 * (config/db.js); esto corrige lo que ya estaba guardado.
 *
 * Qué se recorre: todas las columnas DATETIME de todas las tablas (no las DATE:
 * un día no tiene hora). Si la base tiene la MUESTRA sembrada, sus fechas ya
 * están en hora de México (la sembró un reloj simulado), así que solo se
 * recorren los valores POSTERIORES a su última fecha, que son los que puso el
 * sistema en vivo.
 *
 * Una sola vez por base: deja la marca en `_zona_horaria` y, si ya está, no hace
 * nada. Cada tabla va en UNA sentencia con todas sus columnas, para que
 * `ON UPDATE CURRENT_TIMESTAMP` no pise `actualizado_en`.
 *
 * Uso (desde backend/):
 *   node scripts/ajustar-hora.js --base <DB_NAME>                 dice qué haría
 *   node scripts/ajustar-hora.js --base <DB_NAME> --confirmar     lo hace
 *   node --env-file=.env.produccion scripts/ajustar-hora.js --base hitex --confirmar
 */

require('dotenv').config();

const argv = process.argv.slice(2);
const base = argv[argv.indexOf('--base') + 1];
const CONFIRMAR = argv.includes('--confirmar');
if (!argv.includes('--base') || base !== process.env.DB_NAME) {
  console.error(`\n  ✗ Di qué base se ajusta: --base ${process.env.DB_NAME || '<DB_NAME>'}\n`);
  process.exit(1);
}

const { pool, withTransaction } = require('../src/config/db');

const HORAS = 6;
const SIN_CORTE = '1000-01-01 00:00:00';

async function main() {
  console.log(`\n  Ajustar la hora → base "${process.env.DB_NAME}" en ${process.env.DB_HOST}`);

  const [[marca]] = await pool.query(
    "SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '_zona_horaria'"
  );
  if (Number(marca.n)) {
    const [[m]] = await pool.query('SELECT zona, corte, aplicado_en FROM _zona_horaria ORDER BY id LIMIT 1');
    if (m) {
      console.log(`  Ya se ajustó el ${m.aplicado_en} (${m.zona}, desde ${m.corte}). Nada que hacer.\n`);
      return;
    }
  }

  // Las columnas DATETIME, por tabla (solo tablas, no vistas).
  const [cols] = await pool.query(
    `SELECT c.TABLE_NAME AS tabla, c.COLUMN_NAME AS col
       FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES t
         ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
      WHERE c.TABLE_SCHEMA = DATABASE() AND c.DATA_TYPE = 'datetime' AND c.TABLE_NAME NOT LIKE '\\_%'
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`
  );
  const porTabla = new Map();
  for (const { tabla, col } of cols) porTabla.set(tabla, [...(porTabla.get(tabla) ?? []), col]);

  // Con muestra, el corte es la última fecha que puso su reloj simulado: lo
  // anterior ya está en hora de México. Todas sus columnas menos `actualizado_en`:
  // esa se toca en vivo (en UTC) cuando alguien edita una fila de la muestra y
  // correría el corte de más.
  const NO_CUENTA = ['actualizado_en'];
  let corte = SIN_CORTE;
  const [[hayMuestra]] = await pool.query(
    "SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '_demo_registros'"
  );
  if (Number(hayMuestra.n)) {
    const [tablas] = await pool.query('SELECT DISTINCT tabla FROM _demo_registros');
    for (const { tabla } of tablas) {
      for (const col of (porTabla.get(tabla) ?? []).filter((c) => !NO_CUENTA.includes(c))) {
        const [[r]] = await pool.query(
          `SELECT MAX(x.\`${col}\`) AS m FROM \`${tabla}\` x
             JOIN _demo_registros d ON d.tabla = :t AND d.registro_id = x.id`,
          { t: tabla }
        );
        if (r.m && r.m > corte) corte = r.m;
      }
    }
    // Mejor aún: la hora REAL en que se sembró (la guarda sembrar.js, en UTC). Lo
    // que el sistema escribió en vivo después ya va en UTC, aunque sea sobre una
    // fila de la muestra (un traspaso de la muestra que alguien envió).
    const [[sembrado]] = await pool.query("SELECT valor FROM _demo_estado WHERE clave = 'sembrado'");
    const en = sembrado ? JSON.parse(sembrado.valor).en : null;
    if (en) corte = String(en).replace('T', ' ').slice(0, 19);
    console.log(`  Hay muestra sembrada: solo se recorren las fechas posteriores a ${corte}.`);
  }

  const sentencias = [];
  for (const [tabla, columnas] of porTabla) {
    const set = columnas
      .map((c) => `\`${c}\` = IF(\`${c}\` > :corte, \`${c}\` - INTERVAL ${HORAS} HOUR, \`${c}\`)`)
      .join(', ');
    const donde = columnas.map((c) => `\`${c}\` > :corte`).join(' OR ');
    const [[n]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${tabla}\` WHERE ${donde}`, { corte });
    if (Number(n.n)) sentencias.push({ tabla, filas: Number(n.n), sql: `UPDATE \`${tabla}\` SET ${set} WHERE ${donde}` });
  }

  console.log(`\n  Se recorrería ${HORAS} horas hacia atrás:`);
  for (const s of sentencias) console.log(`    ${s.tabla.padEnd(26)} ${s.filas} filas`);
  if (!sentencias.length) console.log('    (nada)');

  if (!CONFIRMAR) {
    console.log('\n  (Solo se mostró. Para hacerlo de verdad: agrega --confirmar)\n');
    return;
  }

  await withTransaction(async (conn) => {
    for (const s of sentencias) await conn.query(s.sql, { corte });
    await conn.query(
      `CREATE TABLE IF NOT EXISTS _zona_horaria (
         id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         zona        VARCHAR(10) NOT NULL,
         corte       DATETIME NOT NULL,
         aplicado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    await conn.query('INSERT INTO _zona_horaria (zona, corte) VALUES (:z, :c)', {
      z: `-0${HORAS}:00`,
      c: corte,
    });
  });
  console.log(`\n  ✔ Listo: ${sentencias.reduce((s, x) => s + x.filas, 0)} filas en ${sentencias.length} tablas.\n`);
}

main()
  .catch((e) => {
    console.error('\n  ✗', e.message, '\n');
    process.exitCode = 1;
  })
  .finally(() => pool.end());
