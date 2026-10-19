/**
 * MANDAR UN TICKET POR WHATSAPP (2026-10-16: "que se puedan mandar los tickets
 * de venta, de abonos, de anticipos, de devolución y de ventas canceladas a los
 * clientes por WhatsApp"). El usuario eligió mandarlo en PDF: se baja el PDF, se
 * abre el chat del cliente con un mensaje corto y el PDF se arrastra al chat.
 *
 * Aquí van las cuentas que no tocan la pantalla: el número (un celular de México
 * lleva 10 números y WhatsApp lo quiere con el 52 adelante), el enlace del chat y
 * el mensaje que lo acompaña.
 */

/** Lo que se sabe del número que se tecleó: el de WhatsApp, o qué le falta. */
export interface NumeroWhatsapp {
  /** Solo números y con la clave del país ("527751234567"); null si no hay o no sirve. */
  numero: string | null;
  /** Por qué no sirve, en palabras de la tienda; null si sirve o si está vacío. */
  problema: string | null;
}

/**
 * "775 123 4567" → "527751234567". Un celular de México son 10 números; si ya
 * trae el 52 (o el 521 de antes), se respeta. Uno de otro país se escribe con
 * "+" y su clave. Vacío no es un error: entonces se elige el contacto en WhatsApp.
 */
export function numeroWhatsapp(texto: string | null | undefined): NumeroWhatsapp {
  const t = String(texto ?? '').trim();
  const d = t.replace(/\D/g, '');
  if (!d) return { numero: null, problema: null };
  if (d.length === 10) return { numero: `52${d}`, problema: null };
  if (d.length === 12 && d.startsWith('52')) return { numero: d, problema: null };
  // El "1" después del 52 ya no se usa: WhatsApp lo encuentra sin él.
  if (d.length === 13 && d.startsWith('521')) return { numero: `52${d.slice(3)}`, problema: null };
  if (d.length < 10) {
    return { numero: null, problema: `Le faltan números: un celular de México lleva 10 (van ${d.length}).` };
  }
  if (t.startsWith('+')) return { numero: d, problema: null };
  return { numero: null, problema: 'No parece un celular de México (10 números). Si es de otro país, escríbelo con + y su clave.' };
}

/** El chat del cliente con el mensaje escrito; sin número, WhatsApp pide elegir el contacto. */
export function enlaceWhatsapp(numero: string | null, mensaje: string): string {
  return `https://wa.me/${numero ?? ''}?text=${encodeURIComponent(mensaje)}`;
}

const PEQUENAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'el']);

/** "MARTHA LOPEZ RUIZ" → "Martha Lopez Ruiz"; "MARIA DE LA LUZ" → "Maria de la Luz". */
export function nombrePropio(nombre: string): string {
  return nombre
    .trim()
    .toLocaleLowerCase('es-MX')
    .split(/\s+/)
    .map((p, i) => (i > 0 && PEQUENAS.has(p) ? p : p.charAt(0).toLocaleUpperCase('es-MX') + p.slice(1)))
    .join(' ');
}

/**
 * El mensaje que acompaña al PDF: "Hola Martha Lopez Ruiz, le mandamos su
 * ticket de venta POS-468D por $2,820.25. ¡Gracias por su compra! — Hitex".
 * Corto a propósito: lo demás lo dice el ticket.
 */
export function mensajeWhatsapp(nombre: string | null | undefined, que: string, tienda: string, gracias = false): string {
  const hola = nombre?.trim() ? `Hola ${nombrePropio(nombre)}` : 'Hola';
  return `${hola}, le mandamos ${que}.${gracias ? ' ¡Gracias por su compra!' : ''} — ${tienda}`;
}
