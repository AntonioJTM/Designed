import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.scss',
})
export class AdminLayout {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly sesion = this.auth.sesion;

  constructor() {
    // Al recargar directo en /admin, la sesión en memoria puede estar vacía;
    // recuperamos el perfil desde el token para saber nombre y rol.
    if (!this.auth.sesion()) {
      this.auth.cargarPerfil().subscribe({ next: () => {}, error: () => {} });
    }
  }

  esAdmin(): boolean {
    return this.sesion()?.rol === 'administrador';
  }

  salir(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
