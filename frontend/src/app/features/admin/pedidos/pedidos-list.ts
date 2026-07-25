import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VentasService } from '../../../core/services/ventas.service';
import { CanalVenta, EstadoPedido, Pedido } from '../../../core/models/ventas.models';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { ApiError } from '../../../core/models/auth.models';

@Component({
  selector: 'app-pedidos-list',
  imports: [FormsModule, RouterLink, FechaPipe],
  templateUrl: './pedidos-list.html',
})
export class PedidosList {
  private readonly ventas = inject(VentasService);

  readonly pedidos = signal<Pedido[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  canal: CanalVenta | '' = '';
  estado: EstadoPedido | '' = '';

  constructor() {
    this.buscar();
  }

  buscar(): void {
    this.cargando.set(true);
    this.ventas
      .listarPedidos({ canal: this.canal || undefined, estado: this.estado || undefined })
      .subscribe({
        next: (p) => {
          this.pedidos.set(p.items);
          this.total.set(p.total);
          this.cargando.set(false);
        },
        error: (e) => {
          this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error');
          this.cargando.set(false);
        },
      });
  }
}
