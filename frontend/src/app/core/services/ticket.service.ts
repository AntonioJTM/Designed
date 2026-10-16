import { Injectable, Injector, inject } from '@angular/core';
import { Observable, catchError, defer, forkJoin, from, map, of, shareReplay, switchMap } from 'rxjs';
import { DevolucionHecha, Pedido } from '../models/ventas.models';
import { VentasService } from './ventas.service';
import { TiendaService } from './tienda.service';
import { ClientesService } from './clientes.service';
import {
  DatosTienda, ExtrasTicket, armarTicket, armarTicketAbonoCuenta, armarTicketAnticipo, armarTicketDevolucion,
  armarTicketPagoNota, imprimirTicket,
} from '../../shared/ticket/ticket';

/**
 * Imprime el ticket de una venta, el mismo desde la caja y desde el detalle.
 * Los datos fiscales, la dirección, el teléfono y la leyenda salen de
 * Configuración; lo que no esté capturado no sale. El logo es el de
 * `public/hitex-ticket.png` (en negro, para la térmica).
 */
/** Lo que sale aunque Configuración no conteste: el nombre y el logo. */
const BASE: DatosTienda = {
  nombre: 'Hitex',
  // Completa: el ticket se dibuja en un marco aparte y la imprime la caja o el detalle.
  logo: typeof document !== 'undefined' ? new URL('hitex-ticket.png', document.baseURI).href : null,
};

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

  /** Con la venta ya cargada (el detalle). */
  imprimirPedido(p: Pedido, extras?: ExtrasTicket): Observable<void> {
    return this.datos$.pipe(switchMap((t) => from(imprimirTicket(armarTicket(p, t, extras)))));
  }

  /** El ticket de UNA devolución de esa venta (el de la venta sigue con `imprimirPedido`). */
  imprimirDevolucion(p: Pedido, d: DevolucionHecha): Observable<void> {
    return this.datos$.pipe(switchMap((t) => from(imprimirTicket(armarTicketDevolucion(p, d, t)))));
  }

  /**
   * Los tickets de la cuenta del cliente (2026-10-15): se piden al servidor con
   * el movimiento recién registrado —o uno viejo, para reimprimirlo— y salen
   * igual las dos veces.
   */
  imprimirAbonoCuenta(clienteId: number, movimientoId: number): Observable<void> {
    return forkJoin([this.injector.get(ClientesService).ticketAbono(clienteId, movimientoId), this.datos$]).pipe(
      switchMap(([d, t]) => from(imprimirTicket(armarTicketAbonoCuenta(d, t))))
    );
  }

  imprimirAnticipo(clienteId: number, movimientoId: number): Observable<void> {
    return forkJoin([this.injector.get(ClientesService).ticketAnticipo(clienteId, movimientoId), this.datos$]).pipe(
      switchMap(([d, t]) => from(imprimirTicket(armarTicketAnticipo(d, t))))
    );
  }

  /** Un abono a una nota (pendiente de pago, en espera o apartado): uno de sus pagos. */
  imprimirPagoNota(pedidoId: number, pagoId: number): Observable<void> {
    return forkJoin([this.injector.get(VentasService).ticketPago(pedidoId, pagoId), this.datos$]).pipe(
      switchMap(([d, t]) => from(imprimirTicket(armarTicketPagoNota(d, t))))
    );
  }

  /** Recién cobrada (la caja): se pide completa, con sus artículos y pagos. */
  imprimir(pedidoId: number, extras?: ExtrasTicket): Observable<void> {
    return forkJoin([this.injector.get(VentasService).obtenerPedido(pedidoId), this.datos$]).pipe(
      switchMap(([p, t]) => from(imprimirTicket(armarTicket(p, t, extras))))
    );
  }
}
