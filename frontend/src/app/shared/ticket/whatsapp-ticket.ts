import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PaqueteWhatsapp, WhatsappService, WhatsappTienda } from '../../core/services/whatsapp.service';
import { ClientesService } from '../../core/services/clientes.service';
import { telefonoLegible } from './ticket';
import { guardarArchivo } from '../descargar';
import { enlaceWhatsapp, numeroWhatsapp } from './whatsapp';

/**
 * La ventana de MANDAR POR WHATSAPP (ver `WhatsappService`). Va una sola vez, en
 * la raíz de la aplicación.
 *
 * DOS MANERAS:
 *   · DIRECTO (2026-10-16, "que no tenga que estarlo abriendo"): si el WhatsApp
 *     de la tienda está enlazado en Configuración, "Mandar por WhatsApp" le
 *     manda el PDF al cliente desde el servidor, sin abrir nada. Pide su número.
 *   · A MANO (sin enlazar, o "Bajarlo y mandarlo yo"): baja el PDF y abre el chat
 *     del cliente con un mensaje corto; el PDF se arrastra al chat. Sin número,
 *     WhatsApp pide elegir el contacto. En el celular, el menú de compartir.
 * El número sale de su expediente y se puede corregir. UN ENTER (2026-10-16):
 * enlazado y con un número válido en su expediente, no se enseña el campo —dice
 * "Le llega a 775 …" con "Cambiar número"— y el cursor queda en "Mandar por
 * WhatsApp" en cuanto el PDF está listo: Enter lo manda, y otro Enter cierra. Si la venta tiene cliente
 * y se escribe un número que no está en su expediente, una casilla ya marcada
 * lo GUARDA ahí al mandarlo (2026-10-16: "que la base de clientes se llene sola
 * desde la caja"); el que tenía pasa a segundo teléfono, si había lugar.
 *
 * Como todos los modales, no se cierra al tocar el fondo; sale con la ✕,
 * "Cancelar"/"Listo" o Escape.
 */
