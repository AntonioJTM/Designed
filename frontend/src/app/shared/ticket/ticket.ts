import { DevolucionHecha, Pedido, PedidoLinea } from '../../core/models/ventas.models';
import { ClienteTicket, TicketAbonoCuenta, TicketAnticipo, TicketPagoNota } from '../../core/models/tickets.models';

/**
 * EL TICKET IMPRESO (2026-10-13: "tengo la impresora Kinwodon; que el corte lo
 * haga donde tiene que ser y no se pase de largo, y el ticket más bonito").
 *
 * Es para impresora TÉRMICA de 80 mm (la Kinwodon de corte automático): el área
 * que imprime mide 72 mm. Todo va en negro puro —la térmica no imprime grises,
 * los convierte en puntitos tenues— y con letra del sistema, que no hay que
 * cargar.
 *
 * EL PAPEL (2026-10-14, con la impresora de verdad): está instalada como
 * "POS-58", papel de 58 mm, y su hoja es un ROLLO de 58 × 3276 mm. Chrome NO
 * usa una hoja de otro tamaño en una impresora física: si el ticket pide una
 * (`@page { size }`), lo encoge y lo pone A LA MITAD de esa hoja de 3 m (se vio
 * así en la vista previa). Por eso el ticket NO pide tamaño: usa la hoja de la
 * impresora, empieza arriba, y el controlador de la térmica imprime hasta lo
 * último que tiene tinta y corta. Lo que sí pide es `margin: 0`: sin margen,
 * Chrome no puede poner su encabezado y su pie (la fecha y la dirección de la
 * página) —el pie iba al FINAL de los 3 m y obligaba a sacar todo ese papel—.
 * El ancho se elige en Configuración (`ticket_papel_mm`: 58 u 80).
 *
 * VA PEGADO A LA IZQUIERDA, NO CENTRADO (2026-10-14, con la SICAR WL88S: "así me
 * da el ticket; quiero que en cualquier impresora se vea bien"). Su controlador
 * le dice a Chrome que la hoja es ancha (la vista previa enseñaba el ticket
 * centrado en una hoja de unos 72 mm) pero la cabeza solo imprime unos 48 mm
 * desde la orilla izquierda: centrado, el ticket empezaba a ~13 mm y todo lo de
 * la derecha se cortaba (el logo, la razón social, los importes). Toda térmica
 * imprime desde la izquierda, así que pegado ahí (1 mm de orilla) cabe en
 * cualquiera mientras su ancho sea el que de verdad imprime. Para saber cuál
 * es, Configuración → Ticket imprime una PRUEBA con una regla (`armarPrueba`).
 *
 * EL DE 80 MM MIDE 60 MM (2026-10-14): una impresora de rollo de 80 mm imprime
 * 72 mm… o 64 mm, según el modelo o cómo esté configurada. La WL88S de la
 * tienda, ya en modo 80, cortó el de 70 y un carácter del de 62; se probó 58 y
 * 53, y el usuario pidió quedarse en 60 ("¿puedes hacerlo que sea de 60mm?").
 *
 * El ENCABEZADO (2026-10-14: "el ticket tiene que llevar la información de la
 * constancia fiscal y el logo"): el logo en NEGRO (`public/hitex-ticket.png`,
 * sacado del logo a color) y los datos fiscales —razón social, RFC, régimen y
 * domicilio— más la leyenda del pie. Viven en Configuración (claves `fiscal_*`
 * y `ticket_leyenda`), no en el código: el repositorio es público y así el
 * administrador los corrige sin tocar nada.
 */

/** Medidas por ancho de papel. */
export interface Papel {
  mm: 58 | 80;
  /**
   * Ancho del ticket. En 58: lo imprimible (48 mm) menos 1 mm por lado. En 80:
   * 60 mm, el que eligió el usuario para la WL88S de la tienda (ver arriba).
   */
  ticketMm: number;
  logoMm: number;
  /** Las letras se encogen en el papel angosto, para que quepan los importes. */
  escala: number;
}

export const PAPELES: Record<58 | 80, Papel> = {
  58: { mm: 58, ticketMm: 46, logoMm: 36, escala: 0.84 },
  80: { mm: 80, ticketMm: 60, logoMm: 44, escala: 0.84 },
};

/** "80" → el de 80 mm; cualquier otra cosa (o nada) → el de 58, el de la impresora de la tienda. */
export function papelDe(valor: unknown): Papel {
  return Number(valor) === 80 ? PAPELES[80] : PAPELES[58];
}

export interface DatosTienda {
  nombre: string;
  direccion?: string | null;
  telefono?: string | null;
  /** El logo en negro, con su dirección completa (el ticket se dibuja en un marco aparte). */
  logo?: string | null;
  razonSocial?: string | null;
  rfc?: string | null;
  regimen?: string | null;
  /** El domicilio fiscal; sin él, se usa la dirección de la tienda. */
  domicilio?: string | null;
  /** Lo que va al pie ("Este ticket no es un comprobante fiscal."). */
  leyenda?: string | null;
  /** El ancho del papel en mm (58 u 80). Sin dato, 58. */
  papelMm?: number | string | null;
}

