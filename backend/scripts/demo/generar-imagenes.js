'use strict';

/**
 * Dibuja la foto de catálogo de cada hilo de la muestra —un cono de hilo de
 * su color— y la deja en `frontend/public/demo/hilos/<color>-<calibre>.png`,
 * que es la URL que `sembrar.js` le pone al producto.
 *
 * Se corre en una máquina con Chrome (lo usa en modo headless para pasar el
 * SVG a PNG) y luego se despliega el frontend:
 *
 *   node scripts/demo/generar-imagenes.js
 *   npm run deploy:frontend           (desde la raíz)
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { HILOS } = require('./catalogo');

const CHROMES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const chrome = CHROMES.find((c) => fs.existsSync(c));
if (!chrome) {
  console.error('No encontré Chrome. Indícalo con CHROME=/ruta/al/chrome');
  process.exit(1);
}

const DESTINO = path.resolve(__dirname, '../../../frontend/public/demo/hilos');
fs.mkdirSync(DESTINO, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hilos-'));

const slug = (h) =>
  `${h.nombre}-${h.calibre}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** Aclara (t>0) u oscurece (t<0) un color #rrggbb. */
function tono(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t))
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function svg(h) {
  const c = h.color;
  // Cuerpo del cono: angosto arriba, ancho abajo, con la base curva.
  const cuerpo = 'M 232 150 L 368 150 L 452 468 Q 300 512 148 468 Z';
  // Devanado cruzado: dos familias de líneas diagonales recortadas al cono.
  const lineas = (pend, color, ancho) =>
    Array.from({ length: 34 }, (_, i) => {
      const x = 40 + i * 16;
      return `<line x1="${x}" y1="130" x2="${x + pend}" y2="530" stroke="${color}" stroke-width="${ancho}"/>`;
    }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <linearGradient id="fondo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F7F4EF"/><stop offset="1" stop-color="#ECE6DC"/>
    </linearGradient>
    <linearGradient id="hilo" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${tono(c, -0.28)}"/>
      <stop offset="0.32" stop-color="${tono(c, 0.22)}"/>
      <stop offset="0.55" stop-color="${c}"/>
      <stop offset="1" stop-color="${tono(c, -0.42)}"/>
    </linearGradient>
    <linearGradient id="tubo" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#B89868"/><stop offset="0.4" stop-color="#E3CDA4"/><stop offset="1" stop-color="#A88758"/>
    </linearGradient>
    <clipPath id="cono"><path d="${cuerpo}"/></clipPath>
  </defs>
  <rect width="600" height="600" fill="url(#fondo)"/>
  <ellipse cx="300" cy="492" rx="190" ry="26" fill="#000" opacity="0.10"/>
  <path d="M 270 70 L 330 70 L 342 160 L 258 160 Z" fill="url(#tubo)"/>
  <ellipse cx="300" cy="70" rx="30" ry="8" fill="#9C7B4C"/>
  <ellipse cx="300" cy="70" rx="18" ry="4.5" fill="#5E4A2E"/>
  <path d="${cuerpo}" fill="url(#hilo)"/>
  <g clip-path="url(#cono)" opacity="0.9">
    ${lineas(140, tono(c, 0.35), 2.2)}
    ${lineas(-140, tono(c, -0.35), 2)}
  </g>
  <ellipse cx="300" cy="150" rx="68" ry="11" fill="${tono(c, 0.12)}"/>
  <ellipse cx="300" cy="150" rx="40" ry="6" fill="url(#tubo)"/>
  <path d="M 148 468 Q 300 512 452 468" fill="none" stroke="${tono(c, -0.5)}" stroke-width="3" opacity="0.6"/>
</svg>`;
}

for (const h of HILOS) {
  const archivoSvg = path.join(TMP, `${slug(h)}.svg`);
  const archivoPng = path.join(DESTINO, `${slug(h)}.png`);
  fs.writeFileSync(archivoSvg, svg(h));
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=600,600',
    `--screenshot=${archivoPng}`,
    `file:///${archivoSvg.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' });
  console.log(`  ✓ ${path.relative(process.cwd(), archivoPng)}`);
}
fs.rmSync(TMP, { recursive: true, force: true });
