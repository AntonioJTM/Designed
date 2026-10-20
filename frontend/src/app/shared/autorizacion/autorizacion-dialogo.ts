import { Component, DestroyRef, ElementRef, effect, inject, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AutorizacionDialogoService } from '../../core/services/autorizacion-dialogo.service';

/**
 * La ventana "Hace falta autorización" (2026-10-19; ver `AutorizacionDialogoService`
 * y `autorizacion.interceptor.ts`). Va una sola vez, en la raíz.
 *
 * · Dice qué se pide, en palabras, y deja: PEDIR la autorización (la acepta
 *   después alguien que la hace directo, en Autorizaciones) o AUTORIZAR AQUÍ
 *   (quien autoriza elige su nombre y escribe su clave en esta pantalla). Fiar a
 *   alguien atrasado solo se autoriza aquí: el cliente está enfrente.
 * · Como todos los modales, no se cierra al tocar el fondo; Escape = no hacerlo.
 * · Va encima de cualquier ventana (z-index 61): casi siempre sale de una.
 */
@Component({
  selector: 'app-autorizacion-dialogo',
  imports: [FormsModule],
  template: `
    @if (svc.actual(); as a) {
      <div class="modal-overlay autorizacion-fondo">
        <div class="modal autorizacion" role="alertdialog" aria-modal="true" aria-labelledby="autorizacion-titulo"
             aria-describedby="autorizacion-que">
          <div class="cuerpo">
            <span class="icono" [class.lista]="a.pedida" aria-hidden="true">
              @if (a.pedida) {
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>
              } @else {
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                     stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8.1-8 9-4.6-.9-8-4.5-8-9V6z M12 8v5 M12 16h.01"></path></svg>
              }
            </span>
            <div class="texto">
              @if (a.pedida) {
                @if (a.yaEstaba) {
                  <h2 id="autorizacion-titulo">Ya la habías pedido</h2>
                  <p id="autorizacion-que">
                    {{ a.info.resumen }}.<br />
                    Sigue esperando a que la acepte {{ quienes(a.info.autorizadores) }}: no se pidió otra. La sigues en
                    <b>Autorizaciones</b>.
                  </p>
                } @else {
                  <h2 id="autorizacion-titulo">Listo: se pidió la autorización</h2>
                  <p id="autorizacion-que">
                    {{ a.info.resumen }}.<br />
                    Se hace cuando la acepte {{ quienes(a.info.autorizadores) }}. La sigues en <b>Autorizaciones</b>.
                  </p>
                }
              } @else {
                <h2 id="autorizacion-titulo">«{{ a.info.nombre }}» necesita autorización</h2>
                <p id="autorizacion-que" class="que">{{ a.info.resumen }}</p>
              }
            </div>
          </div>

          @if (!a.pedida) {
            <div class="opciones">
              @if (a.error || errorLocal) { <p class="alert" role="alert">{{ errorLocal || a.error }}</p> }

              @if (!a.info.autorizadores.length) {
                <p class="aviso">Nadie puede autorizar esto en esta tienda. Pídele al administrador que lo revise en Permisos.</p>
              } @else if (!conClave(a.info.autorizadores).length) {
                <p class="aviso">
                  Quien autoriza todavía no tiene su clave de autorización: la pone en <b>«Mi clave»</b>,
                  abajo, junto a su nombre.
                </p>
              } @else {
                <!-- Sin <form>: así el navegador no ofrece "guardar la contraseña" en la caja. -->
                <div class="aqui" role="group" aria-labelledby="autorizar-aqui">
                  <h3 id="autorizar-aqui">Autorizar aquí</h3>
                  <p class="muted">Quien autoriza escribe su clave de autorización y se hace en este momento.</p>
                  <div class="form-grid">
                    <label class="field">
                      Quién autoriza
                      <select [(ngModel)]="usuarioId" name="autoriza" [disabled]="a.ocupado">
                        @for (u of conClave(a.info.autorizadores); track u.id) { <option [ngValue]="u.id">{{ u.nombre }}</option> }
                      </select>
                    </label>
                    <label class="field">
                      Su clave de autorización
                      <!-- Sin cortar a 6: si la pistola escribe aquí, se avisa y no cuenta como intento (2026-10-20). -->
                      <input #campoClave type="password" inputmode="numeric" maxlength="20" [(ngModel)]="clave" name="clave"
                             autocomplete="one-time-code" [disabled]="a.ocupado" (keydown.enter)="autorizarAqui()" />
                    </label>
                  </div>
                  <button type="button" class="btn btn-primary" (click)="autorizarAqui()" [disabled]="a.ocupado || !clave || !usuarioId">
                    {{ a.ocupado && modo === 'aqui' ? 'Autorizando…' : 'Autorizar y hacerlo' }}
                  </button>
                </div>
              }

              @if (!a.info.solo_en_el_momento && a.info.autorizadores.length) {
                <div class="pedir">
                  <!-- Si no se puede autorizar aquí, pedirla es LA opción: va sin "O" y en azul (2026-10-20). -->
                  <h3>{{ conClave(a.info.autorizadores).length ? 'O pedirla' : 'Pedirla' }}</h3>
                  <p class="muted">Le llega a {{ quienes(a.info.autorizadores) }} en Autorizaciones; se hace cuando la acepte.</p>
                  <button type="button" class="btn" [class.btn-primary]="!conClave(a.info.autorizadores).length"
                          [class.btn-ghost]="conClave(a.info.autorizadores).length" (click)="pedir()" [disabled]="a.ocupado">
                    {{ a.ocupado && modo === 'pedir' ? 'Pidiendo…' : 'Pedir autorización' }}
                  </button>
                </div>
              } @else if (a.info.solo_en_el_momento) {
                <p class="muted nota">Esto no se deja pedido para después: el cliente está enfrente.</p>
              }
            </div>
          }

          <div class="modal-foot">
            @if (a.pedida) {
              <button #listo type="button" class="btn btn-primary" (click)="svc.enterado()">Entendido</button>
            } @else {
              <button type="button" class="btn btn-ghost" (click)="svc.elegir({ tipo: 'no' })" [disabled]="a.ocupado">No hacerlo</button>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .autorizacion-fondo { z-index: 61; align-items: center; }
    /* Se desplaza por dentro: en el celular con el teclado abierto no se sale del recuadro (2026-10-20). */
    .autorizacion { max-width: 520px; display: flex; flex-direction: column; max-height: calc(100dvh - 32px); }
    .cuerpo { display: flex; gap: 16px; padding: 24px 24px 12px; flex: 0 0 auto; }
    .icono {
      flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--aviso-f); color: var(--aviso-t);
    }
    .icono.lista { background: var(--ok-f); color: var(--ok-t); }
    .texto { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding-top: 2px; }
    .texto h2 { margin: 0; font-size: 1.0625rem; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
    .texto p { margin: 0; font-size: 0.875rem; color: var(--tinta-3); line-height: 1.5; }
    .texto p.que { color: var(--tinta); font-weight: 500; }
    .opciones { display: flex; flex-direction: column; gap: 16px; padding: 4px 24px 20px; overflow-y: auto; min-height: 0; }
    .opciones h3 { margin: 0 0 4px; font-size: 0.9375rem; }
    .opciones .muted { margin: 0 0 10px; font-size: 0.8125rem; }
    .aqui, .pedir { border: 1px solid var(--borde); border-radius: 8px; padding: 14px 16px; }
    .aqui .form-grid { margin-bottom: 12px; }
    .nota { margin: 0; }
  `,
})
export class AutorizacionDialogo {
  readonly svc = inject(AutorizacionDialogoService);
  // OJO: la referencia NO se llama como el campo `clave`: en la plantilla taparía
  // a la propiedad y el ngModel se ataría al elemento ("[object HTMLInputElement]").
  private readonly campoClave = viewChild<ElementRef<HTMLInputElement>>('campoClave');
  private readonly botonListo = viewChild<ElementRef<HTMLButtonElement>>('listo');

