import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { rutaDeInicio } from '../../../core/navegacion';

/**
 * Para quien entra y su puesto no tiene ninguna pantalla (un puesto nuevo, o
 * "Sin acceso"). Antes caía en "Pregúntame", que no pedía permiso; se quitó el
 * 2026-10-13 y sin esto la guarda lo mandaría de una pantalla negada a otra.
 * Quien sí tiene alguna y llega aquí por la dirección se va a la suya.
 */
@Component({
  selector: 'app-sin-acceso',
  template: `
    <div class="pagina">
      <header class="page-head">
        <div>
          <h1>Todavía no tienes pantallas</h1>
          <p class="muted">
            Tu puesto{{ puesto() ? ' (' + puesto() + ')' : '' }} no tiene permiso para ninguna pantalla del sistema.
            Pídele al administrador que te dé acceso en <b>Permisos</b>; al volver a entrar ya verás tus pantallas en el menú.
          </p>
        </div>
      </header>
    </div>
  `,
})
export class SinAcceso implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    const inicio = rutaDeInicio((p) => this.auth.puede(p));
    if (inicio !== '/admin/sin-acceso') void this.router.navigateByUrl(inicio);
  }

  puesto(): string | null {
    return this.auth.sesion()?.rol ?? null;
  }
}