@Component({
  selector: 'app-whatsapp-ticket',
  imports: [FormsModule],
  host: { '(document:keydown.escape)': 'alEscape()' },
  template: `
    @if (svc.actual(); as e) {
      <div class="modal-overlay whatsapp-fondo">
        <div class="modal whatsapp" role="dialog" aria-modal="true" aria-labelledby="whatsapp-titulo">
          <div class="modal-head">
            <h2 id="whatsapp-titulo">Mandar por WhatsApp</h2>
            <button type="button" class="modal-cerrar" (click)="cerrar()" aria-label="Cerrar">✕</button>
          </div>

          <form (ngSubmit)="mandar()">
            <div class="modal-body columna">
              <p class="que">
                <b>{{ e.titulo }}</b>
                @if (e.paquete?.cliente; as c) { <span class="muted"> · {{ c }}</span> }
              </p>
              @if (e.error) { <p class="alert" role="alert">{{ e.error }}</p> }
              @if (errorEnvio()) { <p class="alert" role="alert">{{ errorEnvio() }}</p> }
              @if (errorGuardar()) { <p class="alert" role="alert">{{ errorGuardar() }}</p> }

              <!-- El número, ya que se sabe cómo se manda y está el PDF (así no brinca la ventana). -->
              @if (tiendaSabida() && e.paquete && numeroListo(e.paquete)) {
                <div class="destino">
                  <span>Le llega a <b>{{ legible(e.paquete.telefono) }}</b>, el número de su expediente.</span>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="cambiarNumero()">Cambiar número</button>
                </div>
              } @else if (tiendaSabida() && (e.paquete || e.error) && (directo() || !esTelefono)) {
                <label class="field">
                  <span>Su WhatsApp</span>
                  <input #campoTelefono type="tel" name="telefono" inputmode="tel" autocomplete="off" placeholder="10 números"
                         [ngModel]="telefono()" (ngModelChange)="teclear($event)" [disabled]="hecho() === 'enviado'"
                         [class.invalido]="!!problema()" [attr.aria-invalid]="!!problema()"
                         aria-describedby="whatsapp-ayuda" />
                  <span id="whatsapp-ayuda" class="ayuda" [class.mal]="!!problema()">{{ problema() ?? ayuda() }}</span>
                </label>
                @if (e.paquete && ofrecerGuardar(e.paquete)) {
                  <label class="field check guardar-numero">
                    <input type="checkbox" name="guardar" [ngModel]="guardarNumero()" (ngModelChange)="guardarNumero.set($event)" />
                    <span>{{ textoGuardar(e.paquete) }}</span>
                  </label>
                }
              }

              <p class="estado" role="status">
                @if (!e.paquete && !e.error) {
                  <span class="spinner" aria-hidden="true"></span> Preparando el PDF…
                } @else if (enviando()) {
                  <span class="spinner" aria-hidden="true"></span> Mandándolo…
                } @else if (e.paquete && hecho() === 'enviado') {
                  Listo: se le mandó «{{ e.paquete.archivo }}» a {{ enviadoA() }}.@if (numeroGuardado()) { El número quedó en su expediente. }
                } @else if (e.paquete && hecho() === 'bajado') {
                  Listo: arrastra «{{ e.paquete.archivo }}» (está en Descargas) al chat de WhatsApp y mándalo.@if (numeroGuardado()) { El número quedó en su expediente. }
                } @else if (e.paquete && hecho() === 'compartido') {
                  Listo: se compartió «{{ e.paquete.archivo }}».
                } @else if (e.paquete) {
                  El PDF está listo: «{{ e.paquete.archivo }}».@if (numeroListo(e.paquete)) { Aprieta Enter para mandarlo. }
                }
              </p>

              @if (e.paquete && !hecho()) {
                @if (directo()) {
                  <p class="pasos-texto">
                    Le llega desde el WhatsApp de la tienda ({{ tienda()?.numero }}) con este mensaje:
                    <q>{{ e.paquete.mensaje }}</q>
                  </p>
                } @else if (esTelefono) {
                  <p class="muted pasos-texto">Se abre el menú de compartir: elige WhatsApp y su chat. El PDF ya va pegado.</p>
                } @else {
                  <ol class="pasos">
                    <li>Se baja el PDF a la computadora.</li>
                    <li>Se abre su chat con este mensaje: <q>{{ e.paquete.mensaje }}</q></li>
                    <li>Arrastras el PDF al chat y lo mandas.</li>
                  </ol>
                }
              }
              @if (notaEnlace(); as n) { <p class="muted nota-enlace">{{ n }}</p> }
            </div>

            <div class="modal-foot">
              @if (hecho() === 'enviado' || hecho() === 'compartido') {
                <button #botonListo type="button" class="btn btn-primary" (click)="cerrar()">Listo</button>
              } @else if (hecho() === 'bajado') {
                <button type="button" class="btn btn-ghost" (click)="mandarAMano()">Bajar y abrir otra vez</button>
                <button type="button" class="btn btn-primary" (click)="cerrar()">Listo</button>
              } @else if (directo()) {
                <button type="button" class="btn btn-ghost" (click)="cerrar()">Cancelar</button>
                <button type="button" class="btn btn-ghost" [disabled]="!e.paquete || enviando()" (click)="pasarAMano()">
                  Bajarlo y mandarlo yo
                </button>
                <button #botonMandar type="submit" class="btn btn-primary" [disabled]="!e.paquete || enviando()">
                  {{ enviando() ? 'Mandando…' : 'Mandar por WhatsApp' }}
                </button>
              } @else {
                <button type="button" class="btn btn-ghost" (click)="cerrar()">Cancelar</button>
                <button type="submit" class="btn btn-primary" [disabled]="!e.paquete">
                  {{ esTelefono ? 'Compartir el PDF' : 'Bajar el PDF y abrir WhatsApp' }}
                </button>
              }
            </div>
          </form>
        </div>
      </div>
    }
  `,
  styles: `
    /* Arriba de la página y de cualquier modal de pantalla, abajo de la confirmación (60). */
    .whatsapp-fondo { z-index: 55; align-items: center; }
    .whatsapp { max-width: 500px; }
    .que { margin: 0; overflow-wrap: anywhere; }
    .ayuda { font-size: 0.8125rem; color: var(--tinta-3); }
    .ayuda.mal { color: var(--peligro-t); }
    .estado { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 0.875rem; }
    .estado:empty { display: none; }
    .pasos { margin: 0; padding-left: 1.25rem; font-size: 0.875rem; color: var(--tinta-2); display: grid; gap: 4px; }
    .pasos q, .pasos-texto q { color: var(--tinta); overflow-wrap: anywhere; }
    .pasos-texto { margin: 0; font-size: 0.875rem; color: var(--tinta-2); }
    .nota-enlace { margin: 0; font-size: 0.8125rem; }
    .guardar-numero span { font-size: 0.875rem; }
    .destino { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; font-size: 0.875rem; }
    .destino > span { flex: 1 1 14rem; min-width: 0; }
  `,
})
export class WhatsappTicket {
  readonly svc = inject(WhatsappService);
  private readonly clientes = inject(ClientesService);
  private readonly injector = inject(Injector);
  private readonly botonMandar = viewChild<ElementRef<HTMLButtonElement>>('botonMandar');
  private readonly botonListo = viewChild<ElementRef<HTMLButtonElement>>('botonListo');
  private readonly campoTelefono = viewChild<ElementRef<HTMLInputElement>>('campoTelefono');

