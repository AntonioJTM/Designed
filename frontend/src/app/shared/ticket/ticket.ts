import { Pedido, PedidoLinea } from '../../core/models/ventas.models';

/**
 * EL TICKET IMPRESO (2026-10-13: "tengo la impresora Kinwodon; que el corte lo
 * haga donde tiene que ser y no se pase de largo, y el ticket más bonito").
 *
 * Es para impresora TÉRMICA de 80 mm (la Kinwodon de corte automático): el área
 * que imprime mide 72 mm. Todo va en negro puro —la térmica no imprime grises,
 * los convierte en puntitos tenues— y con letra del sistema, que no hay que
 * cargar.
 *
 * El CORTE: la impresora corta donde termina la HOJA que le manda el navegador.
 * Sin decirle cuánto mide, usa el largo de su hoja por defecto y saca papel en
 * blanco antes de cortar. `imprimirTicket` mide el ticket ya dibujado y le pone
 * a la hoja (`@page`) ese largo exacto.
 */

export const ANCHO_PAPEL_MM = 80;
/** Lo que de verdad imprime una térmica de 80 mm. */
export const ANCHO_IMPRESO_MM = 72;

export interface DatosTienda {
  nombre: string;
  direccion?: string | null;
  telefono?: string | null;
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
  const cambio = Number(extras.cambio ?? 0);

  const kilos = lineas.reduce((s, d) => s + Number(d.cantidad), 0);
  const paquetes = lineas.reduce((s, d) => s + (d.bultos?.length ?? 0), 0);

  // Cómo se pagó: cada pago cobrado; el efectivo con lo recibido y el cambio.
  // Una nota pendiente de pago no lleva ni "pagado" ni "cambio".
  const pagos = notaPendiente ? '' : cobrado.map((g) => renglon(esc(g.metodo), esc(dineroTicket(g.monto)))).join('');
  const efectivo = cobrado.find((g) => /efectivo/i.test(g.metodo));
  const conCambio = !notaPendiente && efectivo && cambio > 0
    ? renglon('Recibido', esc(dineroTicket(Number(efectivo.monto) + cambio))) + renglon('Cambio', esc(dineroTicket(cambio)), 'fuerte')
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

  const contacto = [tienda.direccion, tienda.telefono ? `Tel. ${tienda.telefono}` : ''].filter(Boolean).map(esc).join('<br>');

  return `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><title>${esc(p.numero_pedido)}</title>
<style>
  @page { size: ${ANCHO_PAPEL_MM}mm 200mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: ${ANCHO_PAPEL_MM}mm; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.3;
    font-variant-numeric: tabular-nums; }
  .t { width: ${ANCHO_IMPRESO_MM}mm; margin: 0 auto; padding: 3mm 0 4mm; }
  .tienda { text-align: center; }
  .tienda h1 { margin: 0; font-size: 26px; font-weight: 900; letter-spacing: 0.06em; }
  .tienda p { margin: 2px 0 0; font-size: 11px; }
  .tipo { margin: 8px 0 6px; padding: 5px 0; background: #000; color: #fff; text-align: center; font-size: 15px; font-weight: 700;
    letter-spacing: 0.12em; text-transform: uppercase; }
  .r { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .r > span:last-child { text-align: right; white-space: nowrap; }
  .datos .r { font-size: 11px; padding: 1px 0; }
  .datos .r > span:first-child { font-weight: 700; }
  .datos .r > span:last-child { white-space: normal; }
  .mono { font-family: 'Courier New', monospace; font-weight: 700; }
  .corte { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .art { padding: 4px 0; }
  .art + .art { border-top: 1px dotted #000; }
  .art-nombre { font-weight: 700; font-size: 12.5px; }
  .art-extra { font-size: 10.5px; }
  .resumen { font-size: 11px; text-align: center; margin: 2px 0; }
  .total { display: flex; justify-content: space-between; align-items: baseline; border-top: 2px solid #000; border-bottom: 2px solid #000;
    padding: 5px 0; margin: 4px 0 6px; font-weight: 900; }
  .total span:first-child { font-size: 16px; letter-spacing: 0.08em; }
  .total span:last-child { font-size: 22px; }
  .fuerte { font-weight: 700; font-size: 13px; }
  .aviso { border: 1.5px solid #000; padding: 5px 6px; margin: 6px 0; font-size: 11.5px; font-weight: 700; text-align: center; }
  .gracias { text-align: center; margin-top: 10px; font-size: 13px; font-weight: 700; }
  .pie { text-align: center; font-size: 10px; margin-top: 2px; }
</style></head><body><div class="t" id="ticket">
  <div class="tienda">
    <h1>${esc(tienda.nombre.toUpperCase())}</h1>
    ${contacto ? `<p>${contacto}</p>` : ''}
  </div>
  <div class="tipo">${esc(tipo)}</div>
  <div class="datos">${datos}</div>
  <hr class="corte">
  ${lineas.map(lineaHtml).join('')}
  <hr class="corte">
  <div class="resumen">${esc(kg(kilos))}${paquetes ? ` · ${paquetes} ${paquetes === 1 ? 'paquete' : 'paquetes'}` : ''} · ${lineas.length} ${lineas.length === 1 ? 'artículo' : 'artículos'}</div>
  ${totales}
  <div class="total"><span>TOTAL</span><span>${esc(dineroTicket(total))}</span></div>
  ${pagos}${conCambio}
  ${saldo.join('')}
  <div class="gracias">¡Gracias por su compra!</div>
  <div class="pie">${esc(p.numero_pedido)}</div>
</div></body></html>`;
}

/** Milímetros de un largo en pixeles de pantalla (96 por pulgada). */
export function pxAMm(px: number): number {
  return (px * 25.4) / 96;
}

/**
 * Imprime el ticket en un marco aparte (sale solo el ticket, sin el menú) y le
 * pone a la hoja el LARGO del ticket, para que la impresora corte justo al
 * terminar y no saque papel en blanco.
 */
export function imprimirTicket(html: string): void {
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  marco.tabIndex = -1;
  // Fuera de la vista pero con el ancho del papel, para medir el largo de verdad.
  marco.style.cssText = `position:fixed;left:-10000px;top:0;width:${ANCHO_PAPEL_MM}mm;height:50mm;border:0`;
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

  const ticket = doc.getElementById('ticket');
  const largo = Math.ceil(pxAMm((ticket ?? doc.body).getBoundingClientRect().height)) + 2;
  const hoja = doc.createElement('style');
  hoja.textContent = `@page { size: ${ANCHO_PAPEL_MM}mm ${largo}mm; margin: 0; }`;
  doc.head.appendChild(hoja);

  ventana.focus();
  ventana.print();
  // El diálogo de impresión detiene el hilo hasta cerrarse; luego se quita el marco.
  setTimeout(() => marco.remove(), 1000);
}
