import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CartService } from '../../core/services/cart.service';
import { VentasService } from '../../core/services/ventas.service';
import { TokenService } from '../../core/services/token.service';
import { AuthService } from '../../core/services/auth.service';
import { Pedido } from '../../core/models/ventas.models';
import { ApiError } from '../../core/models/auth.models';

@Component({
  selector: 'app-checkout',
  imports: [RouterLink],
  templateUrl: './checkout.html',
})
export class Checkout {
  readonly cart = inject(CartService);
  private readonly ventas = inject(VentasService);
  private readonly tokens = inject(TokenService);
  private readonly auth = inject(AuthService);

  readonly esCliente = computed(() => this.tokens.tipo() === 'cliente');
  readonly sesion = this.auth.sesion;
  readonly procesando = signal(false);
  readonly error = signal<string | null>(null);
  readonly pedido = signal<Pedido | null>(null);

  confirmar(): void {
    if (!this.esCliente() || this.cart.items().length === 0) return;
    this.procesando.set(true);
    this.error.set(null);

    this.ventas
      .crearPedido({
        canal: 'tienda_linea',
        items: this.cart.items().map((i) => ({ variante_id: i.variante_id, cantidad: i.cantidad })),
      })
      .subscribe({
        next: (p) => {
          this.pedido.set(p);
          this.cart.vaciar();
          this.procesando.set(false);
        },
        error: (e) => {
          this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'No se pudo crear el pedido');
          this.procesando.set(false);
        },
      });
  }
}
