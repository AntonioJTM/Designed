import { Injectable, Injector, inject } from '@angular/core';
import { Observable, catchError, defer, forkJoin, from, map, of, shareReplay, switchMap } from 'rxjs';
import { DevolucionHecha, Pedido } from '../models/ventas.models';
import { TicketAbonoCuenta, TicketAnticipo, TicketPagoNota } from '../models/tickets.models';
import { VentasService } from './ventas.service';
import { TiendaService } from './tienda.service';
import { ClientesService } from './clientes.service';
import { PaqueteWhatsapp, WhatsappService } from './whatsapp.service';
import {
  DatosTienda, ExtrasTicket, armarTicket, armarTicketAbonoCuenta, armarTicketAnticipo, armarTicketDevolucion,
  armarTicketPagoNota, dineroTicket, imprimirTicket, tipoTicket,
} from '../../shared/ticket/ticket';
import { ticketEnPdf } from '../../shared/ticket/ticket-pdf';
import { mensajeWhatsapp } from '../../shared/ticket/whatsapp';
import { folioCorto } from '../../shared/folio.pipe';
import { nombreArchivo } from '../../shared/descargar';

/**
 * Imprime el ticket de una venta, el mismo desde la caja y desde el detalle.
 * Los datos fiscales, la dirección, el teléfono y la leyenda salen de
 * Configuración; lo que no esté capturado no sale. El logo es el de
 * `public/hitex-ticket.png` (en negro, para la térmica).
 *
 * Y lo MANDA POR WHATSAPP (2026-10-16): el mismo ticket, en PDF, con el
 * teléfono del cliente y un mensaje corto (ver `WhatsappService`). Cada ticket
 * se arma una sola vez (`hoja…`) y de ahí sale lo que se imprime o se manda.
 */
/** Lo que sale aunque Configuración no conteste: el nombre y el logo. */
const BASE: DatosTienda = {
  nombre: 'Hitex',
  // Completa: el ticket se dibuja en un marco aparte y la imprime la caja o el detalle.
  logo: typeof document !== 'undefined' ? new URL('hitex-ticket.png', document.baseURI).href : null,
};

/** Un ticket armado: su documento y con qué se manda por WhatsApp. */
interface Hoja {
  html: string;
  /** "Ticket de venta POS-468D" */
  titulo: string;
  archivo: string;
  mensaje: string;
  cliente: string | null;
  telefono: string | null;
  /** Para guardarle el número que se escriba (ver `PaqueteWhatsapp`). */
  clienteId: number | null;
  telefonoPrincipal: string | null;
  telefonoAlt: string | null;
}

/** Qué es cada ticket de venta, dicho para el mensaje ("su ticket de venta"). */
const FRASES: Record<string, { titulo: string; que: string; gracias: boolean }> = {
  'Venta': { titulo: 'Ticket de venta', que: 'su ticket de venta', gracias: true },
  'A crédito': { titulo: 'Ticket de venta a crédito', que: 'su ticket de venta a crédito', gracias: true },
  'Nota pendiente de pago': { titulo: 'Nota pendiente de pago', que: 'su nota pendiente de pago', gracias: true },
  'Apartado': { titulo: 'Ticket de apartado', que: 'su ticket de apartado', gracias: true },
  'Venta cancelada': { titulo: 'Ticket de venta cancelada', que: 'el ticket de su venta cancelada', gracias: false },
  'Devolución': { titulo: 'Ticket de devolución', que: 'el ticket de su devolución', gracias: false },
};

const telefonoDe = (t?: string | null, alt?: string | null) => (t?.trim() || alt?.trim() || null);

@Injectable({ providedIn: 'root' })
export class TicketService {
  // Los servicios se buscan al imprimir, no al crear este: la caja y el detalle
  // lo inyectan siempre, y así no arrastran la conexión al servidor por nada.
  private readonly injector = inject(Injector);

  private readonly datos$: Observable<DatosTienda> = defer(() => this.injector.get(TiendaService).configuracion()).pipe(
    map((c): DatosTienda => ({
      ...BASE,
      direccion: c.tienda_direccion,
      telefono: c.tienda_telefono,
      razonSocial: c.fiscal_razon_social,
      rfc: c.fiscal_rfc,
      regimen: c.fiscal_regimen,
      domicilio: c.fiscal_domicilio,
      leyenda: c.ticket_leyenda,
      papelMm: c.ticket_papel_mm,
    })),
    catchError(() => of(BASE)),
    shareReplay(1)
  );

  // ---------------------------------------------------------------- imprimir

  /** Con la venta ya cargada (el detalle). */
  imprimirPedido(p: Pedido, extras?: ExtrasTicket): Observable<void> {
    return this.imprimirHoja(this.datos$.pipe(map((t) => this.hojaPedido(p, t, extras))));
  }