  readonly telefono = signal('');
  /** Si la persona ya escribió el número: entonces no se le cambia al llegar el PDF. */
  private tocado = false;
  readonly hecho = signal<'enviado' | 'bajado' | 'compartido' | null>(null);
  /** Lo que no sirve del número, solo después de intentar mandar o mientras se corrige. */
  private readonly revisar = signal(false);
  /** El WhatsApp de la tienda: si está enlazado, se manda directo. null mientras se pregunta. */
  readonly tienda = signal<WhatsappTienda | null>(null);
  /** "Bajarlo y mandarlo yo": aunque esté enlazado, se manda a mano. */
  private readonly aMano = signal(false);
  /** Ya se sabe si el WhatsApp de la tienda está enlazado (o no se pudo saber). */
  readonly tiendaSabida = signal(false);
  /** "Cambiar número": se enseña el campo aunque su número sirva. */
  private readonly cambiando = signal(false);
  /** El cursor ya se puso en "Mandar" en esta ventana (una vez). */
  private enfocadaPara = 0;
  readonly enviando = signal(false);
  readonly enviadoA = signal<string | null>(null);
  readonly errorEnvio = signal<string | null>(null);
  /** "Guardar este número en su expediente" (marcada de entrada). */
  readonly guardarNumero = signal(true);
  readonly numeroGuardado = signal(false);
  readonly errorGuardar = signal<string | null>(null);

  readonly directo = computed(() => this.tienda()?.estado === 'enlazado' && !this.aMano());
  readonly problema = computed(() => {
    if (!this.revisar()) return null;
    const n = numeroWhatsapp(this.telefono());
    if (n.problema) return n.problema;
    return this.directo() && !n.numero ? 'Escribe su número de WhatsApp: se le manda directo.' : null;
  });

  /** En un celular o tableta no se arrastra: se comparte con el menú del teléfono. */
  readonly esTelefono =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches &&
    typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  private abierta = 0;