/** Proporción del logo del ticket (alto ÷ ancho de `hitex-ticket.png`, 1009 × 588). */
export const LOGO_ANCHO_PX = 1009;
export const LOGO_ALTO_PX = 588;

/** "7786542453" → "778 654 2453"; lo demás, tal cual. */
export function telefonoLegible(t: string): string {
  const d = t.replace(/\D/g, '');
  return d.length === 10 && /^[\d\s()-]+$/.test(t) ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : t;
}

/** Lo que solo se sabe al cobrar y no se guarda: el cambio no es dinero de la tienda. */
export interface ExtrasTicket {
  cambio?: number;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
  'noviembre', 'diciembre'];

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function dineroTicket(v: unknown): string {
  return Number(v ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function kg(v: unknown): string {
  return `${Number(v ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`;
}

/** "13 de octubre de 2026, 21:40" (siempre con año: el ticket se guarda). */
export function fechaTicket(s: string | null | undefined): string {
  const [dia, hora] = String(s ?? '').replace('T', ' ').split(' ');
  const [a, m, d] = (dia ?? '').split('-').map(Number);
  if (!a || !m || !d) return '';
  return `${d} de ${MESES[m - 1]} de ${a}, ${(hora ?? '').slice(0, 5)}`;
}

/** "PERLA JASPE 2/30 · Paquete": el color solo no dice qué hilo es. */
export function hiloDeLinea(d: PedidoLinea): string {
  const hilo = `${d.producto || d.descripcion}${d.producto && d.calibre ? ' ' + d.calibre : ''}`;
  return d.producto && d.presentacion ? `${hilo} · ${d.presentacion}` : hilo;
}

/** La marca de una nota pendiente de pago (`pedidos.nota_pendiente`, 2026-10-13). */
const esNotaPendiente = (p: Pedido) => !!Number((p as Pedido & { nota_pendiente?: number | boolean }).nota_pendiente);

/**
 * Qué fue, en el encabezado del ticket; null si NO lleva ticket. Decir "Venta"
 * en un apartado sería mentir. Reglas del usuario (2026-10-13):
 *   · una NOTA EN ESPERA (pedido sin entregar) no sale como ticket: todavía se
 *     puede modificar. Al entregarse ya es una venta y sí lo lleva;
 *   · la NOTA PENDIENTE DE PAGO sí: se lleva la mercancía y paga después;
 *   · lo fiado dice "A crédito".
 */
export function tipoDeTicket(p: Pedido, fiado: number): string | null {
  if (p.encargo && Number(p.inventario_descontado) !== 1) return null;
  if (p.estado === 'cancelado') return 'Venta cancelada';
  if (p.estado === 'devuelto') return 'Devolución';
  if (p.estado === 'apartado' || Number(p.inventario_descontado) === 0) return 'Apartado';
  if (fiado > 0) return 'A crédito';
  if (esNotaPendiente(p)) return 'Nota pendiente de pago';
  return 'Venta';
}

const fiadoDe = (p: Pedido) =>
  (p.credito ?? []).filter((m) => m.tipo === 'cargo').reduce((s, m) => s + Number(m.monto), 0);

/** Si este pedido lleva ticket (una nota en espera no). */
export function llevaTicket(p: Pedido): boolean {
  return tipoDeTicket(p, fiadoDe(p)) !== null;
}

/** Qué dice el ticket de este pedido ("Venta", "A crédito", "Venta cancelada"…); null si no lleva. */
export function tipoTicket(p: Pedido): string | null {
  return tipoDeTicket(p, fiadoDe(p));
}

export const SIN_TICKET = 'Una nota en espera no lleva ticket: todavía se puede modificar. Sale al entregarla.';

const renglon = (izq: string, der: string, clase = '') =>
  `<div class="r${clase ? ' ' + clase : ''}"><span>${izq}</span><span>${der}</span></div>`;

function lineaHtml(d: PedidoLinea): string {
  const bultos = d.bultos ?? [];
  const detalle: string[] = [];
  if (bultos.length === 1) {
    detalle.push(`Paquete ${esc(bultos[0].codigo)}${bultos[0].lote ? ` · lote ${esc(bultos[0].lote)}` : ''}`);
  } else if (bultos.length > 1) {
    detalle.push(`${bultos.length} paquetes: ${bultos.map((b) => esc(b.codigo)).join(', ')}`);
  }
  if (Number(d.piezas) > 0) detalle.push(`${Number(d.piezas)} conos`);
  return `<div class="art">
    <div class="art-nombre">${esc(hiloDeLinea(d))}</div>
    ${renglon(`${esc(kg(d.cantidad))} × ${esc(dineroTicket(d.precio_unitario))}`, esc(dineroTicket(d.subtotal)))}
    ${detalle.length ? `<div class="art-extra">${detalle.join(' · ')}</div>` : ''}
  </div>`;
}

/** Quita el rótulo con que viene un dato copiado de la constancia ("REGIMEN: …"). */
function sinRotulo(valor: string | null | undefined, rotulo: RegExp): string {
  return String(valor ?? '').replace(rotulo, '').trim();
}

/**
 * El ticket completo, como documento HTML. Puro: no toca la pantalla, así se
 * puede probar y lo usan igual la caja y el detalle de la venta.
 */
export function armarTicket(p: Pedido, tienda: DatosTienda, extras: ExtrasTicket = {}): string {
  const lineas = p.detalle ?? [];
  const cobrado = (p.pagos ?? []).filter((g) => g.estado === 'completado');
  const pagado = cobrado.reduce((s, g) => s + Number(g.monto), 0);
  const fiado = fiadoDe(p);
  const total = Number(p.total);
  const tipo = tipoDeTicket(p, fiado);
  if (tipo === null) throw new Error(SIN_TICKET);
  const notaPendiente = tipo === 'Nota pendiente de pago';
  // El cambio: el que pasa la caja al cobrar o, al reimprimir, el que se guardó
  // con el pago en efectivo (desde el 2026-10-16: recibido − cobrado).
  const efectivoGuardado = cobrado.find((g) => /efectivo/i.test(g.metodo) && g.recibido != null);
  const cambio = extras.cambio != null
    ? Number(extras.cambio)
    : efectivoGuardado ? Math.max(0, Math.round((Number(efectivoGuardado.recibido) - Number(efectivoGuardado.monto)) * 100) / 100) : 0;

  const kilos = lineas.reduce((s, d) => s + Number(d.cantidad), 0);
  const paquetes = lineas.reduce((s, d) => s + (d.bultos?.length ?? 0), 0);

  // Cómo se pagó: cada pago cobrado; el efectivo con lo recibido y el cambio.
  // Una nota pendiente de pago no lleva ni "pagado" ni "cambio".
  // Lo pagado con su saldo a favor lo dice así, no con el nombre del método (2026-10-15).
  const nombrePago = (m: string) => (/saldo a favor/i.test(m) ? 'Pagó con su saldo a favor' : m);
  const pagos = notaPendiente ? '' : cobrado.map((g) => renglon(esc(nombrePago(g.metodo)), esc(dineroTicket(g.monto)))).join('');
  const efectivo = cobrado.find((g) => /efectivo/i.test(g.metodo));
  const conCambio = !notaPendiente && efectivo && cambio > 0
    ? renglon('Recibido', esc(dineroTicket(Number(efectivo.monto) + cambio))) + renglon('Cambio', esc(dineroTicket(cambio)), 'fuerte')
    : '';

  // Si pagó con su saldo a favor: cuánto le QUEDÓ (si aún le queda) y, en un
  // recuadro, cuánto tiene HOY. El recuadro va SIEMPRE, como en el de devolución
  // y el de anticipo (2026-10-16, el usuario eligió que todos se vean igual).
  const sf = notaPendiente ? null : p.saldo_favor_usado;
  const favor = sf
    ? (Number(sf.quedo) > 0.004 ? renglon('Le queda a favor', esc(dineroTicket(sf.quedo)), 'fuerte') : '') +
      `<div class="aviso">Su saldo a favor hoy<b>${esc(dineroTicket(sf.hoy))}</b></div>`
    : '';

  // Lo que queda pendiente, según qué fue.
  const saldo: string[] = [];
  if (tipo === 'A crédito') {
    saldo.push(renglon('Quedó a deber', esc(dineroTicket(fiado)), 'fuerte'));
    // Al reimprimirlo después: cómo va esa deuda hoy (los abonos se aplican a lo más antiguo).
    const debeHoy = p.credito_por_pagar;
    if (debeHoy != null && Number(debeHoy) < fiado - 0.004) {
      saldo.push(Number(debeHoy) <= 0.004
        ? '<div class="aviso">Ya se pagó con abonos</div>'
        : renglon('Hoy debe de esta venta', esc(dineroTicket(debeHoy))));
    }
  } else if (notaPendiente) {
    saldo.push(renglon('Pendiente de pago', esc(dineroTicket(Math.max(0, total - pagado))), 'fuerte'));
  } else if (tipo === 'Apartado') {
    const falta = Math.max(0, Math.round((total - pagado) * 100) / 100);
    const aFavor = Math.max(0, Math.round((pagado - total) * 100) / 100);
    if (aFavor > 0) saldo.push(renglon('A su favor', esc(dineroTicket(aFavor)), 'fuerte'));
    else saldo.push(renglon(falta > 0 ? 'Falta por pagar' : 'Pagado completo', falta > 0 ? esc(dineroTicket(falta)) : '✓', 'fuerte'));
  }

  const cliente = p.cliente_nombre_comercial && p.cliente && p.cliente_nombre_comercial !== p.cliente
    ? `${p.cliente_nombre_comercial} (${p.cliente})`
    : p.cliente_nombre_comercial || p.cliente || '';

  const datos = [
    renglon('Folio', `<span class="mono">${esc(p.numero_pedido)}</span>`),
    renglon('Fecha', esc(fechaTicket(p.creado_en))),
    p.caja ? renglon('Caja', esc(p.caja)) : p.almacen ? renglon('Tienda', esc(p.almacen)) : '',
    p.usuario ? renglon('Atendió', esc(p.usuario)) : '',
    cliente ? renglon('Cliente', esc(cliente)) : '',
  ].join('');

  const totales = [
    Number(p.descuento) > 0 || Number(p.impuestos) > 0 || Number(p.costo_envio) > 0
      ? renglon('Subtotal', esc(dineroTicket(p.subtotal))) : '',
    Number(p.descuento) > 0 ? renglon('Descuento', '-' + esc(dineroTicket(p.descuento))) : '',
    Number(p.impuestos) > 0 ? renglon('IVA', esc(dineroTicket(p.impuestos))) : '',
    Number(p.costo_envio) > 0 ? renglon('Envío', esc(dineroTicket(p.costo_envio))) : '',
  ].join('');

  return hojaTicket(p.numero_pedido, papelDe(tienda.papelMm), `
  ${cabeceraTienda(tienda)}
  <div class="tipo">${esc(tipo)}</div>
  <div class="datos">${datos}</div>
  <hr class="corte">
  ${lineas.map(lineaHtml).join('')}
  <hr class="corte">
  <div class="resumen">${esc(kg(kilos))}${paquetes ? ` · ${paquetes} ${paquetes === 1 ? 'paquete' : 'paquetes'}` : ''} · ${lineas.length} ${lineas.length === 1 ? 'artículo' : 'artículos'}</div>
  ${totales}
  <div class="total"><span>TOTAL</span><span>${esc(dineroTicket(total))}</span></div>
  ${pagos}${conCambio}
  ${favor}
  ${saldo.join('')}
  <div class="gracias">¡Gracias por su compra!</div>
  <div class="pie">${esc(p.numero_pedido)}</div>
  ${tienda.leyenda ? `<div class="leyenda">${esc(tienda.leyenda)}</div>` : ''}`);
}

/**
 * El logo (o el nombre en letras) y los datos fiscales: el mismo encabezado en
 * el ticket de venta y en el de devolución.
 */
function cabeceraTienda(tienda: DatosTienda): string {
  // Si se copió de la constancia con su rótulo ("REGIMEN: 601…", "RFC: …"), se
  // quita: el ticket ya pone el suyo y salía "Régimen: REGIMEN: 601…" (2026-10-14).
  // Solo con los dos puntos: "Régimen Simplificado de Confianza" es el nombre del
  // régimen, y un RFC puede empezar con las letras R-F-C.
  const rfc = sinRotulo(tienda.rfc, /^\s*r\.?\s*f\.?\s*c\.?\s*:\s*/i);
  const regimen = sinRotulo(tienda.regimen, /^\s*r[eé]gimen(\s+fiscal)?\s*:\s*/i);
  const fiscal = [
    tienda.razonSocial ? `<p class="razon">${esc(tienda.razonSocial)}</p>` : '',
    rfc ? `<p>RFC: <b>${esc(rfc)}</b></p>` : '',
    regimen ? `<p>Régimen: ${esc(regimen)}</p>` : '',
    tienda.domicilio || tienda.direccion ? `<p>${esc(tienda.domicilio || tienda.direccion)}</p>` : '',
    tienda.telefono ? `<p>Tel. ${esc(telefonoLegible(tienda.telefono))}</p>` : '',
  ].join('');
  // Sin logo (o si no carga: ver imprimirTicket) va el nombre en letras.
  const nombre = `<h1>${esc(tienda.nombre.toUpperCase())}</h1>`;
  const encabezado = tienda.logo
    ? `<img class="logo" src="${esc(tienda.logo)}" width="${LOGO_ANCHO_PX}" height="${LOGO_ALTO_PX}" alt="${esc(tienda.nombre)}">` +
      `<template id="sin-logo">${nombre}</template>`
    : nombre;
  return `<div class="tienda">
    ${encabezado}
    ${fiscal}
  </div>`;
}

/** La hoja del ticket: las medidas del papel, en negro puro, pegada a la izquierda. */
function hojaTicket(titulo: string, papel: Papel, cuerpo: string): string {
  const px = (n: number) => `${Math.round(n * papel.escala * 10) / 10}px`;
  return `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  /* También en .t: el PDF para WhatsApp dibuja solo el ticket, sin su body (ticket-pdf.ts). */
  body, .t { color: #000; font-family: Arial, Helvetica, sans-serif; font-size: ${px(12)}; line-height: 1.3;
    font-variant-numeric: tabular-nums; }
  .t { width: ${papel.ticketMm}mm; margin: 0 0 0 1mm; padding: 2mm 0 3mm; }
  .tienda { text-align: center; }
  .tienda h1 { margin: 0; font-size: ${px(26)}; font-weight: 900; letter-spacing: 0.06em; }
  .tienda .logo { display: block; width: ${papel.logoMm}mm; height: auto; margin: 0 auto 2mm; }
  .tienda p { margin: ${px(1)} 0 0; font-size: ${px(10.5)}; line-height: 1.3; }
  .tienda .razon { font-size: ${px(11.5)}; font-weight: 700; margin-top: 0; }
  .tipo { margin: ${px(8)} 0 ${px(6)}; padding: ${px(5)} 0; background: #000; color: #fff; text-align: center; font-size: ${px(15)}; font-weight: 700;
    letter-spacing: 0.12em; text-transform: uppercase; }
  .r { display: flex; justify-content: space-between; align-items: baseline; gap: ${px(8)}; }
  .r > span:last-child { text-align: right; white-space: nowrap; }
  .datos .r { font-size: ${px(11)}; padding: ${px(1)} 0; }
  .datos .r > span:first-child { font-weight: 700; }
  .datos .r > span:last-child { white-space: normal; }
  .mono { font-family: 'Courier New', monospace; font-weight: 700; }
  .corte { border: 0; border-top: 1px dashed #000; margin: ${px(6)} 0; }
  .art { padding: ${px(4)} 0; }
  .art + .art { border-top: 1px dotted #000; }
  .art-nombre { font-weight: 700; font-size: ${px(12.5)}; }
  .art-extra { font-size: ${px(10.5)}; }
  .resumen { font-size: ${px(11)}; text-align: center; margin: ${px(2)} 0; }
  .total { display: flex; justify-content: space-between; align-items: baseline; border-top: 2px solid #000; border-bottom: 2px solid #000;
    padding: ${px(5)} 0; margin: ${px(4)} 0 ${px(6)}; font-weight: 900; }
  .total span:first-child { font-size: ${px(16)}; letter-spacing: 0.08em; }
  .total span:last-child { font-size: ${px(22)}; }
  .fuerte { font-weight: 700; font-size: ${px(13)}; }
  .aviso { border: 1.5px solid #000; padding: ${px(5)} ${px(6)}; margin: ${px(6)} 0; font-size: ${px(11.5)}; font-weight: 700; text-align: center; }
  .aviso b { display: block; font-size: ${px(18)}; font-weight: 900; margin-top: ${px(2)}; }
  .nota { font-size: ${px(10.5)}; text-align: center; margin: ${px(4)} 0; }
  .gracias { text-align: center; margin-top: ${px(10)}; font-size: ${px(13)}; font-weight: 700; }
  .pie { text-align: center; font-size: ${px(10)}; margin-top: ${px(2)}; }
  .leyenda { text-align: center; font-size: ${px(10)}; margin-top: ${px(6)}; padding-top: ${px(4)}; border-top: 1px dashed #000; }
</style></head><body><div class="t" id="ticket">${cuerpo}
</div></body></html>`;
}

/** Cómo regresó una línea, en palabras de la tienda. */
function comoRegreso(l: DevolucionHecha['lineas'][number]): string {
  if (l.codigos.length === 1) return `Paquete cerrado ${esc(l.codigos[0])}`;
  if (l.codigos.length > 1) return `${l.codigos.length} paquetes cerrados: ${l.codigos.map(esc).join(', ')}`;
  if (l.como === 'cono') return l.piezas ? `${l.piezas} ${l.piezas === 1 ? 'cono suelto' : 'conos sueltos'}` : 'Conos sueltos';
  return 'Suelto, pesado en la báscula';
}

/**
 * EL TICKET DE DEVOLUCIÓN (2026-10-15: "cuando se realice una devolución, que el
 * ticket salga como devolución y cuánto tiene a favor; no elimines el de venta").
 * Uno por devolución (cada una tiene su folio DEV-…): qué regresó, cuánto vale
 * —al precio con que se vendió—, cuánto se descontó de lo que debía, cuánto le
 * quedó a favor y su saldo a favor de hoy. Dice que no salió dinero de la caja.
 * El de la venta sigue saliendo igual, con su botón.
 */
export function armarTicketDevolucion(p: Pedido, d: DevolucionHecha, tienda: DatosTienda): string {
  const lineas = d.lineas ?? [];
  const total = Number(d.total);
  const aplicado = Number(d.aplicado_a_deuda ?? 0);
  const aFavor = Math.max(0, Math.round((total - aplicado) * 100) / 100);
  const kilos = lineas.reduce((s, l) => s + Number(l.kg), 0);
  const paquetes = lineas.reduce((s, l) => s + l.codigos.length, 0);
  const cliente = d.nombre_comercial && d.cliente && d.nombre_comercial !== d.cliente
    ? `${d.nombre_comercial} (${d.cliente})`
    : d.nombre_comercial || d.cliente || '';

  const datos = [
    renglon('Folio', `<span class="mono">${esc(d.folio)}</span>`),
    renglon('Fecha', esc(fechaTicket(d.creado_en))),
    renglon('De la venta', `<span class="mono">${esc(p.numero_pedido)}</span>`),
    renglon('Vendida', esc(fechaTicket(p.creado_en))),
    p.almacen ? renglon('Regresó a', esc(p.almacen)) : '',
    d.usuario ? renglon('La recibió', esc(d.usuario)) : '',
    cliente ? renglon('Cliente', esc(cliente)) : '',
  ].join('');

  const articulos = lineas.map((l) => {
    const precio = Number(l.kg) > 0 ? Number(l.importe) / Number(l.kg) : 0;
    return `<div class="art">
    <div class="art-nombre">${esc(l.hilo)}</div>
    ${renglon(`${esc(kg(l.kg))} × ${esc(dineroTicket(precio))}`, esc(dineroTicket(l.importe)))}
    <div class="art-extra">${comoRegreso(l)}</div>
  </div>`;
  }).join('');

  const destino = [
    aplicado > 0 ? renglon('Se descontó de lo que debía', esc(dineroTicket(aplicado))) : '',
    renglon('Le quedó a favor', esc(dineroTicket(aFavor)), 'fuerte'),
  ].join('');
  const saldoHoy = d.saldo_favor_hoy;
  const saldo = saldoHoy != null
    ? `<div class="aviso">Su saldo a favor hoy<b>${esc(dineroTicket(saldoHoy))}</b></div>`
    : '';

  return hojaTicket(d.folio, papelDe(tienda.papelMm), `
  ${cabeceraTienda(tienda)}
  <div class="tipo">Devolución</div>
  <div class="datos">${datos}</div>
  <hr class="corte">
  ${articulos}
  <hr class="corte">
  <div class="resumen">${esc(kg(kilos))}${paquetes ? ` · ${paquetes} ${paquetes === 1 ? 'paquete' : 'paquetes'}` : ''} · ${lineas.length} ${lineas.length === 1 ? 'artículo' : 'artículos'}</div>
  <div class="total"><span>REGRESÓ</span><span>${esc(dineroTicket(total))}</span></div>
  ${destino}
  ${saldo}
  ${d.notas ? `<div class="nota">Nota: ${esc(d.notas)}</div>` : ''}
  <div class="nota">No se entregó dinero: el saldo a favor se usa en sus próximas compras.</div>
  <div class="pie">${esc(d.folio)}</div>
  ${tienda.leyenda ? `<div class="leyenda">${esc(tienda.leyenda)}</div>` : ''}`);
}

/** "Doña Chela (Graciela Ruiz)" y su número, como en el de la venta. */
function datosCliente(c: ClienteTicket | null | undefined): string {
  if (!c) return '';
  const nombre = c.nombre_comercial && c.nombre !== c.nombre_comercial ? `${c.nombre_comercial} (${c.nombre})` : c.nombre;
  return renglon('Cliente', esc(nombre)) + (c.codigo ? renglon('Número', `<span class="mono">${esc(c.codigo)}</span>`) : '');
}

/** El método con su referencia ("Transferencia · folio 12345"). */
function metodoHtml(metodo: string | null | undefined, monto: number, referencia?: string | null): string {
  return renglon(esc(metodo || 'Pago'), esc(dineroTicket(monto))) +
    (referencia ? `<div class="art-extra">Referencia: ${esc(referencia)}</div>` : '');
}

/**
 * EL TICKET DE UN ABONO A SU CUENTA (2026-10-15: "tickets de abono"): cuánto
 * debía, cuánto abonó y con qué, cuánto quedó debiendo y qué ventas fiadas
 * quedaron pagadas con él. Al reimprimirlo después, también cuánto debe hoy.
 * Si fue A NOTAS (2026-10-19), cada nota con lo que se le abonó y lo que le falta.
 */
export function armarTicketAbonoCuenta(d: TicketAbonoCuenta, tienda: DatosTienda): string {
  const folio = `AB-${d.id}`;
  const datos = [
    renglon('Folio', `<span class="mono">${esc(folio)}</span>`),
    renglon('Fecha', esc(fechaTicket(d.fecha))),
    datosCliente(d.cliente),
    d.caja ? renglon('Caja', esc(d.caja)) : '',
    d.usuario ? renglon('Lo recibió', esc(d.usuario)) : '',
  ].join('');
  const alCorriente = d.quedo_debiendo <= 0.004;
  const otras = d.liquidadas_otra_tienda ?? 0;
  const deOtra = otras ? (otras === 1 ? '1 nota de otra tienda' : `${otras} notas de otra tienda`) : '';
  const liquidadas = d.liquidadas.length
    ? `<div class="nota">Con este abono ${d.liquidadas.length + otras === 1 ? 'quedó pagada la nota' : 'quedaron pagadas las notas'}:` +
      `<br><span class="mono">${d.liquidadas.map(esc).join('<br>')}</span>${deOtra ? `<br>y ${deOtra}` : ''}</div>`
    : deOtra ? `<div class="nota">Con este abono quedó pagada ${deOtra}.</div>` : '';
  const hoy = Math.abs(d.debe_hoy - d.quedo_debiendo) > 0.004 ? renglon('Hoy debe', esc(dineroTicket(d.debe_hoy))) : '';
  // A NOTAS (2026-10-19): a cuál fue cada parte y cuánto le quedó faltando.
  const aNotas = d.a_notas?.length
    ? d.a_notas.map((n) =>
      renglon(`<span class="mono">${esc(n.numero_pedido)}</span>`, esc(dineroTicket(n.monto))) +
      `<div class="nota">${n.le_falta <= 0.004 ? 'Nota pagada completa' : `Le falta ${esc(dineroTicket(n.le_falta))}`}</div>`
    ).join('')
    : '';
  return hojaTicket(folio, papelDe(tienda.papelMm), `
  ${cabeceraTienda(tienda)}
  <div class="tipo">Abono</div>
  <div class="datos">${datos}</div>
  <hr class="corte">
  <div class="resumen">${aNotas ? (d.a_notas!.length === 1 ? 'A la nota' : 'A las notas') : 'A su cuenta'}</div>
  ${aNotas}
  ${renglon('Debía', esc(dineroTicket(d.debia)))}
  <div class="total"><span>ABONÓ</span><span>${esc(dineroTicket(d.monto))}</span></div>
  ${metodoHtml(d.metodo, d.monto, d.referencia)}
  ${alCorriente
    ? '<div class="aviso">Quedó al corriente: ya no debe nada</div>'
    : `<div class="aviso">Quedó debiendo<b>${esc(dineroTicket(d.quedo_debiendo))}</b></div>`}
  ${hoy}
  ${liquidadas}
  ${d.notas ? `<div class="nota">Nota: ${esc(d.notas)}</div>` : ''}
  <div class="gracias">¡Gracias por su pago!</div>
  <div class="pie">${esc(folio)}</div>
  ${tienda.leyenda ? `<div class="leyenda">${esc(tienda.leyenda)}</div>` : ''}`);
}

/**
 * EL TICKET DE UN ANTICIPO (2026-10-15): lo que dejó a cuenta —efectivo y/o
 * transferencia—, cuánto tenía a favor, con cuánto quedó y, SIEMPRE en su
 * recuadro, su saldo a favor de hoy (2026-10-16: todos los tickets de saldo a
 * favor iguales). Dice que se usa en sus próximas compras y que no aparta mercancía.
 */
export function armarTicketAnticipo(d: TicketAnticipo, tienda: DatosTienda): string {
  const folio = `AN-${d.id}`;
  const datos = [
    renglon('Folio', `<span class="mono">${esc(folio)}</span>`),
    renglon('Fecha', esc(fechaTicket(d.fecha))),
    datosCliente(d.cliente),
    d.caja ? renglon('Caja', esc(d.caja)) : '',
    d.usuario ? renglon('Lo recibió', esc(d.usuario)) : '',
  ].join('');
  return hojaTicket(folio, papelDe(tienda.papelMm), `
  ${cabeceraTienda(tienda)}
  <div class="tipo">Anticipo</div>
  <div class="datos">${datos}</div>
  <hr class="corte">
  ${d.partes.map((p) => metodoHtml(p.metodo, p.monto, p.referencia)).join('')}
  <div class="total"><span>A CUENTA</span><span>${esc(dineroTicket(d.total))}</span></div>
  ${d.tenia_a_favor > 0.004 ? renglon('Ya tenía a favor', esc(dineroTicket(d.tenia_a_favor))) : ''}
  ${renglon('Le quedó a favor', esc(dineroTicket(d.quedo_a_favor)), 'fuerte')}
  <div class="aviso">Su saldo a favor hoy<b>${esc(dineroTicket(d.a_favor_hoy))}</b></div>
  ${d.notas ? `<div class="nota">Nota: ${esc(d.notas)}</div>` : ''}
  <div class="nota">Se usa en sus próximas compras. No aparta mercancía.</div>
  <div class="gracias">¡Gracias!</div>
  <div class="pie">${esc(folio)}</div>
  ${tienda.leyenda ? `<div class="leyenda">${esc(tienda.leyenda)}</div>` : ''}`);
}

/**
 * EL TICKET DE UN ABONO A UNA NOTA (2026-10-15): de qué nota —pendiente de pago,
 * en espera o apartado—, cuánto llevaba pagado, cuánto abonó y con qué, y cuánto
 * le falta. Si con él se pagó completa, lo dice.
 */
export function armarTicketPagoNota(d: TicketPagoNota, tienda: DatosTienda): string {
  const folio = `PG-${d.id}`;
  const datos = [
    renglon('Folio', `<span class="mono">${esc(folio)}</span>`),
    renglon('Fecha', esc(fechaTicket(d.fecha))),
    datosCliente(d.cliente),
    d.pedido.almacen ? renglon('Tienda', esc(d.pedido.almacen)) : '',
  ].join('');
  const pagada = d.falta <= 0.004;
  const hoy = Math.abs(d.falta_hoy - d.falta) > 0.004 ? renglon('Hoy le falta', esc(dineroTicket(d.falta_hoy))) : '';
  return hojaTicket(folio, papelDe(tienda.papelMm), `
  ${cabeceraTienda(tienda)}
  <div class="tipo">Abono</div>
  <div class="datos">${datos}</div>
  <hr class="corte">
  ${renglon('A la nota', `<span class="mono">${esc(d.pedido.numero_pedido)}</span>`)}
  <div class="art-extra">${esc(d.pedido.de)} · del ${esc(fechaTicket(d.pedido.creado_en))}</div>
  ${renglon('Total de la nota', esc(dineroTicket(d.pedido.total)))}
  ${d.llevaba_pagado > 0.004 ? renglon('Llevaba pagado', esc(dineroTicket(d.llevaba_pagado))) : ''}
  <div class="total"><span>ABONÓ</span><span>${esc(dineroTicket(d.monto))}</span></div>
  ${metodoHtml(d.metodo, d.monto, d.referencia)}
  ${pagada
    ? '<div class="aviso">Nota pagada completa</div>'
    : `<div class="aviso">Le falta por pagar<b>${esc(dineroTicket(d.falta))}</b></div>`}
  ${hoy}
  <div class="gracias">¡Gracias por su pago!</div>
  <div class="pie">${esc(folio)}</div>
  ${tienda.leyenda ? `<div class="leyenda">${esc(tienda.leyenda)}</div>` : ''}`);
}

/**
 * LA HOJA DE PRUEBA de Configuración → Ticket (2026-10-14): una REGLA en
 * milímetros desde la orilla izquierda y un recuadro del ancho del ticket. Así
 * se ve en CUALQUIER impresora hasta dónde imprime de verdad (su controlador
 * puede decir otra cosa) y si conviene 58 u 80 mm. Va pegada a la izquierda,
 * como el ticket.
 */
export function armarPrueba(papelMm: unknown): string {
  const papel = papelDe(papelMm);
  const marcas: string[] = [];
  for (let mm = 0; mm <= 80; mm += 5) {
    const larga = mm % 10 === 0;
    marcas.push(`<i style="left:${mm}mm;height:${larga ? 5 : 3}mm"></i>`);
    if (larga && mm > 0) marcas.push(`<b style="left:${mm - 2.5}mm">${mm}</b>`);
  }
  return `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><title>Prueba de impresión</title>
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
  .p { margin: 0 0 0 1mm; padding: 2mm 0 4mm; width: ${papel.ticketMm}mm; font-size: 3.2mm; line-height: 1.35; }
  h1 { margin: 0 0 2mm; font-size: 4.2mm; font-weight: 900; }
  .regla { position: relative; height: 10mm; width: 80mm; margin: 2mm 0 3mm -1mm; border-top: 0.4mm solid #000; }
  .regla i { position: absolute; top: 0; width: 0.4mm; background: #000; }
  .regla b { position: absolute; top: 5.5mm; width: 5mm; text-align: center; font-size: 2.8mm; }
  .caja { border: 0.5mm solid #000; padding: 2mm; margin: 3mm 0; text-align: center; font-weight: 700; }
  ul { margin: 1mm 0 0; padding-left: 4mm; }
</style></head><body><div class="p">
  <h1>PRUEBA DE IMPRESIÓN</h1>
  <div>Ancho elegido: <b>${papel.mm} mm</b></div>
  <div class="regla">${marcas.join('')}</div>
  <div>La regla se corta donde tu impresora deja de imprimir: eso es lo que mide. ¿En qué número se corta?</div>
  <ul>
    <li>Antes de 60: deja <b>58 mm</b>.</li>
    <li>En 60 o más: elige <b>80 mm</b>.</li>
  </ul>
  <div class="caja">Este recuadro mide lo que el ticket. Si sale completo, con sus dos orillas, el ticket cabe.</div>
</div></body></html>`;
}

/** Espera a que carguen las imágenes del ticket (el logo), sin quedarse colgado. */
function imagenesListas(doc: Document, maxMs = 4000): Promise<void> {
  const pendientes = Array.from(doc.images).filter((img) => !img.complete);
  if (!pendientes.length) return Promise.resolve();
  const cargas = pendientes.map((img) => new Promise<void>((ok) => {
    img.addEventListener('load', () => ok(), { once: true });
    img.addEventListener('error', () => ok(), { once: true });
  }));
  return Promise.race([Promise.all(cargas).then(() => undefined), new Promise<void>((ok) => setTimeout(ok, maxMs))]);
}

/**
 * Deja la hoja lista para imprimir: espera al logo (si no, la impresora lo
 * recibe en blanco) y, si no cargó, pone el nombre en letras.
 */
export async function prepararHoja(doc: Document): Promise<void> {
  await imagenesListas(doc);
  const logo = doc.querySelector<HTMLImageElement>('img.logo');
  if (logo && !logo.naturalWidth) {
    const respaldo = doc.querySelector<HTMLTemplateElement>('#sin-logo');
    logo.replaceWith(respaldo ? respaldo.content.cloneNode(true) : doc.createTextNode(''));
  }
}

/**
 * Imprime el ticket en un marco aparte: sale solo el ticket, sin el menú. Antes
 * espera al LOGO (ver `prepararHoja`). El papel lo pone la impresora (ver arriba).
 */
export async function imprimirTicket(html: string): Promise<void> {
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  marco.tabIndex = -1;
  // Fuera de la vista: lo que se imprime es su documento, no el marco.
  marco.style.cssText = 'position:fixed;left:-10000px;top:0;width:80mm;height:50mm;border:0';
  document.body.appendChild(marco);
  const doc = marco.contentDocument;
  const ventana = marco.contentWindow;
  if (!doc || !ventana) {
    marco.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  await prepararHoja(doc);

  ventana.focus();
  ventana.print();
  // El diálogo de impresión detiene el hilo hasta cerrarse; luego se quita el marco.
  setTimeout(() => marco.remove(), 1000);
}
