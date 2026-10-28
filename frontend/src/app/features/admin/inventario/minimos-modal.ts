import { Component, DestroyRef, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InventarioService, MinimosResultado } from '../../../core/services/inventario.service';
import { Almacen } from '../../../core/models/inventario.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';

/**
 * MÍNIMO PARA VARIOS HILOS, de una vez (2026-10-16: "avisarme en Sucursal
 * Moroleón cuando queden menos de 5 paquetes de cualquier color, para que en 10
 * segundos queden protegidos todos los colores de la sucursal").
 *
 * Se elige el almacén y cuántos paquetes; el servidor lo traduce a KILOS hilo por
 * hilo con el peso promedio real de sus paquetes en ese almacén (el mismo
 * mínimo que pone la ventana de cada renglón) y, antes de guardar, la ventana
 * enseña a quiénes y con cuánto. Por omisión respeta a los que ya tenían su
 * propio mínimo. Como bajar conos, no se cierra al guardar: se puede seguir con
 * otro almacén.
 */
@Component({
  selector: 'app-minimos-modal',
  imports: [FormsModule, CantidadPipe],
  styleUrl: './modales.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
  template: `
    <!-- No se cierra al hacer clic en el fondo; sale con la ✕, "Cerrar" o Escape. -->
    <div class="modal-overlay">
      <div class="modal angosto" role="dialog" aria-modal="true" aria-labelledby="modal-minimos-titulo">
        <div class="modal-head">
          <h2 id="modal-minimos-titulo">Mínimo para varios hilos</h2>
          <button type="button" class="modal-cerrar" (click)="cerrar()" aria-label="Cerrar">✕</button>
        </div>

        <form (ngSubmit)="guardar()">
          <div class="modal-body">
            <p class="explica">
              La campana y «Por reabastecer» avisan cuando a un hilo le quedan los paquetes que digas
              <b>o menos</b>. Se pone a todos los hilos que ya maneja ese almacén, cada uno con el peso promedio de sus
              propios paquetes.
            </p>
            @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
            @if (mensaje()) { <p class="ok-msg" role="status">{{ mensaje() }}</p> }

            <div class="campos">
              <label class="field">
                Almacén
                <select name="almacen" [(ngModel)]="almacenId" (ngModelChange)="cambio()">
                  @for (a of almacenes(); track a.id) { <option [ngValue]="a.id">{{ a.nombre }}</option> }
                </select>
              </label>
              <label class="field">
                Avisarme cuando queden
                <span class="cant">
                  <input type="number" name="paquetes" min="1" max="999" step="1" [(ngModel)]="paquetes"
                         (ngModelChange)="cambio()" [attr.aria-invalid]="!paquetesValidos()" [class.invalido]="!paquetesValidos()" />
                  <span>paquetes o menos</span>
                </span>
              </label>
              <div class="field completo">
                <span id="minimos-cuales">¿A cuáles hilos?</span>
                <div class="seg" role="radiogroup" aria-labelledby="minimos-cuales">
                  <button type="button" role="radio" [class.on]="soloSinMinimo" [attr.aria-checked]="soloSinMinimo"
                          (click)="ponerSolo(true)">Solo a los que no tienen mínimo</button>
                  <button type="button" role="radio" [class.on]="!soloSinMinimo" [attr.aria-checked]="!soloSinMinimo"
                          (click)="ponerSolo(false)">A todos (reemplaza el que tenían)</button>
                </div>
              </div>
            </div>

            <div class="previa">
              @if (cargando()) {
                <p class="estado"><span class="spinner" aria-hidden="true"></span> Calculando…</p>
              } @else if (previa(); as r) {
                @if (r.renglones.length === 0) {
                  <p>Ese almacén todavía no maneja ningún hilo en paquete: no hay a quién ponerle mínimo.</p>
                } @else {
                  <p class="resumen">{{ resumen(r) }}</p>
                  <div class="tabla-scroll">
                    <table class="grid">
                      <thead><tr><th>Hilo</th><th class="num">Avisa con</th><th>Antes</th></tr></thead>
                      <tbody>
                        @for (h of r.renglones; track h.variante_id) {
                          <tr [class.tenue]="!h.cambia">
                            <td>{{ h.producto }}@if (h.calibre) { {{ ' ' + h.calibre }} }</td>
                            <td class="num">
                              @if (h.sin_peso) { <span class="muted">sin peso</span> }
                              @else if (h.se_queda) { <span class="muted">se queda</span> }
                              @else {
                                {{ h.kg | cantidad: 'kg' }}
                                @if (h.peso_estimado) { <span class="muted"> · peso del catálogo</span> }
                              }
                            </td>
                            <td class="muted">{{ h.tenia_kg > 0 ? (h.tenia_kg | cantidad: 'kg') : 'sin mínimo' }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              }
            </div>
          </div>

          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" (click)="cerrar()">Cerrar</button>
            <button type="submit" class="btn btn-primary" [disabled]="!previa()?.cambian || guardando() || cargando()">
              {{ guardando() ? 'Guardando…' : 'Poner el mínimo a ' + (previa()?.cambian ?? 0) + ' ' + ((previa()?.cambian ?? 0) === 1 ? 'hilo' : 'hilos') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: `
    .previa p { margin: 0; }
    .previa .estado { display: flex; align-items: center; gap: 8px; }
    .previa .resumen { color: var(--tinta); }
    tr.tenue td { color: var(--tinta-3); }
  `,
})
export class MinimosModal implements OnInit {
  private readonly inv = inject(InventarioService);

  readonly almacenes = input.required<Almacen[]>();
  /** El almacén con que abre (el filtro de la pantalla, si hay). */
  readonly almacenInicial = input<number | null>(null);

  readonly cerrado = output<void>();
  /** Se guardó: la pantalla recarga existencias y alertas. */
  readonly guardado = output<void>();

  almacenId: number | null = null;
  paquetes: number | null = 5;
  soloSinMinimo = true;

  readonly previa = signal<MinimosResultado | null>(null);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  private espera: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => { if (this.espera) clearTimeout(this.espera); });
  }

  ngOnInit(): void {
    const ids = this.almacenes().map((a) => a.id);
    const inicial = this.almacenInicial();
    this.almacenId = inicial && ids.includes(inicial) ? inicial : ids[0] ?? null;
    this.pedirPrevia();
  }

  paquetesValidos(): boolean {
    const n = Number(this.paquetes);
    return Number.isInteger(n) && n >= 1 && n <= 999;
  }

  ponerSolo(valor: boolean): void {
    this.soloSinMinimo = valor;
    this.cambio();
  }

  /** Cada cambio vuelve a calcular la vista previa, un momento después de la última tecla. */
  cambio(): void {
    this.mensaje.set(null);
    if (this.espera) clearTimeout(this.espera);
    this.espera = setTimeout(() => this.pedirPrevia(), 300);
  }

  pedirPrevia(): void {
    this.error.set(null);
    if (!this.almacenId || !this.paquetesValidos()) {
      this.previa.set(null);
      return;
    }
    this.cargando.set(true);
    this.inv.minimos({ almacen_id: this.almacenId, paquetes: Number(this.paquetes), solo_sin_minimo: this.soloSinMinimo })
      .subscribe({
        next: (r) => { this.cargando.set(false); this.previa.set(r); },
        error: (e) => { this.cargando.set(false); this.previa.set(null); this.error.set(this.msg(e)); },
      });
  }

  /** "Se le pone a 6 hilos: …" en palabras de tienda. */
  resumen(r: MinimosResultado): string {
    const partes: string[] = [];
    partes.push(r.cambian
      ? `Se le pone a ${r.cambian} ${r.cambian === 1 ? 'hilo' : 'hilos'}: avisa cuando le queden ${r.paquetes} ${r.paquetes === 1 ? 'paquete' : 'paquetes'} o menos, en kilos con el peso de sus propios paquetes.`
      : 'No cambia nada: todos ya tienen ese mínimo.');
    if (r.se_quedan) partes.push(`${r.se_quedan} ya ${r.se_quedan === 1 ? 'tenía su propio mínimo y se queda' : 'tenían su propio mínimo y se quedan'} igual.`);
    if (r.sin_peso) partes.push(`${r.sin_peso} no ${r.sin_peso === 1 ? 'tiene' : 'tienen'} peso: no se puede calcular.`);
    return partes.join(' ');
  }

  guardar(): void {
    const r = this.previa();
    if (!r?.cambian || !this.almacenId || this.guardando()) return;
    this.guardando.set(true);
    this.error.set(null);
    this.inv.minimos({ almacen_id: this.almacenId, paquetes: Number(this.paquetes), solo_sin_minimo: this.soloSinMinimo, guardar: true })
      .subscribe({
        next: (g) => {
          this.guardando.set(false);
          const almacen = this.almacenes().find((a) => a.id === this.almacenId)?.nombre ?? 'ese almacén';
          this.mensaje.set(`Listo: ${g.cambian} ${g.cambian === 1 ? 'hilo quedó' : 'hilos quedaron'} con mínimo en ${almacen}.`);
          this.guardado.emit();
          // Lo que quedó: ahora ya lo tienen.
          this.pedirPreviaSinBorrarMensaje();
        },
        error: (e) => { this.guardando.set(false); this.error.set(this.msg(e)); },
      });
  }

  private pedirPreviaSinBorrarMensaje(): void {
    const m = this.mensaje();
    this.pedirPrevia();
    this.mensaje.set(m);
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'No se pudo calcular el mínimo.';
  }
}
