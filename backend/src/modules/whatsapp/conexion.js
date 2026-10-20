'use strict';

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const env = require('../../config/env');
const { AppError } = require('../../middlewares/error');
const { numeroWhatsapp, numeroLegible } = require('./numero');

/**
 * EL WHATSAPP DE LA TIENDA, ENLAZADO AL SISTEMA (2026-10-16: "configurar WhatsApp
 * dentro de la página para que no tenga que estarlo abriendo; que me pida
 * escanear el QR para enlazarlo y listo"). El usuario eligió el código QR —como
 * WhatsApp Web— sobre la API oficial de Meta, sabiendo que no es la conexión
 * oficial: WhatsApp podría bloquear el número si cree que son mensajes
 * automáticos, y puede dejar de funcionar unos días cuando WhatsApp cambie algo.
 *
 * Usa Baileys (un "dispositivo vinculado" más del celular de la tienda, sin
 * navegador). Hay UNA conexión por sistema, en este mismo proceso:
 *   · Se enlaza desde Configuración (`enlazar` → el QR, que cambia cada ~20 s;
 *     si nadie lo escanea en unos 2 minutos, se da por vencido).
 *   · La sesión vive en `uploads/whatsapp/` (el despliegue no toca uploads/), así
 *     que al reiniciar el servicio se vuelve a conectar sola (`arrancar`).
 *   · Si se cae, se reintenta cada vez más espaciado; si la cierran desde el
 *     celular, se borra y hay que volver a enlazar.
 * Solo MANDA (los tickets en PDF y la prueba); no lee ni guarda los chats.
 *
 * Solo se enciende en el sistema de la base REAL (`hitex`): el de pruebas tiene
 * clientes inventados, y sus teléfonos podrían ser de alguien de verdad. Se
 * fuerza con WHATSAPP=si / WHATSAPP=no.
 */

const ACTIVO = (process.env.WHATSAPP ?? (env.db.database === 'hitex' ? 'si' : 'no')).toLowerCase() === 'si';
const CARPETA = path.join(env.uploadsDir, 'whatsapp');
const SESION = path.join(CARPETA, 'sesion');
const INFO = path.join(CARPETA, 'enlace.json');
/**
 * La marca de "se cerró la sesión desde el celular": va FUERA de la carpeta de la
 * sesión (que se borra) para que la campana lo siga diciendo aunque se reinicie
 * el servicio, hasta que se vuelva a enlazar o se desenlace a propósito.
 */
const AVISO = path.join(env.uploadsDir, 'whatsapp-aviso.json');
/** Cuánto tiempo sin poder conectar (ya enlazado) antes de avisarlo en la campana. */
const AVISAR_SIN_CONEXION_MS = 10 * 60 * 1000;
/** Cuántos QR se enseñan antes de darse por vencido (cada uno dura ~20 s). */
const MAX_QR = 6;
/** Las esperas entre reintentos cuando se cae la conexión. */
const ESPERAS = [2000, 5000, 10000, 30000, 60000];

