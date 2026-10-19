import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WhatsappService, WhatsappTienda } from '../../../core/services/whatsapp.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { numeroWhatsapp } from '../../../shared/ticket/whatsapp';

/**
 * Configuración → WHATSAPP DE LA TIENDA (2026-10-16: "que me pida escanear el QR
 * para enlazarlo y listo"). Se enlaza UNA vez con el celular de la tienda, como
 * WhatsApp Web, y desde ahí el botón «WhatsApp» de cada ticket le manda el PDF al
 * cliente directo, sin abrir nada.
 *
 * Mientras espera que escaneen el QR (cambia cada ~20 s) o mientras se conecta,
 * pregunta cada 2.5 s; enlazado o sin enlazar, deja de preguntar. Avisa lo que
 * el usuario aceptó al elegirlo: no es la conexión oficial de WhatsApp.
 */
@Component({
  selector: 'app-whatsapp-tienda',
  imports: [FormsModule],
  template: `
    <section class="card">
      <div class="card-head">
        <div>
          <h2>WhatsApp de la tienda</h2>
          <p>Para mandarle los tickets al cliente directo, sin abrir WhatsApp.</p>
        </div>
        @if (w(); as e) {
          <span [class]="'pill ' + tono(e)">{{ rotulo(e) }}</span>
        }
      </div>

      @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
      @if (w()?.aviso && w()?.estado !== 'apagado') { <p class="alert" role="alert">{{ w()?.aviso }}</p> }

      @if (!w()) {
        <p class="muted estado"><span class="spinner" aria-hidden="true"></span> Revisando…</p>
      } @else {
        @switch (w()!.estado) {
          @case ('apagado') {
            <p class="muted">{{ w()!.aviso }}</p>
          }
          @case ('sin_enlazar') {
            <p>
              Enlázalo una vez y listo: desde ese momento el botón «WhatsApp» de cada ticket le manda el PDF
              al cliente desde el número de la tienda.
            </p>
            <p class="muted nota">
              Usa el WhatsApp de la tienda, no uno personal. No es la conexión oficial de WhatsApp: si WhatsApp
              cree que son mensajes automáticos, podría bloquear el número.
            </p>
            <div class="botones">
              <button type="button" class="btn btn-primary" (click)="enlazar()" [disabled]="trabajando()">
                {{ trabajando() ? 'Pidiendo el código…' : 'Enlazar WhatsApp' }}
              </button>
            </div>
          }
          @case ('conectando') {
            <p class="estado" role="status"><span class="spinner" aria-hidden="true"></span> Conectando con WhatsApp…</p>
          }
          @case ('esperando_qr') {
            <div class="qr-fila">
              @if (w()!.qr) {
                <img class="qr" [src]="w()!.qr" width="240" height="240"
                     alt="Código QR para enlazar el WhatsApp de la tienda" />
              }
              <div class="qr-pasos">
                <ol>
                  <li>En el celular de la tienda abre <b>WhatsApp</b>.</li>
                  <li>Toca los tres puntos <b>⋮</b> (en iPhone, <b>Configuración</b>) y luego <b>Dispositivos vinculados</b>.</li>
                  <li>Toca <b>Vincular un dispositivo</b> y apunta la cámara a este código.</li>
                </ol>
                <p class="muted" role="status">El código cambia cada 20 segundos. En cuanto lo escanees, aquí dice «Enlazado».</p>
                <button type="button" class="btn btn-ghost" (click)="cancelar()" [disabled]="trabajando()">Cancelar</button>
              </div>
            </div>
          }
          @case ('enlazado') {
            <p>
              Enlazado con <b>{{ w()!.numero }}</b>
              @if (w()!.nombre) { ({{ w()!.nombre }}) }
              @if (w()!.desde) { desde el {{ fecha(w()!.desde) }} }.
              Los tickets le llegan al cliente desde este número.
            </p>
            <form class="prueba" (ngSubmit)="probar()">
              <label class="field">
                <span>Mandar un mensaje de prueba a</span>
                <input type="tel" name="prueba" inputmode="tel" autocomplete="off" placeholder="10 números"
                       [(ngModel)]="telefonoPrueba" [attr.aria-invalid]="!!problemaPrueba()" [class.invalido]="!!problemaPrueba()" />
              </label>
              <button type="submit" class="btn btn-ghost" [disabled]="trabajando()">
                {{ trabajando() ? 'Mandando…' : 'Mandar prueba' }}
              </button>
            </form>
            @if (problemaPrueba()) { <p class="alert" role="alert">{{ problemaPrueba() }}</p> }
            @if (ok()) { <p class="ok-msg" role="status">{{ ok() }}</p> }
            <div class="botones">
              <button type="button" class="btn btn-ghost peligro" (click)="desenlazar()" [disabled]="trabajando()">Desenlazar</button>
            </div>
          }
        }
      }
    </section>
  `,
  styles: `
    .card > p { margin: 0 0 12px; }
    .nota { font-size: 0.8125rem; }
    .estado { display: flex; align-items: center; gap: 8px; }
    .botones { display: flex; flex-wrap: wrap; gap: 8px; }
    .qr-fila { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
    .qr { width: 240px; height: 240px; max-width: 100%; border: 1px solid var(--borde); border-radius: 8px; image-rendering: pixelated; }
    .qr-pasos { flex: 1 1 18rem; min-width: 0; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
    .qr-pasos ol { margin: 0; padding-left: 1.25rem; display: grid; gap: 6px; }
    .qr-pasos p { margin: 0; font-size: 0.8125rem; }
    .prueba { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; margin-bottom: 12px; }
    .prueba .field { flex: 0 1 16rem; min-width: 0; }
    .peligro { color: var(--peligro-t); border-color: var(--peligro-borde); }
  `,
})
export class WhatsappTiendaComponent implements OnInit {
  private readonly svc = inject(WhatsappService);
  private readonly confirmacion = inject(ConfirmacionService);

