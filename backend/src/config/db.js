'use strict';

const mysql = require('mysql2/promise');
const env = require('./env');

// Pool de conexiones compartido en toda la app.
// Nombres de columnas en snake_case español, tal como en db/schema_mysql.sql.
const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  queueLimit: 0,
  namedPlaceholders: true,
  charset: 'utf8mb4',
  // Las fechas se guardan y se leen en la HORA DE LA TIENDA (ver abajo y
  // config/env.js). Con `dateStrings` vuelven tal cual ('2026-07-25 11:59:39')
  // en vez de que mysql2 las reinterprete. Todo el sistema opera en una sola
  // zona horaria.
  dateStrings: true,
  // Evita que DECIMAL vuelva como number y pierda precisión en montos.
  decimalNumbers: false,
});

// Cada conexión habla en la hora de la tienda. El MariaDB del servidor corre en
// UTC (time_zone = SYSTEM): sin esto NOW() y CURRENT_TIMESTAMP guardaban la hora
// UTC y CURDATE() cambiaba de día a las 18:00 de México. Antes la base vivía en
// una máquina en hora local y no hacía falta; al pasarla al servidor se adelantó
// todo 6 horas (lo corrigió scripts/ajustar-hora.js el 2026-10-06).
if (!/^[+-]\d{2}:\d{2}$/.test(env.db.timezone)) {
  throw new Error(`DB_TIMEZONE inválida: "${env.db.timezone}" (se espera algo como -06:00)`);
}
pool.pool.on('connection', (conn) => {
  conn.query(`SET time_zone = '${env.db.timezone}'`);
});

/** Verifica que la BD sea alcanzable; se llama al arrancar el servidor. */
async function verificarConexion() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

/**
 * Ejecuta una función dentro de una transacción y garantiza commit/rollback.
 * Uso: await withTransaction(async (conn) => { ... });
 */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, verificarConexion, withTransaction };
