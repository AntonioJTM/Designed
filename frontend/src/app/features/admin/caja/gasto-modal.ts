import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VentasService } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { Gasto, SesionCaja, TipoGasto } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { nuevaClave } from '../../../core/clave-unica';
import { autorizacionPedida } from '../../../shared/autorizacion/pedida';

/**
 * REGISTRAR UN GASTO de la caja (2026-10-20): de qué tipo es, cuánto, qué se
 * compró y, si la hay, la foto del ticket. Sale del cajón del turno abierto.
 * Si pasa el TOPE de su tipo (el límite es por gasto), el servidor pide
 * autorización y la ventana de autorización pregunta qué hacer; mientras, el
 * dinero no sale. La foto se sube DESPUÉS de registrarlo (si quedó pedido, se
 * sube en la lista de gastos cuando lo acepten).
 */
@Component({
  selector: 'app-gasto-modal',
  imports: [FormsModule],
  host: { '(document:keydown.escape)': 'cerrar()' },
  styles: `
    .tope { margin: 4px 0 0; font-size: 0.8125rem; color: var(--tinta-3); }
    .archivo-elegido { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.875rem; }
    .archivo-elegido b { overflow-wrap: anywhere; }
    .modal-body .aviso { margin: 12px 0 0; }
    /* El tipo con su "Nuevo tipo" al lado, y la alta ahí mismo (2026-10-20). */
    .elige-tipo { display: flex; gap: 8px; align-items: center; }
    .elige-tipo select { flex: 1 1 auto; min-width: 0; }
    .nuevo-tipo {
      display: flex; flex-direction: column; gap: 8px; padding: 10px 12px;
      border: 1px solid var(--borde); border-radius: 8px; background: var(--superficie-2);
    }
    .nuevo-tipo .botones { display: flex; gap: 8px; flex-wrap: wrap; }
    .error-campo { font-size: 0.8125rem; color: var(--peligro-t); }
  `,
  template: `
    <!-- No cierra al hacer clic en el fondo: se sale con la ✕, "Cancelar" o Escape. -->
    <div class="modal-overlay">
      <div class="modal angosto" role="dialog" aria-modal="true" aria-labelledby="modal-gasto-titulo">
        <div class="modal-head">
          <h2 id="modal-gasto-titulo">Registrar gasto</h2>
          <button type="button" class="modal-cerrar" (click)="cerrar()" aria-label="Cerrar">✕</button>
        </div>
        <form (ngSubmit)="guardar()">
          <div class="modal-body">
            <p class="muted" style="margin-top: 0; font-size: 0.85rem">
              {{ sesion().caja }} · turno de {{ sesion().usuario }}. El dinero sale de este cajón y el corte lo resta.
            </p>
            @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
            @if (tipoPedido()) { <p class="ok-msg" role="status">{{ tipoPedido() }}</p> }

            @if (tipos().length === 0 && !cargando() && !administraTipos) {
              <p class="aviso">Todavía no hay tipos de gasto: los da de alta el administrador en Caja → Gastos → Tipos de gasto.</p>
            } @else {
              <div class="form-grid">
                <!-- Un DIV y no un label: lleva el botón "Nuevo tipo" (2026-10-20, usuario: "que me deje
                     agregar más tipos de gastos" ahí mismo). -->
                <div class="field">
                  <label for="gasto-tipo">De qué es</label>
                  @if (nuevoTipo()) {
                    <!-- La alta del tipo, ahí mismo: al agregarlo queda elegido. -->
                    <div class="nuevo-tipo" role="group" aria-label="Nuevo tipo de gasto">
                      <input id="gasto-tipo" type="text" maxlength="60" [(ngModel)]="nombreTipo" name="nombre-tipo"
                             placeholder="Ej. Mantenimiento" (keydown.enter)="$event.preventDefault(); agregarTipo()" />
                      <label class="field">
                        <span>Límite por gasto <span class="muted">(vacío: todo se autoriza)</span></span>
                        <span class="campo-moneda">
                          <span>$</span>
                          <input type="number" min="0" step="0.01" [(ngModel)]="limiteTipo" name="limite-tipo"
                                 placeholder="Sin límite" (keydown.enter)="$event.preventDefault(); agregarTipo()" />
                        </span>
                      </label>
                      @if (errorTipo()) { <span class="error-campo" role="alert">{{ errorTipo() }}</span> }
                      <span class="botones">
                        <button type="button" class="btn btn-ghost btn-sm" (click)="agregarTipo()"
                                [disabled]="guardandoTipo() || nombreTipo.trim().length < 2">
                          {{ guardandoTipo() ? 'Agregando…' : 'Agregar tipo' }}
                        </button>
                        @if (tipos().length) {
                          <button type="button" class="btn btn-ghost btn-sm" (click)="nuevoTipo.set(false)">Cancelar</button>
                        }
                      </span>
                    </div>
                  } @else {
                    <span class="elige-tipo">
                      <select id="gasto-tipo" [(ngModel)]="tipoId" name="tipo" required>
                        <option [ngValue]="null" disabled>Elige…</option>
                        @for (t of tipos(); track t.id) { <option [ngValue]="t.id">{{ t.nombre }}</option> }
                      </select>
                      @if (administraTipos) {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="abrirNuevoTipo()">Nuevo tipo</button>
                      }
                    </span>
                    @if (tipo(); as t) {
                      <span class="tope">{{ t.limite != null ? 'Hasta ' + dinero(t.limite) + ' por gasto' : 'Sin límite: todo gasto de este tipo se autoriza' }}</span>
                    }
                  }
                </div>
                <label class="field">
                  Cuánto
                  <span class="campo-moneda">
                    <span>$</span>
                    <input type="number" min="0" step="0.01" [(ngModel)]="monto" name="monto" required
                           [attr.aria-invalid]="pasaCajon()" />
                  </span>
                </label>
              </div>
              <label class="field" style="margin-top: 12px">
                Qué se compró
                <input type="text" maxlength="255" [(ngModel)]="descripcion" name="descripcion" required
                       placeholder="Ej. Escobas, jerga y cloro" />
              </label>

              <div class="field" style="margin-top: 12px">
                <span>Foto del ticket o factura <span class="muted">(opcional)</span></span>
                @if (archivo) {
                  <span class="archivo-elegido">
                    <b>{{ archivo.name }}</b>
                    <button type="button" class="btn btn-ghost btn-sm" (click)="archivo = null">Quitar</button>
                  </span>
                } @else {
                  <label class="btn btn-ghost btn-sm" style="align-self: flex-start">
                    Elegir foto o PDF
                    <input type="file" class="oculto" accept="image/jpeg,image/png,image/webp,application/pdf"
                           (change)="elegir($event)" />
                  </label>
                }
              </div>

              <!-- Antes → después: cómo queda el cajón. -->
              <div class="previa-calculo">
                <div class="renglon">
                  <span class="muted">En el cajón debería haber</span>
                  <span>{{ dinero(enCajon()) }}</span>
                </div>
                @if (montoNum() > 0) {
                  <div class="renglon total">
                    <span>Quedaría</span>
                    <span [class.neg]="pasaCajon()"><b>{{ dinero(enCajon() - montoNum()) }}</b></span>
                  </div>
                }
              </div>
              @if (pasaCajon()) {
                <p class="alert" role="alert">En el cajón no alcanza para este gasto.</p>
              } @else if (pasaTope(); as t) {
                @if (autorizaDirecto) {
                  <p class="muted" style="margin: 12px 0 0; font-size: 0.875rem">
                    {{ t.limite != null ? 'Pasa el límite de ' + dinero(t.limite) + ' de ' + t.nombre : t.nombre + ' no tiene límite' }}:
                    como tú autorizas, se registra directo.
                  </p>
                } @else {
                  <p class="aviso">
                    {{ t.limite != null ? 'Pasa el límite de ' + dinero(t.limite) + ' de ' + t.nombre : t.nombre + ' no tiene límite: todo gasto de este tipo se autoriza' }}.
                    Se pide autorización y el dinero no sale hasta que la acepten (o la autorizan aquí mismo con su clave).
                  </p>
                }
              }
            }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" (click)="cerrar()">Cancelar</button>
            <button type="submit" class="btn btn-primary" [disabled]="guardando() || tipos().length === 0">
              {{ guardando() ? 'Registrando…' : montoNum() > 0 ? 'Registrar ' + dinero(montoNum()) : 'Registrar gasto' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
})
export class GastoModal implements OnInit {
  private readonly ventas = inject(VentasService);
  /** Quien autoriza registra directo lo que a otros se les autoriza. */
  private readonly auth = inject(AuthService);
  readonly autorizaDirecto = this.auth.puede('hacer:gasto_sobre_limite');
  /**
   * Da de alta tipos ahí mismo quien los administra (directo) o quien los PIDE
   * (el cajero, 2026-10-20: quien autoriza lo acepta poniéndole su límite).
   */
  // Directo, solo quien ve todas las tiendas (los tipos son de todas); pedirlo, el cajero.
  readonly administraTipos = (this.auth.puede('hacer:tipos_gasto') && this.auth.veTodasLasTiendas())
    || (this.auth.puedeOPide('hacer:tipos_gasto') && !this.auth.puede('hacer:tipos_gasto'));
  /** Se pidió la autorización de un tipo: el aviso dentro de la ventana. */
  readonly tipoPedido = signal<string | null>(null);
  readonly nuevoTipo = signal(false);
  readonly guardandoTipo = signal(false);
  readonly errorTipo = signal<string | null>(null);
  nombreTipo = '';
  limiteTipo: number | null = null;
  /** La llave de un solo uso: un doble clic no registra el gasto dos veces. */
  private clave = nuevaClave();

  readonly sesion = input.required<SesionCaja>();
  readonly cerrado = output<void>();
  /** Se registró: la caja pinta el turno con el cajón actualizado. */
  readonly guardado = output<{ sesion: SesionCaja; gasto: Gasto; aviso: string }>();
  /** Quedó pedida la autorización: la caja lo dice. */
  readonly pedido = output<string>();

  readonly tipos = signal<TipoGasto[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  tipoId: number | null = null;
  monto: number | null = null;
  descripcion = '';
  archivo: File | null = null;

  ngOnInit(): void {
    this.ventas.tiposGasto().subscribe({
      next: (t) => {
        this.tipos.set(t);
        if (t.length === 1) this.tipoId = t[0].id;
        // Sin ningún tipo, quien los administra empieza dando de alta el primero.
        if (t.length === 0 && this.administraTipos) this.nuevoTipo.set(true);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  // Métodos y no `computed`: leen campos de ngModel.
  tipo(): TipoGasto | null {
    return this.tipos().find((t) => t.id === this.tipoId) ?? null;
  }
  montoNum(): number {
    return Math.round(Number(this.monto ?? 0) * 100) / 100;
  }
  enCajon(): number {
    return Number(this.sesion().esperado_actual ?? 0);
  }
  pasaCajon(): boolean {
    return this.montoNum() > this.enCajon() + 0.001;
  }
  /** El tipo, si este gasto se autoriza: pasa su tope, o su tipo no tiene (todo se autoriza). */
  pasaTope(): TipoGasto | null {
    const t = this.tipo();
    if (!t || !(this.montoNum() > 0)) return null;
    return t.limite == null || this.montoNum() > t.limite + 0.001 ? t : null;
  }

  abrirNuevoTipo(): void {
    this.tipoPedido.set(null);
    this.nombreTipo = '';
    this.limiteTipo = null;
    this.errorTipo.set(null);
    this.nuevoTipo.set(true);
  }

  /** Lo da de alta y lo deja elegido para este gasto. */
  agregarTipo(): void {
    const nombre = this.nombreTipo.trim();
    if (nombre.length < 2) {
      this.errorTipo.set('Escribe el nombre del tipo (al menos 2 letras).');
      return;
    }
    const n = Number(this.limiteTipo);
    const limite = this.limiteTipo === null || (this.limiteTipo as unknown) === '' || !(n > 0) ? null : Math.round(n * 100) / 100;
    this.guardandoTipo.set(true);
    this.errorTipo.set(null);
    this.ventas.crearTipoGasto({ nombre, limite }).subscribe({
      next: (t) => {
        this.guardandoTipo.set(false);
        this.tipos.set([...this.tipos(), t].sort((a, b) => a.nombre.localeCompare(b.nombre)));
        this.tipoId = t.id;
        this.nuevoTipo.set(false);
      },
      error: (e) => {
        this.guardandoTipo.set(false);
        // Lo PIDIÓ (el cajero): entra cuando quien autoriza lo acepte con su límite.
        const pedida = autorizacionPedida(e);
        if (pedida) {
          this.nuevoTipo.set(false);
          this.tipoPedido.set(`Se pidió dar de alta «${nombre}». Cuando lo autoricen (con su límite) aparece aquí para elegirlo.`);
          return;
        }
        this.errorTipo.set(this.msg(e));
      },
    });
  }

  elegir(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.archivo = input.files?.[0] ?? null;
    input.value = '';
  }

  guardar(): void {
    const descripcion = this.descripcion.trim();
    if (!this.tipoId) return this.error.set('Elige de qué es el gasto.');
    if (!(this.montoNum() > 0)) return this.error.set('Escribe cuánto fue.');
    if (descripcion.length < 3) return this.error.set('Escribe qué se compró o para qué fue.');
    if (this.pasaCajon()) return this.error.set(`En el cajón debería haber ${this.dinero(this.enCajon())}: no alcanza.`);
    this.error.set(null);
    this.guardando.set(true);
    const archivo = this.archivo;
    this.ventas
      .registrarGasto(this.sesion().id, { tipo_gasto_id: this.tipoId, monto: this.montoNum(), descripcion }, this.clave)
      .subscribe({
        next: ({ gasto, sesion }) => {
          this.clave = nuevaClave();
          const listo = `Gasto de ${gasto.tipo} por ${this.dinero(gasto.monto)} registrado. En el cajón debería haber ${this.dinero(sesion.esperado_actual)}.`;
          if (!archivo) {
            this.guardando.set(false);
            this.guardado.emit({ sesion, gasto, aviso: listo });
            return;
          }
          this.ventas.subirFotoGasto(gasto.id, archivo).subscribe({
            next: (g) => {
              this.guardando.set(false);
              this.guardado.emit({ sesion, gasto: g, aviso: `${listo} Con la foto del ticket.` });
            },
            error: (e) => {
              this.guardando.set(false);
              this.guardado.emit({ sesion, gasto, aviso: `${listo} La foto no se subió (${this.msg(e)}): súbela en la lista de gastos.` });
            },
          });
        },
        error: (e) => {
          this.guardando.set(false);
          // Se pidió la autorización: ya se dijo en su ventana; esta se cierra.
          const pedida = autorizacionPedida(e);
          if (pedida) {
            this.pedido.emit(archivo ? `${pedida} La foto del ticket súbela en la lista de gastos cuando la acepten.` : pedida);
            this.cerrar();
            return;
          }
          this.error.set(this.msg(e));
        },
      });
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  dinero(v: unknown): string {
    return Number(v ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