  constructor() {
    effect(() => {
      const e = this.svc.actual();
      if (!e) return;
      if (e.id !== this.abierta) {
        // Otra ventana: empieza de cero y pregunta si el WhatsApp de la tienda está enlazado.
        this.abierta = e.id;
        this.tocado = false;
        this.telefono.set('');
        this.hecho.set(null);
        this.revisar.set(false);
        this.aMano.set(false);
        this.enviando.set(false);
        this.enviadoA.set(null);
        this.errorEnvio.set(null);
        this.tienda.set(null);
        this.tiendaSabida.set(false);
        this.cambiando.set(false);
        this.guardarNumero.set(true);
        this.numeroGuardado.set(false);
        this.errorGuardar.set(null);
        const id = e.id;
        this.svc.estadoTienda().subscribe({
          next: (t) => { if (this.abierta === id) { this.tienda.set(t); this.tiendaSabida.set(true); } },
          // Sin respuesta: se manda a mano, como antes.
          error: () => { if (this.abierta === id) this.tiendaSabida.set(true); },
        });
      }
      if (e.paquete && !this.tocado && !this.telefono()) this.telefono.set(e.paquete.telefono ?? '');
    });

    // UN ENTER: listo el PDF, enlazado y con su número, el cursor va a "Mandar".
    effect(() => {
      const e = this.svc.actual();
      if (!e?.paquete || this.hecho() || !this.numeroListo(e.paquete) || this.enfocadaPara === e.id) return;
      this.enfocadaPara = e.id;
      afterNextRender(() => this.botonMandar()?.nativeElement.focus(), { injector: this.injector });
    });
  }

  /**
   * ¿Se manda sin enseñar el campo? Enlazado, sin "Cambiar número", sin haber
   * tecleado nada, y con un número de su expediente que sirve.
   */
  numeroListo(p: PaqueteWhatsapp): boolean {
    return this.directo() && !this.cambiando() && !this.tocado && !!numeroWhatsapp(p.telefono).numero;
  }

  legible(t: string | null): string {
    return t ? telefonoLegible(t) : '';
  }

  /** Enseña el campo con su número, para corregirlo, y le pone el cursor. */
  cambiarNumero(): void {
    this.cambiando.set(true);
    afterNextRender(() => {
      const campo = this.campoTelefono()?.nativeElement;
      campo?.focus();
      campo?.select();
    }, { injector: this.injector });
  }

  ayuda(): string {
    if (this.directo()) return 'Le llega directo, desde el WhatsApp de la tienda.';
    return this.telefono().trim() ? 'Se abre el chat con este número.' : 'Sin número: eliges el contacto en WhatsApp.';
  }

  /** Por qué no se manda directo, cuando no se puede (solo si vale la pena decirlo). */
  notaEnlace(): string | null {
    if (this.hecho() || this.aMano()) return null;
    const t = this.tienda();
    if (t?.estado === 'conectando') return 'El WhatsApp de la tienda se está volviendo a conectar: mientras, bájalo y mándalo tú.';
    if (t?.estado === 'sin_enlazar' || t?.estado === 'esperando_qr') {
      return 'Para mandarlo directo, sin abrir WhatsApp, enlaza el de la tienda en Configuración.';
    }
    return null;
  }

  /**
   * ¿Se le ofrece guardar el número? Solo con cliente, con un número que sirve y
   * que NO está ya en su expediente (ni como primero ni como segundo).
   */
  ofrecerGuardar(p: PaqueteWhatsapp): boolean {
    if (!p.clienteId || this.numeroGuardado()) return false;
    const escrito = numeroWhatsapp(this.telefono()).numero;
    if (!escrito) return false;
    const suyos = [p.telefonoPrincipal, p.telefonoAlt].map((t) => numeroWhatsapp(t).numero);
    return !suyos.includes(escrito);
  }

  textoGuardar(p: PaqueteWhatsapp): string {
    const quien = p.cliente ?? 'el cliente';
    if (!p.telefonoPrincipal?.trim()) return `Guardar este número en el expediente de ${quien}`;
    const viejo = telefonoLegible(p.telefonoPrincipal);
    return p.telefonoAlt?.trim()
      ? `Guardarlo en el expediente de ${quien} (reemplaza al ${viejo})`
      : `Guardarlo en el expediente de ${quien} (el ${viejo} que tenía queda como segundo teléfono)`;
  }

