'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const env = require('../config/env');

/**
 * Archivos que sube el personal (hoy: las capturas de los comprobantes de
 * pago). Viven en DISCO, fuera de la base: un dump de la base pesa 90 KB y
 * meterle imágenes lo volvería inmanejable.
 *
 * OJO CON EL DESPLIEGUE: `deploy/deploy.sh` sincroniza con `rsync --delete`,
 * que borraría esta carpeta si quedara dentro de lo que sincroniza. Está
 * excluida ahí explícitamente; si cambias la ruta, revisa esa exclusión.
 */

/**
 * Tipos que se aceptan, con su firma (los primeros bytes del archivo).
 *
 * Se valida por la FIRMA y no por la extensión ni por el Content-Type: los dos
 * los pone quien sube y se pueden mentir. Un .exe renombrado a .jpg no pasa.
 */
const FIRMAS = [
  { tipo: 'image/jpeg', ext: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  { tipo: 'image/png', ext: '.png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { tipo: 'application/pdf', ext: '.pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
];

/** WEBP es RIFF....WEBP: la firma está partida en dos, así que va aparte. */
function esWebp(buf) {
  return (
    buf.length > 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  );
}

/**
 * Qué es el archivo, mirando sus bytes. Devuelve `{ tipo, ext }` o `null` si
 * no es ninguno de los aceptados.
 */
function reconocer(buf) {
  if (!buf || buf.length < 12) return null;
  if (esWebp(buf)) return { tipo: 'image/webp', ext: '.webp' };
  for (const f of FIRMAS) {
    if (f.bytes.every((b, i) => buf[i] === b)) return { tipo: f.tipo, ext: f.ext };
  }
  return null;
}

/** Carpeta de un tipo de archivo, creada si no existe. */
async function _carpeta(subcarpeta) {
  const dir = path.join(env.uploadsDir, subcarpeta);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Guarda un archivo y devuelve el nombre con el que quedó en disco.
 *
 * El nombre se GENERA (aleatorio + extensión según la firma): el que mandó
 * quien sube se conserva aparte, solo para mostrarlo. Así un nombre con `../`
 * o con caracteres raros no puede escribir fuera de la carpeta.
 */
async function guardar(subcarpeta, buf) {
  const reconocido = reconocer(buf);
  if (!reconocido) return null;

  const dir = await _carpeta(subcarpeta);
  const nombre = crypto.randomBytes(16).toString('hex') + reconocido.ext;
  await fs.writeFile(path.join(dir, nombre), buf);
  return { nombre, tipo: reconocido.tipo };
}

/** Lee un archivo guardado. Devuelve `null` si ya no está. */
async function leer(subcarpeta, nombre) {
  if (!nombre || !_nombreSeguro(nombre)) return null;
  try {
    return await fs.readFile(path.join(env.uploadsDir, subcarpeta, nombre));
  } catch {
    // El archivo pudo borrarse por fuera. No es un error del que llama: se
    // resuelve mostrando "ya no está" en vez de tumbar la petición.
    return null;
  }
}

/** Borra un archivo. No falla si ya no existe. */
async function borrar(subcarpeta, nombre) {
  if (!nombre || !_nombreSeguro(nombre)) return;
  await fs.rm(path.join(env.uploadsDir, subcarpeta, nombre), { force: true });
}

/**
 * Un nombre generado por `guardar`: hex y una extensión. Cualquier otra cosa
 * —una barra, un punto doble— se rechaza antes de tocar el disco, aunque el
 * nombre venga de la base.
 */
function _nombreSeguro(nombre) {
  return /^[0-9a-f]{32}\.(jpg|png|webp|pdf)$/.test(nombre);
}

module.exports = { guardar, leer, borrar, reconocer };
