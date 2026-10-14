import { Injectable, Injector, inject } from '@angular/core';
import { Observable, catchError, defer, forkJoin, map, of, shareReplay } from 'rxjs';
import { Pedido } from '../models/ventas.models';
import { VentasService } from './ventas.service';
import { TiendaService } from './tienda.service';
import { DatosTienda, ExtrasTicket, armarTicket, imprimirTicket } from '../../shared/ticket/ticket';

/**
 * Imprime el ticket de una venta, el mismo desde la caja y desde el detalle.
 * La dirección y el teléfono salen de Configuración; si no están capturados,
 * el ticket lleva solo el nombre.
 */
@Injectable({ providedIn: 'root' })
export class TicketService {
  // Los servicios se buscan al imprimir, no al crear este: la caja y el detalle
  // lo inyectan siempre, y así no arrastran la conexión al servidor por nada.
  private readonly injector = inject(Injector);

  private readonly datos$: Observable<DatosTienda> = defer(() => this.injector.get(TiendaService).configuracion()).pipe(
    map((c) => ({ nombre: 'Hitex', direccion: c.tienda_direccion, telefono: c.tienda_telefono })),
    catchError(() => of({ nombre: 'Hitex' })),
    shareReplay(1)
  );

  /** Con la venta ya cargada (el detalle). */
  imprimirPedido(p: Pedido, extras?: ExtrasTicket): Observable<void> {
    return this.datos$.pipe(map((t) => imprimirTicket(armarTicket(p, t, extras))));
  }

  /** Recién cobrada (la caja): se pide completa, con sus artículos y pagos. */
  imprimir(pedidoId: number, extras?: ExtrasTicket): Observable<void> {
    return forkJoin([this.injector.get(VentasService).obtenerPedido(pedidoId), this.datos$]).pipe(
      map(([p, t]) => imprimirTicket(armarTicket(p, t, extras)))
    );
  }
}