  /** Lo guarda en su expediente, si la casilla quedó marcada. No detiene el envío si falla. */
  private guardarEnExpediente(p: PaqueteWhatsapp): void {
    if (!this.guardarNumero() || !this.ofrecerGuardar(p)) return;
    const n = numeroWhatsapp(this.telefono()).numero!;
    // Un celular de México se guarda con sus 10 números, como los demás.
    const nuevo = n.startsWith('52') && n.length === 12 ? n.slice(2) : this.telefono().trim();
    const cambios: { telefono: string; telefono_alt?: string } = { telefono: nuevo };
    if (p.telefonoPrincipal?.trim() && !p.telefonoAlt?.trim()) cambios.telefono_alt = p.telefonoPrincipal.trim();
    this.errorGuardar.set(null);
    this.clientes.actualizar(p.clienteId!, cambios).subscribe({
      next: () => this.numeroGuardado.set(true),
      error: (e) => this.errorGuardar.set(
        'Se mandó, pero el número no se pudo guardar en su expediente: ' +
        ((e as { error?: { error?: { message?: string } } })?.error?.error?.message ?? 'inténtalo desde su expediente.')
      ),
    });
  }

  teclear(valor: string): void {
    this.tocado = true;
    this.telefono.set(valor ?? '');
    this.errorEnvio.set(null);
  }

  mandar(): void {
    if (this.directo()) this.mandarDirecto();
    else void this.mandarAMano();
  }

  /** Desde el WhatsApp de la tienda: el servidor le manda el PDF. */
  mandarDirecto(): void {
    const p = this.svc.actual()?.paquete;
    if (!p || this.enviando()) return;
    this.revisar.set(true);
    if (this.problema()) return;
    this.enviando.set(true);
    this.errorEnvio.set(null);
    this.svc.enviar(p, this.telefono()).subscribe({
      next: (r) => {
        this.enviando.set(false);
        this.enviadoA.set(r.numero);
        this.hecho.set('enviado');
        this.guardarEnExpediente(p);
        // Otro Enter cierra la ventana.
        afterNextRender(() => this.botonListo()?.nativeElement.focus(), { injector: this.injector });
      },
      error: (e) => {
        this.enviando.set(false);
        this.errorEnvio.set(
          (e as { error?: { error?: { message?: string } } })?.error?.error?.message
            ?? 'No se pudo mandar. Vuelve a intentarlo, o bájalo y mándalo tú.'
        );
      },
    });
  }

  /** "Bajarlo y mandarlo yo": deja de mandarlo directo y lo hace a mano. */
  pasarAMano(): void {
    this.aMano.set(true);
    this.errorEnvio.set(null);
    void this.mandarAMano();
  }

  /**
   * Baja el PDF y abre el chat, en el mismo clic: el navegador solo deja abrir
   * otra pestaña en el momento en que se aprieta el botón.
   */
  async mandarAMano(): Promise<void> {
    const p = this.svc.actual()?.paquete;
    if (!p) return;
    if (this.esTelefono) {
      const archivo = new File([p.pdf], p.archivo, { type: 'application/pdf' });
      if (navigator.canShare({ files: [archivo] })) {
        try {
          await navigator.share({ files: [archivo], title: p.titulo, text: p.mensaje });
          this.hecho.set('compartido');
          return;
        } catch (err) {
          // Lo cerró sin elegir: no pasó nada.
          if ((err as { name?: string })?.name === 'AbortError') return;
        }
      }
    }
    this.revisar.set(true);
    const n = numeroWhatsapp(this.telefono());
    if (n.problema) return;
    guardarArchivo(p.pdf, p.archivo);
    window.open(enlaceWhatsapp(n.numero, p.mensaje), '_blank', 'noopener');
    this.hecho.set('bajado');
    this.guardarEnExpediente(p);
  }

  alEscape(): void {
    if (this.svc.actual()) this.cerrar();
  }

  cerrar(): void {
    this.svc.cerrar();
  }
}
