import { Component, DestroyRef, ElementRef, effect, inject, viewChild } from '@angular/core';
import { ConfirmacionService } from '../../core/services/confirmacion.service';

/**
 * La ventana de confirmación del sistema (ver `ConfirmacionService`). Va una
 * sola vez, en la raíz de la aplicación.
 *
 * · Como todos los modales, NO se cierra al tocar el fondo.
 * · Escape = "Cancelar", Enter = el botón enfocado (el que acepta).
 * · Va ENCIMA de cualquier otro modal (z-index 60 contra 50), porque muchas
 *   confirmaciones salen de adentro de uno (eliminar un almacén, una lista…).
 * · Su Escape no debe cerrar también el modal de abajo: se atiende en la fase
 *   de captura y se detiene ahí.
 */
@Component({
  selector: 'app-confirmacion',
  template: `
    @if (svc.actual(); as c) {
      <div class="modal-overlay confirmacion-fondo">
        <div class="modal confirmacion" role="alertdialog" aria-modal="true"
             aria-labelledby="confirmacion-titulo" [attr.aria-describedby]="c.mensaje ? 'confirmacion-mensaje' : null">
          <div class="cuerpo">
            <span class="icono" [class.peligro]="c.peligro" aria-hidden="true">
              @if (c.peligro) {
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                     stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4 M12 17h.01 M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path></svg>
              } @else {
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                     stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01"></path></svg>
              }
            </span>
            <div class="texto">
              <h2 id="confirmacion-titulo">{{ c.titulo }}</h2>
              @if (c.mensaje) { <p id="confirmacion-mensaje">{{ c.mensaje }}</p> }
            </div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" (click)="svc.responder(false)">{{ c.cancelar ?? 'Cancelar' }}</button>
            <button #aceptar type="button" class="btn" [class.btn-primary]="!c.peligro" [class.btn-rojo]="c.peligro"
                    (click)="svc.responder(true)">
              {{ c.aceptar ?? 'Aceptar' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .confirmacion-fondo { z-index: 60; align-items: center; }
    .confirmacion { max-width: 460px; }
    .cuerpo { display: flex; gap: 16px; padding: 24px 24px 20px; }
    .icono {
      flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--info-f); color: var(--info-t);
    }
    .icono.peligro { background: var(--peligro-f); color: var(--peligro-t); }
    .texto { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding-top: 2px; }
    .texto h2 { margin: 0; font-size: 17px; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
    .texto p { margin: 0; font-size: 14px; color: var(--tinta-3); line-height: 1.5; white-space: pre-line; }
    .btn-rojo { background: var(--peligro-t); color: #fff; }
    .btn-rojo:hover { background: #861D14; color: #fff; }
  `,
})
export class ConfirmacionComponent {
  readonly svc = inject(ConfirmacionService);
  private readonly botonAceptar = viewChild<ElementRef<HTMLButtonElement>>('aceptar');

  constructor() {
    // Al abrir, el foco va al botón que acepta: Enter confirma, como en el
    // cuadro del navegador.
    effect(() => {
      if (this.svc.actual()) setTimeout(() => this.botonAceptar()?.nativeElement.focus());
    });

    const alTeclear = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !this.svc.actual()) return;
      ev.stopPropagation();
      ev.preventDefault();
      this.svc.responder(false);
    };
    window.addEventListener('keydown', alTeclear, true);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('keydown', alTeclear, true));
  }
}