/** Baileys habla mucho; aquí solo se apuntan los cambios de estado. */
const CALLADO = { level: 'silent', child() { return CALLADO; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

let lib = null;
let sock = null;
let qrVistos = 0;
let intentos = 0;
let reintento = null;
/** Desde cuándo está "conectando" sin lograrlo (ms), para el aviso de la campana. */
let conectandoDesde = null;
let estado = ACTIVO
  ? { estado: 'sin_enlazar', qr: null, numero: null, nombre: null, desde: null, aviso: null }
  : { estado: 'apagado', qr: null, numero: null, nombre: null, desde: null, aviso: 'En este sistema no se enlaza WhatsApp: es el de pruebas.' };

function poner(cambios) {
  estado = { ...estado, ...cambios };
  if (estado.estado === 'conectando') conectandoDesde ??= Date.now();
  else conectandoDesde = null;
}

/** "2026-10-16 17:05:00" en la hora de la tienda (el proceso corre con TZ de México). */
function ahoraLocal(ms = Date.now()) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function leerAviso() {
  try {
    return JSON.parse(fs.readFileSync(AVISO, 'utf8'));
  } catch {
    return null;
  }
}

function quitarAviso() {
  fs.rmSync(AVISO, { force: true });
}

/**
 * EL AVISO DE LA CAMPANA (2026-10-16: "si se cierra la sesión, el cajero se entera
 * hasta que intenta mandar un ticket"): para quien entra a Configuración. Dos
 * casos: la sesión se cerró desde el celular (o WhatsApp la cerró), o ya enlazado
 * no se ha podido conectar en 10 minutos. null si todo está bien.
 */
function avisoCampana() {
  if (!ACTIVO) return null;
  const marca = leerAviso();
  if (marca && estado.estado !== 'enlazado') return { motivo: 'sesion_cerrada', desde: marca.desde ?? null };
  if (estado.estado === 'conectando' && conectandoDesde && haySesion() && Date.now() - conectandoDesde > AVISAR_SIN_CONEXION_MS) {
    return { motivo: 'sin_conexion', desde: ahoraLocal(conectandoDesde) };
  }
  return null;
}

/** Cómo está: `estado` es apagado | sin_enlazar | conectando | esperando_qr | enlazado. El QR, solo a quien configura. */
function leerEstado({ conQr = false } = {}) {
  const { qr, ...resto } = estado;
  return conQr ? { ...resto, qr } : resto;
}

async function libreria() {
  if (!lib) lib = await import('@whiskeysockets/baileys');
  return lib;
}

const haySesion = () => fs.existsSync(path.join(SESION, 'creds.json'));

function borrarSesion() {
  fs.rmSync(CARPETA, { recursive: true, force: true });
}

function leerDesde() {
  try {
    return JSON.parse(fs.readFileSync(INFO, 'utf8')).desde ?? null;
  } catch {
    return null;
  }
}

function detener() {
  clearTimeout(reintento);
  reintento = null;
  const s = sock;
  sock = null;
  if (s) {
    try { s.end(undefined); } catch { /* ya estaba cerrada */ }
  }
}

async function conectar() {
  if (sock || !ACTIVO) return;
  clearTimeout(reintento);
  reintento = null;
  const b = await libreria();
  fs.mkdirSync(SESION, { recursive: true });
  const { state, saveCreds } = await b.useMultiFileAuthState(SESION);
  let version;
  try {
    ({ version } = await b.fetchLatestBaileysVersion());
  } catch { /* usa la que trae la librería */ }
  if (sock) return;
  const s = b.makeWASocket({
    auth: state,
    logger: CALLADO,
    version,
    browser: b.Browsers.windows('Hitex'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });
  sock = s;
  if (estado.estado !== 'enlazado') poner({ estado: 'conectando', qr: null });
  s.ev.on('creds.update', saveCreds);
  s.ev.on('connection.update', (u) => {
    alCambiar(s, b, state, u).catch((e) => console.error('[whatsapp]', e.message));
  });
}

async function alCambiar(s, b, auth, u) {
  if (sock !== s) return;

  if (u.qr) {
    qrVistos++;
    if (qrVistos > MAX_QR) {
      // Nadie lo escaneó: se apaga hasta que lo vuelvan a pedir.
      detener();
      borrarSesion();
      poner({ estado: 'sin_enlazar', qr: null, aviso: 'Se acabó el tiempo para escanear el código. Vuelve a apretar «Enlazar WhatsApp».' });
      return;
    }
    poner({ estado: 'esperando_qr', qr: await QRCode.toDataURL(u.qr, { margin: 1, width: 300 }), aviso: null });
  }

  if (u.connection === 'open') {
    intentos = 0;
    qrVistos = 0;
    let desde = leerDesde();
    if (!desde) {
      desde = new Date().toISOString();
      fs.writeFileSync(INFO, JSON.stringify({ desde }));
    }
    quitarAviso();
    poner({
      estado: 'enlazado', qr: null, aviso: null, desde,
      numero: numeroLegible(s.user?.id), nombre: s.user?.name || s.user?.verifiedName || null,
    });
    console.log(`[whatsapp] enlazado con ${estado.numero}`);
  }

  if (u.connection === 'close') {
    sock = null;
    const codigo = u.lastDisconnect?.error?.output?.statusCode;
    if (codigo === b.DisconnectReason.loggedOut) {
      borrarSesion();
      fs.writeFileSync(AVISO, JSON.stringify({ desde: ahoraLocal() }));
      poner({
        estado: 'sin_enlazar', qr: null, numero: null, nombre: null, desde: null,
        aviso: 'Se cerró la sesión desde el celular (o WhatsApp la cerró). Para seguir mandando tickets, vuelve a enlazarlo.',
      });
      console.log('[whatsapp] la sesión se cerró desde el celular');
      return;
    }
    // Tras escanear, WhatsApp pide reconectar (restartRequired): se hace en el acto.
    if (codigo === b.DisconnectReason.restartRequired) {
      await conectar();
      return;
    }
    // Sin enlazar todavía (se venció el QR o falló): no se insiste solo.
    if (!auth.creds.me) {
      borrarSesion();
      poner({ estado: 'sin_enlazar', qr: null, aviso: estado.estado === 'esperando_qr'
        ? 'Se acabó el tiempo para escanear el código. Vuelve a apretar «Enlazar WhatsApp».'
        : 'No se pudo conectar con WhatsApp. Vuelve a intentarlo en un momento.' });
      return;
    }
    // Enlazado y se cayó (internet, reinicio de WhatsApp…): se reintenta, cada vez más espaciado.
    const espera = ESPERAS[Math.min(intentos, ESPERAS.length - 1)];
    intentos++;
    poner({ estado: 'conectando', qr: null });
    console.log(`[whatsapp] se cayó (${codigo ?? 'sin código'}); reintento en ${espera / 1000} s`);
    reintento = setTimeout(() => conectar().catch((e) => console.error('[whatsapp]', e.message)), espera);
  }
}

/** Espera (sin bloquear) a que algo se cumpla, o al límite. */
function esperarA(cond, ms) {
  return new Promise((ok) => {
    const fin = Date.now() + ms;
    const ver = () => (cond() || Date.now() > fin ? ok() : setTimeout(ver, 200));
    ver();
  });
}

function exigirActivo() {
  if (!ACTIVO) throw new AppError(409, 'WHATSAPP_APAGADO', estado.aviso);
}

/** Empieza a enlazar: devuelve el QR en cuanto llega (o el estado, si ya está enlazado). */
async function enlazar() {
  exigirActivo();
  if (!sock) {
    qrVistos = 0;
    poner({ aviso: null });
    await conectar();
  }
  await esperarA(() => estado.qr || estado.estado === 'enlazado' || estado.estado === 'sin_enlazar', 10000);
  return leerEstado({ conQr: true });
}

/** Lo quita del celular (deja de aparecer en "Dispositivos vinculados") y borra la sesión. */
async function desenlazar() {
  exigirActivo();
  clearTimeout(reintento);
  reintento = null;
  const s = sock;
  sock = null;
  if (s) {
    try { await s.logout(); } catch { /* ya estaba fuera */ }
    try { s.end(undefined); } catch { /* ya estaba cerrada */ }
  }
  borrarSesion();
  // Lo quitó alguien a propósito: no es un aviso.
  quitarAviso();
  qrVistos = 0;
  intentos = 0;
  poner({ estado: 'sin_enlazar', qr: null, numero: null, nombre: null, desde: null, aviso: null });
  console.log('[whatsapp] desenlazado');
  return leerEstado();
}

function exigirEnlazado() {
  exigirActivo();
  if (!sock || estado.estado !== 'enlazado') {
    throw new AppError(409, 'WHATSAPP_SIN_ENLAZAR',
      estado.estado === 'conectando'
        ? 'El WhatsApp de la tienda se está volviendo a conectar. Inténtalo en un momento.'
        : 'El WhatsApp de la tienda no está enlazado. Se enlaza en Configuración.');
  }
  return sock;
}

function conLimite(promesa, ms, mensaje) {
  let t;
  return Promise.race([
    promesa,
    new Promise((_, mal) => { t = setTimeout(() => mal(new AppError(503, 'WHATSAPP_NO_CONTESTA', mensaje)), ms); }),
  ]).finally(() => clearTimeout(t));
}

/** El chat de ese número tal como lo tiene WhatsApp (en México a veces con el 1), o por qué no. */
async function chatDe(s, telefono) {
  const numero = numeroWhatsapp(telefono);
  if (!numero) throw new AppError(422, 'NUMERO_INVALIDO', 'El número no sirve: un celular de México lleva 10 números.');
  const [r] = await conLimite(s.onWhatsApp(`${numero}@s.whatsapp.net`), 15000, 'WhatsApp no contestó. Vuelve a intentarlo en un momento.');
  if (!r?.exists) throw new AppError(422, 'SIN_WHATSAPP', `El número ${numeroLegible(numero)} no tiene WhatsApp.`);
  return r.jid;
}

// Uno a la vez: dos cajas mandando al mismo tiempo no se estorban.
let fila = Promise.resolve();
function enFila(tarea) {
  const r = fila.then(tarea, tarea);
  fila = r.catch(() => {});
  return r;
}

/** Manda un PDF (el ticket) al cliente, con su mensaje. */
async function enviarDocumento({ telefono, pdf, archivo, mensaje }) {
  const s = exigirEnlazado();
  return enFila(async () => {
    const jid = await chatDe(s, telefono);
    await conLimite(
      s.sendMessage(jid, { document: pdf, mimetype: 'application/pdf', fileName: archivo, caption: mensaje || undefined }),
      60000, 'WhatsApp tardó demasiado en mandarlo. Revisa en el celular si llegó antes de volver a mandarlo.'
    );
    console.log(`[whatsapp] ticket "${archivo}" mandado`);
    return { enviado: true, numero: numeroLegible(jid) };
  });
}

/** Un mensaje de texto (el aviso de sus vacaciones a un empleado, 2026-10-19). */
async function enviarTexto({ telefono, mensaje }) {
  const s = exigirEnlazado();
  return enFila(async () => {
    const jid = await chatDe(s, telefono);
    await conLimite(s.sendMessage(jid, { text: mensaje }), 30000, 'WhatsApp tardó demasiado en mandarlo.');
    return { enviado: true, numero: numeroLegible(jid) };
  });
}

/** Un mensaje de prueba, para ver que quedó bien enlazado. */
async function enviarPrueba(telefono) {
  const s = exigirEnlazado();
  return enFila(async () => {
    const jid = await chatDe(s, telefono);
    await conLimite(
      s.sendMessage(jid, { text: 'Prueba de Hitex: el WhatsApp de la tienda quedó enlazado al sistema. Desde aquí se mandarán los tickets.' }),
      30000, 'WhatsApp tardó demasiado en mandarlo. Revisa en el celular si llegó.'
    );
    return { enviado: true, numero: numeroLegible(jid) };
  });
}

/** Al arrancar el servidor: si ya estaba enlazado, se vuelve a conectar solo. */
function arrancar() {
  if (ACTIVO && !haySesion() && leerAviso()) {
    // Se cerró desde el celular antes de reiniciar: Configuración lo sigue diciendo.
    poner({ aviso: 'Se cerró la sesión desde el celular (o WhatsApp la cerró). Para seguir mandando tickets, vuelve a enlazarlo.' });
  }
  if (!ACTIVO || !haySesion()) return;
  poner({ estado: 'conectando', desde: leerDesde() });
  conectar().catch((e) => {
    console.error('[whatsapp] no se pudo conectar al arrancar:', e.message);
    poner({ estado: 'conectando' });
    reintento = setTimeout(() => conectar().catch(() => {}), ESPERAS[2]);
  });
}

module.exports = { leerEstado, enlazar, desenlazar, enviarDocumento, enviarTexto, enviarPrueba, arrancar, detener, avisoCampana };
