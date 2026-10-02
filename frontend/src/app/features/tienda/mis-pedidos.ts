import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VentasService } from '../../core/services/ventas.service';
import { TokenService } from '../../core/services/token.service';
import { Pedido } from '../../core/models/ventas.models';
import { FechaPipe } from '../../shared/fecha.pipe';
import { ApiError } from '../../core/models/auth.models';

@Component({
  selector: 'app-mis-pedidos',
  imports: [RouterLink, FechaPipe],
  templateUrl: './mis-pedidos.html',
})
export class MisPedidos {
  private readonly ventas = inject(VentasService);
  private readonly tokens = inject(TokenService);

  readonly pedidos = signal<Pedido[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly esCliente = () => this.tokens.tipo() === 'cliente';

  /**
   * El estado en palabras del cliente. Antes se mostraba la clave interna
   * ("en_preparacion"), que es para el sistema, no para quien compra.
   */
  private readonly ESTADOS: Record<string, string> = {
    pendiente: 'Esperando tu pago',
    pagado: 'Pagado',
    en_preparacion: 'En preparación',
    enviado: 'Enviado',
    entregado: 'Entregado',
    cancelado: 'Cancelado',
    devuelto: 'Devuelto',
    apartado: 'Apartado',
  };

  estado(e: string): string {
    return this.ESTADOS[e] ?? e;
  }

  dinero(v: string | number): string {
    return Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }

  constructor() {
    if (!this.esCliente()) {
      this.cargando.set(false);
      return;
    }
    this.ventas.misPedidos().subscribe({
      next: (p) => {
        this.pedidos.set(p.items);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error');
        this.cargando.set(false);
      },
    });
  }
}
