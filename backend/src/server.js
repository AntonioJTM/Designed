'use strict';

const app = require('./app');
const env = require('./config/env');
const { verificarConexion, pool } = require('./config/db');

// Punto de entrada: verifica la BD y arranca el servidor HTTP.
async function main() {
  try {
    await verificarConexion();
    console.log(`[db] Conexión establecida a ${env.db.host}:${env.db.port}/${env.db.database}`);
  } catch (err) {
    console.error('[db] No se pudo conectar a la base de datos:', err.message);
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`[http] API escuchando en http://localhost:${env.port} (${env.nodeEnv})`);
  });

  // Apagado ordenado: cierra el servidor y el pool de conexiones.
  const cerrar = (senal) => {
    console.log(`\n[http] Recibida señal ${senal}, cerrando...`);
    server.close(async () => {
      await pool.end();
      console.log('[http] Servidor y pool cerrados. Adiós.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => cerrar('SIGINT'));
  process.on('SIGTERM', () => cerrar('SIGTERM'));
}

main();
