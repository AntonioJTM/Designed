'use strict';

// Genera un dump SQL (estructura + datos + vistas) de la BD del .env.
// Uso:  node scripts/dump-db.js [ruta_salida.sql]
// Por defecto guarda en ../db/dump_<base>_<fecha>.sql

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');

const cfg = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

function fechaArchivo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main() {
  const salida =
    process.argv[2] ||
    path.resolve(__dirname, '..', '..', 'db', `dump_${cfg.database}_${fechaArchivo()}.sql`);

  const conn = await mysql.createConnection({ ...cfg, dateStrings: true });

  const esc = (v) => {
    if (v === null || v === undefined) return 'NULL';
    if (Buffer.isBuffer(v)) return '0x' + v.toString('hex');
    if (v instanceof Date) return conn.escape(v);
    if (typeof v === 'object') return conn.escape(JSON.stringify(v)); // columnas JSON
    return conn.escape(v);
  };

  const [meta] = await conn.query(
    `SELECT table_name AS name, table_type AS type
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
      ORDER BY (table_type = 'VIEW'), table_name`
  );
  const tablas = meta.filter((t) => t.type === 'BASE TABLE').map((t) => t.name);
  const vistas = meta.filter((t) => t.type === 'VIEW').map((t) => t.name);

  const out = [];
  out.push(`-- Dump de la base de datos '${cfg.database}' (${cfg.host})`);
  out.push(`-- Generado: ${new Date().toISOString()}`);
  out.push(`-- Tablas: ${tablas.length} · Vistas: ${vistas.length}`);
  out.push('SET NAMES utf8mb4;');
  out.push('SET FOREIGN_KEY_CHECKS = 0;');
  out.push('');

  let totalFilas = 0;
  for (const t of tablas) {
    const [[create]] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
    out.push(`-- ---------- Tabla: ${t} ----------`);
    out.push(`DROP TABLE IF EXISTS \`${t}\`;`);
    out.push(create['Create Table'] + ';');
    out.push('');

    const [rows] = await conn.query(`SELECT * FROM \`${t}\``);
    if (rows.length) {
      const cols = Object.keys(rows[0]).map((c) => `\`${c}\``).join(', ');
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const grupo = rows.slice(i, i + CHUNK);
        const values = grupo
          .map((r) => '(' + Object.values(r).map(esc).join(', ') + ')')
          .join(',\n  ');
        out.push(`INSERT INTO \`${t}\` (${cols}) VALUES\n  ${values};`);
      }
      totalFilas += rows.length;
    }
    out.push('');
  }

  for (const v of vistas) {
    const [[create]] = await conn.query(`SHOW CREATE VIEW \`${v}\``);
    let ddl = create['Create View'].replace(/DEFINER=`[^`]*`@`[^`]*` /i, '');
    ddl = ddl.replace(/^CREATE /i, 'CREATE OR REPLACE ');
    out.push(`-- ---------- Vista: ${v} ----------`);
    out.push(`DROP VIEW IF EXISTS \`${v}\`;`);
    out.push(ddl + ';');
    out.push('');
  }

  out.push('SET FOREIGN_KEY_CHECKS = 1;');
  out.push('');

  fs.writeFileSync(salida, out.join('\n'), 'utf8');
  await conn.end();
  console.log(`OK · ${tablas.length} tablas, ${vistas.length} vistas, ${totalFilas} filas`);
  console.log(`Archivo: ${salida} (${(fs.statSync(salida).size / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error('Error al generar el dump:', e.message);
  process.exit(1);
});