  usuarioId: number | null = null;
  clave = '';
  modo: 'aqui' | 'pedir' | null = null;

  constructor() {
    // Al abrir (o al volver por una clave equivocada): el primero que autoriza
    // ya elegido, la clave vacía y el cursor en ella. Al pedirla, en "Entendido".
    effect(() => {
      const a = this.svc.actual();
      if (!a) return;
      if (a.pedida) {
        setTimeout(() => this.botonListo()?.nativeElement.focus());
        return;
      }
      if (a.ocupado) return;
      const conClave = this.conClave(a.info.autorizadores);
      if (!conClave.some((u) => u.id === this.usuarioId)) this.usuarioId = conClave[0]?.id ?? null;
      this.clave = '';
      this.modo = null;
      this.errorLocal = null;
      setTimeout(() => this.campoClave()?.nativeElement.focus());
    });

    // Escape = no hacerlo; se atiende aquí y no cierra también la ventana de abajo.
    const alTeclear = (ev: KeyboardEvent) => {
      const a = this.svc.actual();
      if (ev.key !== 'Escape' || !a || a.ocupado) return;
      ev.stopPropagation();
      ev.preventDefault();
      if (a.pedida) this.svc.enterado();
      else this.svc.elegir({ tipo: 'no' });
    };
    document.addEventListener('keydown', alTeclear, true);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('keydown', alTeclear, true));
  }

  /** Lo que se revisa aquí, sin gastar un intento de la clave. */
  errorLocal: string | null = null;

  autorizarAqui(): void {
    if (!this.usuarioId || !this.clave) return;
    // Una clave son de 4 a 6 números: si no, no se manda (no cuenta como intento
    // equivocado de quien autoriza; la pistola pudo escribir aquí un código).
    if (!/^\d{4,6}$/.test(this.clave.trim())) {
      this.errorLocal = 'La clave de autorización son de 4 a 6 números. Escríbela otra vez.';
      this.clave = '';
      return;
    }
    this.errorLocal = null;
    this.modo = 'aqui';
    this.svc.elegir({ tipo: 'aqui', usuario_id: this.usuarioId, clave: this.clave });
    this.clave = '';
  }

  pedir(): void {
    this.modo = 'pedir';
    this.svc.elegir({ tipo: 'pedir' });
  }

  /** Solo quien ya puso su clave de autorización autoriza en el momento. */
  conClave<T extends { con_clave: boolean }>(lista: T[]): T[] {
    return lista.filter((u) => u.con_clave);
  }

  /** "Yessica o Jairo", "Yessica, Jairo o Adriana". */
  quienes(lista: { nombre: string }[]): string {
    const n = lista.map((u) => u.nombre.split(' ')[0]);
    if (n.length <= 1) return n[0] ?? 'quien autoriza';
    return `${n.slice(0, -1).join(', ')} o ${n[n.length - 1]}`;
  }
}
