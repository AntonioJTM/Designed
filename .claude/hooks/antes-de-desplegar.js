#!/usr/bin/env node
'use strict';

/**
 * CANDADO: NO SE SUBE SI FALLAN LAS PRUEBAS (2026-10-16).
 *
 * Hook PreToolUse de Claude Code (.claude/settings.json). Se ejecuta antes de
 * cada comando de Bash; si el comando es un despliegue (`npm run deploy`,
 * `deploy:frontend` o `deploy:backend`), corre primero:
 *   · las pruebas del servidor  (backend: npm test)
 *   · las pruebas de pantallas  (frontend: ng test, en Chrome sin ventana)
 * y si alguna falla, DETIENE el despliegue (sale con 2: Claude Code no corre el
 * comando y le pasa a Claude el porqué). Cualquier otro comando pasa sin más.
 *
 * Las E2E no van aquí: corren contra la base de pruebas remota y tardan; se
 * corren antes, a mano (ver la skill /desplegar).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let entrada = {};
try {
  entrada = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0); // Sin datos legibles no se estorba.
}
const comando = String(entrada.tool_input?.command ?? '');
if (!/\bnpm\s+run\s+deploy(:frontend|:backend)?(\s|$|;|&|\|)/.test(comando)) process.exit(0);

const raiz = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');

/** Corre una prueba; devuelve null si pasó o lo último de su salida si falló. */
function correr(nombre, carpeta, linea) {
  const r = spawnSync(linea, { cwd: path.join(raiz, carpeta), shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 0) return null;
  // Los colores de la terminal estorban al leer el motivo.
  const salida = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const importantes = salida.split('\n').filter((l) => /FAIL|✖|not ok|Error|Expected|TOTAL/i.test(l));
  return `${nombre}:\n${(importantes.length ? importantes : salida.split('\n')).slice(-25).join('\n')}`;
}

const fallas = [
  correr('Pruebas del servidor (backend: npm test)', 'backend', 'npm test'),
  correr('Pruebas de pantallas (frontend: ng test)', 'frontend', 'npx ng test --watch=false --browsers=ChromeHeadless'),
].filter(Boolean);

if (fallas.length) {
  process.stderr.write(
    'NO SE SUBE: fallaron las pruebas. Arréglalas y vuelve a desplegar.\n\n' + fallas.join('\n\n') + '\n'
  );
  process.exit(2);
}
process.exit(0);
