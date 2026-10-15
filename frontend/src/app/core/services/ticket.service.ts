import { Injectable, Injector, inject } from '@angular/core';
import { Observable, catchError, defer, forkJoin, from, map, of, shareReplay, switchMap } from 'rxjs';
import { Pedido } from '../models/ventas.models';
import { VentasService } from './ventas.service';
import { TiendaService } from './tienda.service';
import { DatosTienda, ExtrasTicket, armarTicket, imprimirTicket } from '../../shared/ticket/ticket';

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

  /** Recién cobrada (la caja): se pide completa, con sus artículos y pagos. */
  imprimir(pedidoId: number, extras?: ExtrasTicket): Observable<void> {
    return forkJoin([this.injector.get(VentasService).obtenerPedido(pedidoId), this.datos$]).pipe(
      switchMap(([p, t]) => from(imprimirTicket(armarTicket(p, t, extras))))
    );
  }
}
