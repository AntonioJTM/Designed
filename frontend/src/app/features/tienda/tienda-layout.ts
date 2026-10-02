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

  constructor() {
    // La sesión vive en localStorage, pero el PERFIL (nombre, correo) solo se
    // tenía al iniciar sesión: tras recargar, el checkout decía "Comprando como
    // cliente" en vez del nombre. El panel ya lo pedía así; la tienda no.
    if (this.esCliente() && !this.auth.sesion()) {
      this.auth.cargarPerfil().subscribe({ next: () => {}, error: () => {} });
    }
  }

  salir(): void {
    this.auth.logout();
  }
}
