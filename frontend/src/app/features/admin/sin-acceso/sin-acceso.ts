import { Component, computed, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, SOLO_TODAS_LAS_TIENDAS } from '../../../core/services/auth.service';
import { MENU, rutaDeInicio } from '../../../core/navegacion';

/**
 * Para quien entra y su puesto no tiene ninguna pantalla (un puesto nuevo, o
 * "Sin acceso"). Antes caía en "Pregúntame", que no pedía permiso; se quitó el
 * 2026-10-13 y sin esto la guarda lo mandaría de una pantalla negada a otra.
 * Quien sí tiene alguna y llega aquí por la dirección se va a la suya.
 *
 * Si su puesto SÍ tiene pantallas pero todas suman todas las tiendas y la persona
 * trabaja en una sola, lo dice (2026-10-22): antes solo decía "no tienes
 * pantallas" y nadie sabía por qué. Y cuando le dan permisos o tiendas con el
 * sistema abierto, se va solo a su pantalla (la sesión se pone al día en vivo).
 */
@Component({
  selector: 'app-sin-acceso',
  template: `
    <div class="pagina">
      <header class="page-head">
        <div>
          <h1>Todavía no tienes pantallas</h1>
          @if (deTodasLasTiendas().length) {
            <p class="muted">
              Tu puesto{{ puesto() ? ' (' + puesto() + ')' : '' }} tiene <b>{{ lista(deTodasLasTiendas()) }}</b>, pero
              {{ deTodasLasTiendas().length === 1 ? 'esa pantalla suma' : 'esas pantallas suman' }} todas las tiendas y tú
              trabajas en {{ tiendas() || 'ninguna tienda' }}. Pídele al administrador que en <b>Personal</b> te marque
              «Todas las tiendas»; en cuanto lo haga, aparecen solas en tu menú.
            </p>
          } @else {
            <p class="muted">
              Tu puesto{{ puesto() ? ' (' + puesto() + ')' : '' }} no tiene permiso para ninguna pantalla del sistema.
              Pídele al administrador que te dé acceso en <b>Permisos</b>; en cuanto lo haga, tus pantallas aparecen solas en el menú.
            </p>
          }
        </div>
      </header>
    </div>
  `,
})
export class SinAcceso {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Las pantallas de su puesto que no ve por ser de una sola tienda. */
  readonly deTodasLasTiendas = computed(() => {
    const permisos = this.auth.sesion()?.permisos ?? [];
    if (this.auth.veTodasLasTiendas()) return [];
    const nombres = MENU.flatMap((g) => g.opciones)
      .filter((o) => o.permiso && SOLO_TODAS_LAS_TIENDAS.has(o.permiso) && permisos.includes(o.permiso))
      .map((o) => o.nombre);
    return [...new Set(nombres)];
  });

  readonly tiendas = computed(() => this.auth.tiendas().map((t) => t.nombre).join(', '));

  constructor() {
    // Al llegar, y cada vez que su sesión se pone al día: si ya tiene alguna pantalla, a la suya.
    effect(() => {
      this.auth.sesion();
      const inicio = rutaDeInicio((p) => this.auth.puede(p));
      if (inicio !== '/admin/sin-acceso') void this.router.navigateByUrl(inicio);
    });
  }

  puesto(): string | null {
    return this.auth.sesion()?.rol ?? null;
  }

  lista(xs: string[]): string {
    return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
  }
}