  /** El ticket de UNA devolución de esa venta (el de la venta sigue con `imprimirPedido`). */
  imprimirDevolucion(p: Pedido, d: DevolucionHecha): Observable<void> {
    return this.imprimirHoja(this.datos$.pipe(map((t) => this.hojaDevolucion(p, d, t))));
  }

  /**
   * Los tickets de la cuenta del cliente (2026-10-15): se piden al servidor con
   * el movimiento recién registrado —o uno viejo, para reimprimirlo— y salen
   * igual las dos veces.
   */
  imprimirAbonoCuenta(clienteId: number, movimientoId: number): Observable<void> {
    return this.imprimirHoja(this.abono$(clienteId, movimientoId));
  }

  imprimirAnticipo(clienteId: number, movimientoId: number): Observable<void> {
    return this.imprimirHoja(this.anticipo$(clienteId, movimientoId));
  }

  /** Un abono a una nota (pendiente de pago, en espera o apartado): uno de sus pagos. */
  imprimirPagoNota(pedidoId: number, pagoId: number): Observable<void> {
    return this.imprimirHoja(this.pagoNota$(pedidoId, pagoId));
  }

  /** Recién cobrada (la caja): se pide completa, con sus artículos y pagos. */
  imprimir(pedidoId: number, extras?: ExtrasTicket): Observable<void> {
    return this.imprimirHoja(this.pedido$(pedidoId, extras));
  }

  // ---------------------------------------------------------------- WhatsApp

  /** Manda por WhatsApp el ticket de la venta ya cargada (el detalle). */
  whatsappPedido(p: Pedido): void {
    this.mandar(`Ticket ${folioCorto(p.numero_pedido)}`, this.datos$.pipe(map((t) => this.hojaPedido(p, t))));
  }

  /** La recién cobrada (la caja), con el cambio que no se guarda. */
  whatsapp(pedidoId: number, extras?: ExtrasTicket): void {
    this.mandar('Ticket de la venta', this.pedido$(pedidoId, extras));
  }

  whatsappDevolucion(p: Pedido, d: DevolucionHecha): void {
    this.mandar(`Ticket de devolución ${folioCorto(d.folio)}`, this.datos$.pipe(map((t) => this.hojaDevolucion(p, d, t))));
  }

  whatsappAbonoCuenta(clienteId: number, movimientoId: number): void {
    this.mandar('Ticket del abono', this.abono$(clienteId, movimientoId));
  }

  whatsappAnticipo(clienteId: number, movimientoId: number): void {
    this.mandar('Ticket del anticipo', this.anticipo$(clienteId, movimientoId));
  }

  whatsappPagoNota(pedidoId: number, pagoId: number): void {
    this.mandar('Ticket del abono', this.pagoNota$(pedidoId, pagoId));
  }

  // ---------------------------------------------------------------- las hojas

  private pedido$(pedidoId: number, extras?: ExtrasTicket): Observable<Hoja> {
    return forkJoin([this.injector.get(VentasService).obtenerPedido(pedidoId), this.datos$]).pipe(
      map(([p, t]) => this.hojaPedido(p, t, extras))
    );
  }

  private abono$(clienteId: number, movimientoId: number): Observable<Hoja> {
    return forkJoin([this.injector.get(ClientesService).ticketAbono(clienteId, movimientoId), this.datos$]).pipe(
      map(([d, t]) => this.hojaAbono(d, t))
    );
  }

  private anticipo$(clienteId: number, movimientoId: number): Observable<Hoja> {
    return forkJoin([this.injector.get(ClientesService).ticketAnticipo(clienteId, movimientoId), this.datos$]).pipe(
      map(([d, t]) => this.hojaAnticipo(d, t))
    );
  }

  private pagoNota$(pedidoId: number, pagoId: number): Observable<Hoja> {
    return forkJoin([this.injector.get(VentasService).ticketPago(pedidoId, pagoId), this.datos$]).pipe(
      map(([d, t]) => this.hojaPagoNota(d, t))
    );
  }

  private hojaPedido(p: Pedido, t: DatosTienda, extras?: ExtrasTicket): Hoja {
    // `armarTicket` rechaza la nota en espera (todavía no lleva ticket).
    const html = armarTicket(p, t, extras);
    const folio = folioCorto(p.numero_pedido);
    const f = FRASES[tipoTicket(p) ?? 'Venta'] ?? FRASES['Venta'];
    const porCuanto = f.gracias ? ` por ${dineroTicket(p.total)}` : '';
    return {
      html,
      titulo: `${f.titulo} ${folio}`,
      archivo: nombreArchivo(`${f.titulo} ${folio}.pdf`),
      mensaje: mensajeWhatsapp(p.cliente, `${f.que} ${folio}${porCuanto}`, t.nombre, f.gracias),
      cliente: p.cliente ?? null,
      telefono: telefonoDe(p.cliente_telefono, p.cliente_telefono_alt),
      clienteId: p.cliente_id ?? null,
      telefonoPrincipal: p.cliente_telefono ?? null,
      telefonoAlt: p.cliente_telefono_alt ?? null,
    };
  }

