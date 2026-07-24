import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { CartService } from '../../core/services/cart.service';
import { TokenService } from '../../core/services/token.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-tienda-layout',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './tienda-layout.html',
})
export class TiendaLayout {
  private readonly tokens = inject(TokenService);
  private readonly auth = inject(AuthService);
  readonly cart = inject(CartService);

  readonly esCliente = () => this.tokens.tipo() === 'cliente';

  salir(): void {
    this.auth.logout();
  }
}
