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
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: optional('JWT_EXPIRES_IN', '8h'),
  },

  bcryptRounds: Number(optional('BCRYPT_ROUNDS', '12')),

  corsOrigin: optional('CORS_ORIGIN', '*'),

  /**
   * El asistente que contesta preguntas del negocio en lenguaje natural.
   *
   * Sin `IA_API_KEY` el asistente queda APAGADO y lo dice: es mejor que
   * arrancar y fallar en la primera pregunta con un error del proveedor.
   *
   * `IA_BASE_URL` está para poder cambiar de proveedor sin tocar código —hoy
   * Gemini, que habla el mismo protocolo que OpenAI— y para poder apuntarlo a
   * un doble en las pruebas.
   */
  ia: {
    apiKey: optional('IA_API_KEY', ''),
    // Gemini por su endpoint COMPATIBLE CON OPENAI: habla el mismo protocolo
    // (`messages` + `tools`), así que el asistente no distingue el proveedor.
    baseUrl: optional('IA_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai'),
    // `-latest` es un ALIAS que Google mantiene apuntando al modelo vigente.
    // Se eligió a propósito: un nombre fijo se RETIRA (ya pasó con
    // `gemini-2.5-flash-lite`, que devuelve 404 "no longer available") y
    // entonces el asistente deja de contestar sin que nadie haya tocado nada.
    // El `-lite` se midió contra las otras opciones (3 corridas del flujo
    // completo de dos vueltas): 29.9 s de promedio y 0 fallos, contra 44.7 s de
    // `gemini-3.5-flash-lite` y 2 fallos de 3 de `gemini-flash-latest` con el
    // razonamiento apagado. Es el más rápido Y el más estable de los probados.
    modelo: optional('IA_MODELO', 'gemini-flash-lite-latest'),
    // Cuántas vueltas puede dar el bucle de herramientas antes de rendirse.
    // Sin tope, una pregunta mal entendida podría encadenar llamadas y gastar
    // saldo sin llegar a nada.
    maxVueltas: Number(optional('IA_MAX_VUELTAS', '4')),
    // 60 s por llamada, no 45. Se midió el flujo real y una vuelta sola puede
    // pasar de 45 s cuando la capa gratuita va cargada: con el tope anterior se
    // abortaba una respuesta que iba a llegar, y el usuario veía "la IA tardó
    // demasiado" por nada.
    timeoutMs: Number(optional('IA_TIMEOUT_MS', '60000')),
    // Cuánto esperar antes de reintentar un fallo PASAJERO (el 503 "high
    // demand" de Gemini). En las pruebas se pone en 0 para no tardar.
    esperaReintentoMs: Number(optional('IA_ESPERA_REINTENTO_MS', '1500')),
  },
};

module.exports = env;
