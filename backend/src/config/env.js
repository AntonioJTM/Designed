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

const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '3000')),

  db: {
    host: optional('DB_HOST', 'localhost'),
    port: Number(optional('DB_PORT', '3306')),
    user: required('DB_USER'),
    password: optional('DB_PASSWORD', ''),
    database: required('DB_NAME'),
    connectionLimit: Number(optional('DB_CONNECTION_LIMIT', '10')),
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: optional('JWT_EXPIRES_IN', '8h'),
  },

  bcryptRounds: Number(optional('BCRYPT_ROUNDS', '12')),

  corsOrigin: optional('CORS_ORIGIN', '*'),
};

module.exports = env;
