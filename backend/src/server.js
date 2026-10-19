'use strict';

const app = require('./app');
const env = require('./config/env');
const { verificarConexion, pool } = require('./config/db');
const whatsapp = require('./modules/whatsapp/conexion');

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
    // Si el WhatsApp de la tienda ya estaba enlazado, se vuelve a conectar solo.
    whatsapp.arrancar();
  });

  // La conexión de WhatsApp corre en este mismo proceso: si algo suyo falla en
  // segundo plano, se apunta y la API sigue atendiendo (antes se caía el servicio).
  process.on('unhandledRejection', (e) => console.error('[proceso] promesa sin atender:', e?.message ?? e));

  // Apagado ordenado: cierra el servidor y el pool de conexiones.
  const cerrar = (senal) => {
    console.log(`\n[http] Recibida señal ${senal}, cerrando...`);
    whatsapp.detener();
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
