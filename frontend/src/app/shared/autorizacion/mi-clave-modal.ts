import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AutorizacionesService } from '../../core/services/autorizaciones.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ApiError } from '../../core/models/auth.models';

/**
 * "MI CLAVE PARA AUTORIZAR" (2026-10-19). La clave con que quien autoriza da el
 * visto bueno EN EL MOMENTO, en la pantalla de quien pide: un número de 4 a 6
 * dígitos APARTE de la contraseña de entrar (si alguien la ve en la computadora
 * de la caja, no puede entrar al sistema con ella). Se pone o se cambia aquí,
 * confirmando con la contraseña de entrar.
 */
@Component({
  selector: 'app-mi-clave-modal',
  imports: [FormsModule],
  host: { '(document:keydown.escape)': 'cerrar()' },
  template: `
    <div class="modal-overlay">
      <div class="modal angosto" role="dialog" aria-modal="true" aria-labelledby="mi-clave-titulo">
        <div class="modal-head">
          <h2 id="mi-clave-titulo">Mi clave para autorizar</h2>
          <button type="button" class="modal-cerrar" (click)="cerrar()" aria-label="Cerrar">✕</button>
        </div>
        <form (ngSubmit)="guardar()">
          <div class="modal-body columna">
            @if (listo()) {
              <p class="ok-msg" role="status">Listo: ya puedes autorizar con tu clave en la pantalla de quien te lo pida.</p>
            } @else {
              <p class="muted">
                Con esta clave autorizas en el momento, en la computadora de quien te lo pide. Es <b>aparte</b> de tu
                contraseña de entrar: no la compartas y no uses la misma.
              </p>
              @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
              <label class="field">
                Tu contraseña de entrar
                <input type="password" [(ngModel)]="contrasena" name="contrasena" autocomplete="current-password" />
              </label>
              <div class="form-grid">
                <label class="field">
                  Tu clave para autorizar
                  <input type="password" inputmode="numeric" maxlength="6" [(ngModel)]="clave" name="clave"
                         autocomplete="new-password" />
                  <span class="ayuda">De 4 a 6 números.</span>
                </label>
                <label class="field">
                  Otra vez
                  <input type="password" inputmode="numeric" maxlength="6" [(ngModel)]="otraVez" name="otraVez"
                         autocomplete="new-password" />
                </label>
              </div>
            }
          </div>
          <div class="modal-foot">
            @if (listo()) {
              <button type="button" class="btn btn-primary" (click)="cerrar()">Listo</button>
            } @else {
              <button type="button" class="btn btn-ghost" (click)="cerrar()">Cancelar</button>
              <button type="submit" class="btn btn-primary" [disabled]="guardando()">
                {{ guardando() ? 'Guardando…' : 'Guardar mi clave' }}
              </button>
            }
          </div>
        </form>
      </div>
    </div>
  `,
})
export class MiClaveModal {
  private readonly api = inject(AutorizacionesService);
  private readonly notif = inject(NotificacionesService);
  readonly cerrado = output<void>();
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly listo = signal(false);
  contrasena = '';
  clave = '';
  otraVez = '';

  guardar(): void {
    if (!this.contrasena) return this.error.set('Escribe tu contraseña de entrar.');
    if (!/^\d{4,6}$/.test(this.clave)) return this.error.set('La clave para autorizar son de 4 a 6 números.');
    if (this.clave !== this.otraVez) return this.error.set('Las dos claves no son iguales.');
    this.guardando.set(true);
    this.error.set(null);
    this.api.fijarMiClave(this.contrasena, this.clave).subscribe({
      next: () => {
        this.guardando.set(false);
        this.listo.set(true);
        // "Tu clave se apagó" se quita ya, no hasta la siguiente vuelta de la campana (2026-10-26).
        this.notif.refrescar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.');
      },
    });
  }

  cerrar(): void {
    this.cerrado.emit();
  }
}
