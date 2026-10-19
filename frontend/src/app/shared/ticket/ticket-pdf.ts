import { prepararHoja } from './ticket';

/**
 * EL TICKET EN PDF (2026-10-16), para mandarlo por WhatsApp: el usuario eligió
 * "PDF para adjuntar". Es EL MISMO ticket que se imprime (`armarTicket*`), no
 * otro dibujado aparte: si mañana cambia el ticket, el PDF cambia con él.
 *
 * Cómo se hace, sin librerías:
 *   1. El ticket se arma en un marco fuera de la vista, como al imprimir, y se
 *      espera al logo (`prepararHoja`).
 *   2. Se copia dentro de un SVG (`foreignObject`) con su hoja de estilos y el
 *      logo metido como imagen en el mismo texto, y el navegador lo dibuja en un
 *      lienzo a 4 veces su tamaño, para que las letras salgan nítidas al
 *      acercarlo en el celular.
 *   3. El lienzo se pasa a grises (el ticket es negro sobre blanco), se comprime
 *      sin perder nada (`CompressionStream`, lo que pide el PDF) y se mete en un
 *      PDF de UNA hoja del tamaño del ticket.
 * Las letras del ticket son las del sistema (Arial), que el dibujo sí encuentra.
 */

/** Cuántas veces se agranda el dibujo (4 = unos 384 puntos por pulgada). */
const ESCALA = 4;
/** El lienzo más alto que aguanta el navegador, con holgura (un ticket larguísimo se dibuja más chico). */
const ALTO_MAXIMO = 30000;

export interface TicketDibujado {
  lienzo: HTMLCanvasElement;
  /** El tamaño del ticket en píxeles de pantalla (96 por pulgada). */
  anchoPx: number;
  altoPx: number;
}

/** El ticket (el documento que arma `armarTicket*`) convertido en PDF. */
export async function ticketEnPdf(html: string, titulo: string): Promise<Blob> {
  return armarPdf(await dibujarTicket(html), titulo);
}

/** Dibuja el ticket en un lienzo, igual que se imprime. */
export async function dibujarTicket(html: string): Promise<TicketDibujado> {
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  marco.tabIndex = -1;
  marco.style.cssText = 'position:fixed;left:-10000px;top:0;width:90mm;height:300mm;border:0';
  document.body.appendChild(marco);
  try {
    const doc = marco.contentDocument;
    if (!doc) throw new Error('No se pudo preparar el ticket.');
    doc.open();
    doc.write(html);
    doc.close();
    await prepararHoja(doc);

    const ticket = doc.getElementById('ticket');
    if (!ticket) throw new Error('No se pudo preparar el ticket.');
    const caja = ticket.getBoundingClientRect();
    // El ticket va a 1 mm de la orilla izquierda: se deja lo mismo a la derecha.
    const anchoPx = Math.ceil(caja.right + caja.left);
    const altoPx = Math.ceil(caja.bottom);

    // La copia que se dibuja: sin el respaldo del logo y con el logo DENTRO del texto
    // (un dibujo así no puede ir a traer imágenes).
    const copia = ticket.cloneNode(true) as HTMLElement;
    copia.querySelectorAll('template').forEach((t) => t.remove());
    const originales = Array.from(ticket.querySelectorAll('img'));
    Array.from(copia.querySelectorAll('img')).forEach((img, i) => {
      const datos = imagenEnTexto(originales[i]);
      if (datos) img.setAttribute('src', datos);
      else img.remove();
    });
    const estilos = Array.from(doc.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
    const escala = Math.min(ESCALA, ALTO_MAXIMO / Math.max(altoPx, 1));
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(anchoPx * escala)}" height="${Math.round(altoPx * escala)}" ` +
      `viewBox="0 0 ${anchoPx} ${altoPx}"><foreignObject x="0" y="0" width="${anchoPx}" height="${altoPx}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${anchoPx}px;height:${altoPx}px;margin:0;padding:0;background:#fff">` +
      `<style>${textoXml(estilos)}</style>${new XMLSerializer().serializeToString(copia)}</div></foreignObject></svg>`;

    const dibujo = await cargarImagen(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(anchoPx * escala);
    lienzo.height = Math.round(altoPx * escala);
    const ctx = lienzo.getContext('2d');
    if (!ctx) throw new Error('No se pudo preparar el PDF del ticket.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(dibujo, 0, 0, lienzo.width, lienzo.height);
    return { lienzo, anchoPx, altoPx };
  } finally {
    marco.remove();
  }
}

/** El PDF de una hoja del tamaño del ticket, con el dibujo en grises. */
export async function armarPdf(t: TicketDibujado, titulo: string): Promise<Blob> {
  const { lienzo } = t;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar el PDF del ticket.');
  const rgba = ctx.getImageData(0, 0, lienzo.width, lienzo.height).data;
  const gris = new Uint8Array(lienzo.width * lienzo.height);
  for (let i = 0, j = 0; j < gris.length; i += 4, j++) {
    gris[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114 + 500) / 1000;
  }
  const imagen = await comprimir(gris);

  // La hoja en puntos (72 por pulgada): un píxel de pantalla son 0.75 puntos.
  const ancho = (t.anchoPx * 0.75).toFixed(2);
  const alto = (t.altoPx * 0.75).toFixed(2);
  const dibujar = `q ${ancho} 0 0 ${alto} 0 0 cm /Im0 Do Q`;

  const partes: Uint8Array[] = [];
  const posiciones: number[] = [];
  let largo = 0;
  const poner = (p: string | Uint8Array) => {
    const bytes = typeof p === 'string' ? ascii(p) : p;
    partes.push(bytes);
    largo += bytes.length;
  };
  const objeto = (n: number, cuerpo: string) => {
    posiciones[n] = largo;
    poner(`${n} 0 obj\n${cuerpo}\nendobj\n`);
  };

  // El renglón de bytes altos le dice a quien lo abre que el archivo es binario.
  poner('%PDF-1.4\n');
  poner(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objeto(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objeto(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ancho} ${alto}] ` +
    '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
  posiciones[4] = largo;
  poner(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${lienzo.width} /Height ${lienzo.height} ` +
    `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${imagen.length} >>\nstream\n`);
  poner(imagen);
  poner('\nendstream\nendobj\n');
  objeto(5, `<< /Length ${dibujar.length} >>\nstream\n${dibujar}\nendstream`);
  objeto(6, `<< /Title ${textoPdf(titulo)} /Producer (Hitex) >>`);

  const xref = largo;
  poner(`xref\n0 7\n0000000000 65535 f \n${posiciones.slice(1).map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`);
  poner(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(partes as BlobPart[], { type: 'application/pdf' });
}

/** Comprime sin perder nada (zlib), que es lo que el PDF llama FlateDecode. */
async function comprimir(datos: Uint8Array): Promise<Uint8Array> {
  const flujo = new Blob([datos as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/** Una imagen ya cargada (el logo, de este mismo sitio) como texto "data:…"; null si no cargó. */
function imagenEnTexto(img: HTMLImageElement | undefined): string | null {
  if (!img || !img.naturalWidth) return null;
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')?.drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => mal(new Error('No se pudo dibujar el ticket para el PDF.'));
    img.src = src;
  });
}

/** Texto dentro de un documento XML: sin "<" ni "&" sueltos. */
function textoXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function ascii(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Un texto del PDF con acentos: en UTF-16, como lo pide el formato ("Devolución DEV-12"). */
function textoPdf(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}
