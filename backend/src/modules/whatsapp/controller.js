'use strict';

const conexion = require('./conexion');
const { AppError } = require('../../middlewares/error');

/** Cómo está el WhatsApp de la tienda (sin el QR): lo pregunta la ventana de cada ticket. */
async function estado(req, res, next) {
  try {
    res.json({ data: conexion.leerEstado(), error: null });
  } catch (err) { next(err); }
}

/** Lo mismo con el QR, para Configuración (mientras se espera que lo escaneen). */
async function enlace(req, res, next) {
  try {
    res.json({ data: conexion.leerEstado({ conQr: true }), error: null });
  } catch (err) { next(err); }
}

async function enlazar(req, res, next) {
  try {
    res.json({ data: await conexion.enlazar(), error: null });
  } catch (err) { next(err); }
}

async function desenlazar(req, res, next) {
  try {
    res.json({ data: await conexion.desenlazar(), error: null });
  } catch (err) { next(err); }
}

async function prueba(req, res, next) {
  try {
    res.json({ data: await conexion.enviarPrueba(req.body.telefono), error: null });
  } catch (err) { next(err); }
}

/** Un texto que viene en una cabecera (con acentos: la pantalla lo manda con encodeURIComponent). */
function cabecera(req, nombre) {
  const v = req.get(nombre);
  if (!v) return '';
  try { return decodeURIComponent(v); } catch { return v; }
}

/**
 * Manda un ticket: el PDF llega EN CRUDO en el cuerpo (como la captura del
 * comprobante) y el teléfono, el nombre del archivo y el mensaje en cabeceras.
 */
async function enviar(req, res, next) {
  try {
    const pdf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!pdf || pdf.length < 5 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new AppError(422, 'NO_ES_PDF', 'Solo se mandan tickets en PDF.');
    }
    // El nombre que verá el cliente: sin rutas ni caracteres raros, y terminado en .pdf.
    let archivo = cabecera(req, 'X-Archivo').replace(/[\/:*?"<>|\r\n]+/g, '-').trim().slice(0, 120) || 'Ticket';
    if (!/\.pdf$/i.test(archivo)) archivo += '.pdf';
    const mensaje = cabecera(req, 'X-Mensaje').slice(0, 1000);
    res.json({
      data: await conexion.enviarDocumento({ telefono: cabecera(req, 'X-Telefono'), pdf, archivo, mensaje }),
      error: null,
    });
  } catch (err) { next(err); }
}

module.exports = { estado, enlace, enlazar, desenlazar, prueba, enviar };
