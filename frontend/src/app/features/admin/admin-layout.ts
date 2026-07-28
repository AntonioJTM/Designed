import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { FechaPipe } from '../../shared/fecha.pipe';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FechaPipe],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.scss',
})
export class AdminLayout {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notif = inject(NotificacionesService);

  readonly sesion = this.auth.sesion;

  /**
   * Lo que está esperando a alguien: solicitudes de las sucursales por surtir,
   * envíos por firmar de recibido y existencias bajo su mínimo. Va junto al nombre
   * del usuario, que es donde el usuario pidió las notificaciones.
   */
  readonly pendientes = this.notif.pendientes;
  readonly abierto = signal(false);

  readonly total = computed(() => this.pendientes()?.total ?? 0);

  constructor() {
    // Al recargar directo en /admin, la sesión en memoria puede estar vacía;
    // recuperamos el perfil desde el token para saber nombre y rol.
    if (!this.auth.sesion()) {
      this.auth.cargarPerfil().subscribe({ next: () => {}, error: () => {} });
    }
    this.notif.iniciar();
  }

  esAdmin(): boolean {
    return this.sesion()?.rol === 'administrador';
  }

  alternar(): void {
    this.abierto.update((v) => !v);
    // Al abrirla se refresca: si acabas de surtir algo, el número debe bajar.
    if (this.abierto()) this.notif.refrescar();
  }

  /** Al tocar un pendiente se va a su pantalla y se cierra el panel. */
  irA(ruta: string): void {
    this.abierto.set(false);
    this.router.navigateByUrl(ruta);
  }

  salir(): void {
    this.notif.detener();
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
