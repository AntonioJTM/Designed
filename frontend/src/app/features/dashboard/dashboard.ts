import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { SesionActual } from '../../core/models/auth.models';

@Component({
  selector: 'app-dashboard',
  imports: [],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly sesion = signal<SesionActual | null>(this.auth.sesion());
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    // Verifica el token contra el API pidiendo el perfil real.
    this.auth.cargarPerfil().subscribe({
      next: (s) => {
        this.sesion.set(s);
        this.cargando.set(false);
      },
      error: () => {
        this.error.set('Tu sesión expiró o no es válida. Inicia sesión de nuevo.');
        this.cargando.set(false);
      },
    });
  }

  salir(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
