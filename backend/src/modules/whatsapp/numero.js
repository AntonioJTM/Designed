'use strict';

/**
 * El número de WhatsApp de un cliente, como lo pide WhatsApp: solo números y con
 * la clave del país. Un celular de México son 10 números y lleva el 52 adelante;
 * si ya lo trae (o el 521 de antes), se respeta; uno de otro país, con "+" y su
 * clave. Es la misma regla que la ventana de la pantalla (`shared/ticket/whatsapp.ts`).
 *
 * Devuelve null si no sirve. El número exacto con que WhatsApp lo tiene registrado
 * (en México a veces con el 1) lo da `onWhatsApp` al mandar.
 */
function numeroWhatsapp(texto) {
  const t = String(texto ?? '').trim();
  const d = t.replace(/\D/g, '');
  if (d.length === 10) return `52${d}`;
  if (d.length === 12 && d.startsWith('52')) return d;
  if (d.length === 13 && d.startsWith('521')) return `52${d.slice(3)}`;
  if (d.length >= 10 && d.length <= 15 && t.startsWith('+')) return d;
  return null;
}

/** "5217751659032@s.whatsapp.net" o "527751659032:3@s.whatsapp.net" → "+52 775 165 9032". */
function numeroLegible(jid) {
  const d = String(jid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!d) return null;
  const mx = d.startsWith('521') && d.length === 13 ? d.slice(3) : d.startsWith('52') && d.length === 12 ? d.slice(2) : null;
  if (mx) return `+52 ${mx.slice(0, 3)} ${mx.slice(3, 6)} ${mx.slice(6)}`;
  return `+${d}`;
}

module.exports = { numeroWhatsapp, numeroLegible };