  private hojaDevolucion(p: Pedido, d: DevolucionHecha, t: DatosTienda): Hoja {
    const cliente = d.cliente ?? p.cliente ?? null;
    // El folio corto ("DEV-B23B"), como en las listas: el completo va en el ticket.
    const folio = folioCorto(d.folio);
    return {
      html: armarTicketDevolucion(p, d, t),
      titulo: `Ticket de devolución ${folio}`,
      archivo: nombreArchivo(`Devolución ${folio}.pdf`),
      mensaje: mensajeWhatsapp(cliente, `el ticket de su devolución ${folio} (de su compra ${folioCorto(p.numero_pedido)})`, t.nombre),
      cliente,
      telefono: telefonoDe(p.cliente_telefono, p.cliente_telefono_alt),
      clienteId: d.cliente_id ?? p.cliente_id ?? null,
      telefonoPrincipal: p.cliente_telefono ?? null,
      telefonoAlt: p.cliente_telefono_alt ?? null,
    };
  }

  private hojaAbono(d: TicketAbonoCuenta, t: DatosTienda): Hoja {
    const folio = `AB-${d.id}`;
    return {
      html: armarTicketAbonoCuenta(d, t),
      titulo: `Ticket de abono ${folio}`,
      archivo: nombreArchivo(`Abono ${folio}.pdf`),
      mensaje: mensajeWhatsapp(d.cliente.nombre, `el ticket de su abono ${folio} por ${dineroTicket(d.monto)}`, t.nombre),
      cliente: d.cliente.nombre,
      telefono: telefonoDe(d.cliente.telefono, d.cliente.telefono_alt),
      clienteId: d.cliente.id ?? null,
      telefonoPrincipal: d.cliente.telefono ?? null,
      telefonoAlt: d.cliente.telefono_alt ?? null,
    };
  }

  private hojaAnticipo(d: TicketAnticipo, t: DatosTienda): Hoja {
    const folio = `AN-${d.id}`;
    return {
      html: armarTicketAnticipo(d, t),
      titulo: `Ticket de anticipo ${folio}`,
      archivo: nombreArchivo(`Anticipo ${folio}.pdf`),
      mensaje: mensajeWhatsapp(d.cliente.nombre, `el ticket de su anticipo ${folio} por ${dineroTicket(d.total)}`, t.nombre),
      cliente: d.cliente.nombre,
      telefono: telefonoDe(d.cliente.telefono, d.cliente.telefono_alt),
      clienteId: d.cliente.id ?? null,
      telefonoPrincipal: d.cliente.telefono ?? null,
      telefonoAlt: d.cliente.telefono_alt ?? null,
    };
  }

  private hojaPagoNota(d: TicketPagoNota, t: DatosTienda): Hoja {
    const folio = `PG-${d.id}`;
    const nota = folioCorto(d.pedido.numero_pedido);
    return {
      html: armarTicketPagoNota(d, t),
      titulo: `Ticket de abono ${folio}`,
      archivo: nombreArchivo(`Abono ${folio}.pdf`),
      mensaje: mensajeWhatsapp(d.cliente?.nombre, `el ticket de su abono ${folio} a la nota ${nota} por ${dineroTicket(d.monto)}`, t.nombre),
      cliente: d.cliente?.nombre ?? null,
      telefono: telefonoDe(d.cliente?.telefono, d.cliente?.telefono_alt),
      clienteId: d.cliente?.id ?? null,
      telefonoPrincipal: d.cliente?.telefono ?? null,
      telefonoAlt: d.cliente?.telefono_alt ?? null,
    };
  }

  private imprimirHoja(hoja$: Observable<Hoja>): Observable<void> {
    return hoja$.pipe(switchMap((h) => from(imprimirTicket(h.html))));
  }

  /** Abre la ventana de WhatsApp y le prepara el PDF de ese ticket. */
  private mandar(titulo: string, hoja$: Observable<Hoja>): void {
    this.injector.get(WhatsappService).abrir(titulo, hoja$.pipe(
      switchMap((h) => from(ticketEnPdf(h.html, h.titulo)).pipe(
        map((pdf): PaqueteWhatsapp => ({
          titulo: h.titulo, pdf, archivo: h.archivo, mensaje: h.mensaje, cliente: h.cliente, telefono: h.telefono,
          clienteId: h.clienteId, telefonoPrincipal: h.telefonoPrincipal, telefonoAlt: h.telefonoAlt,
        }))
      ))
    ));
  }
}
