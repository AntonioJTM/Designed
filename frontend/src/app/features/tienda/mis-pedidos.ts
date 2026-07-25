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
