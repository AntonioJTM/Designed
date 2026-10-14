'use strict';

// Carga variables de entorno desde .env (si existe) una sola vez.
require('dotenv').config();

/** Devuelve una variable obligatoria o aborta el arranque si falta. */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
  }
  return value;
}

/** Devuelve una variable opcional con valor por defecto. */
function optional(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

const path = require('node:path');

/**
 * LA HORA DE LA TIENDA: México centro, UTC-6 fijo (sin horario de verano desde
 * 2022). El servidor (VPS) y su MariaDB corren en UTC; sin esto, después de las
 * 18:00 el sistema ya creía que era mañana: una venta de las 23:09 quedaba con
 * fecha del día siguiente y Pedidos no la enseñaba (2026-10-06).
 *  · `TZ` pone a Node en esa hora (lo que se calcula en JS: "hoy", la semana).
 *  · `DB_TIMEZONE` la pone en cada conexión a la base (NOW(), CURDATE(),
 *    CURRENT_TIMESTAMP), ver config/db.js.
 * Si un script ya fijó su TZ (los de la muestra usan UTC), se respeta.
 */
if (!process.env.TZ) process.env.TZ = optional('TZ_TIENDA', 'America/Mexico_City');

const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '3000')),

  // Dónde viven los archivos que sube el personal (las capturas de los
  // comprobantes de pago). Fuera de la base a propósito: los respaldos son
  // mysqldump y meterle imágenes los volvería inmanejables.
  // Se sirven por endpoint autenticado, NUNCA con express.static: un
  // comprobante bancario no puede quedar accesible con solo adivinar la URL.
  uploadsDir: path.resolve(
    optional('UPLOADS_DIR', path.join(__dirname, '..', '..', 'uploads'))
  ),

  db: {
    host: optional('DB_HOST', 'localhost'),
    port: Number(optional('DB_PORT', '3306')),
    user: required('DB_USER'),
    password: optional('DB_PASSWORD', ''),
    database: required('DB_NAME'),
    connectionLimit: Number(optional('DB_CONNECTION_LIMIT', '10')),
    // Desfase con que habla cada conexión: la hora de la tienda (ver arriba).
    timezone: optional('DB_TIMEZONE', '-06:00'),
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: optional('JWT_EXPIRES_IN', '8h'),
  },

  bcryptRounds: Number(optional('BCRYPT_ROUNDS', '12')),

  corsOrigin: optional('CORS_ORIGIN', '*'),
  // (Hasta el 2026-10-13 aquí iba `ia`, la configuración del asistente
  // "Pregúntame" con Google Gemini. Se quitó con todo el asistente.)
};

module.exports = env;