  readonly w = signal<WhatsappTienda | null>(null);
  readonly error = signal<string | null>(null);
  readonly ok = signal<string | null>(null);
  readonly trabajando = signal(false);
  readonly problemaPrueba = signal<string | null>(null);
  telefonoPrueba = '';

  private espera: ReturnType<typeof setTimeout> | null = null;
  private vivo = true;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.vivo = false;
      if (this.espera) clearTimeout(this.espera);
    });
  }

  ngOnInit(): void {
    this.preguntar();
  }

  /** Pregunta cómo está; si espera el QR o se está conectando, vuelve a preguntar en un momento. */
  private preguntar(): void {
    if (this.espera) clearTimeout(this.espera);
    this.espera = null;
    this.svc.enlace().subscribe({
      next: (e) => this.poner(e),
      error: (e) => this.error.set(this.msg(e, 'No se pudo saber cómo está el WhatsApp de la tienda.')),
    });
  }

  private poner(e: WhatsappTienda): void {
    if (!this.vivo) return;
    this.w.set(e);
    if (e.estado === 'esperando_qr' || e.estado === 'conectando') {
      this.espera = setTimeout(() => this.preguntar(), 2500);
    }
  }

  enlazar(): void {
    this.trabajando.set(true);
    this.error.set(null);
    this.svc.enlazar().subscribe({
      next: (e) => { this.trabajando.set(false); this.poner(e); },
      error: (e) => { this.trabajando.set(false); this.error.set(this.msg(e, 'No se pudo pedir el código.')); },
    });
  }

  /** Mientras espera el QR, "Cancelar" lo deja como estaba (sin enlazar). */
  cancelar(): void {
    this.quitar();
  }

  async desenlazar(): Promise<void> {
    const si = await this.confirmacion.pedir({
      titulo: '¿Desenlazar el WhatsApp de la tienda?',
      mensaje: 'Deja de aparecer en «Dispositivos vinculados» del celular, y los tickets se vuelven a mandar a mano hasta que lo enlaces otra vez.',
      aceptar: 'Desenlazar',
      peligro: true,
    });
    if (si) this.quitar();
  }

  private quitar(): void {
    this.trabajando.set(true);
    this.error.set(null);
    this.ok.set(null);
    this.svc.desenlazar().subscribe({
      next: (e) => { this.trabajando.set(false); this.poner(e); },
      error: (e) => { this.trabajando.set(false); this.error.set(this.msg(e, 'No se pudo desenlazar.')); },
    });
  }

  probar(): void {
    this.ok.set(null);
    const n = numeroWhatsapp(this.telefonoPrueba);
    if (!n.numero) {
      this.problemaPrueba.set(n.problema ?? 'Escribe el número al que se manda la prueba (10 números).');
      return;
    }
    this.problemaPrueba.set(null);
    this.trabajando.set(true);
    this.svc.prueba(this.telefonoPrueba).subscribe({
      next: (r) => { this.trabajando.set(false); this.ok.set(`Listo: se mandó la prueba a ${r.numero}. Revisa que le haya llegado.`); },
      error: (e) => { this.trabajando.set(false); this.problemaPrueba.set(this.msg(e, 'No se pudo mandar la prueba.')); },
    });
  }

  rotulo(e: WhatsappTienda): string {
    return { apagado: 'Apagado', sin_enlazar: 'Sin enlazar', conectando: 'Conectando…', esperando_qr: 'Esperando el código', enlazado: 'Enlazado' }[e.estado];
  }

  tono(e: WhatsappTienda): string {
    return { apagado: 'gris', sin_enlazar: 'gris', conectando: 'ambar', esperando_qr: 'azul', enlazado: 'verde' }[e.estado];
  }

  /** "16 de octubre de 2026" */
  fecha(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  private msg(e: unknown, porOmision: string): string {
    return (e as { error?: { error?: { message?: string } } })?.error?.error?.message ?? porOmision;
  }
}
