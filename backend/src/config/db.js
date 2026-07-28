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
  // El servidor MySQL corre en hora local (time_zone = SYSTEM) y CURRENT_TIMESTAMP
  // guarda esa hora de pared. Con `dateStrings` las fechas vuelven tal cual
  // ('2026-07-25 11:59:39') en vez de que mysql2 las reinterprete como UTC y las
  // recorra 6 horas. Todo el sistema opera en una sola zona horaria.
  dateStrings: true,
  // Evita que DECIMAL vuelva como number y pierda precisión en montos.
  decimalNumbers: false,
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
