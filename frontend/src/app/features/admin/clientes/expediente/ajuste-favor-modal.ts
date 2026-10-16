import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClientesService } from '../../../../core/services/clientes.service';
import { AjusteSaldoFavor } from '../../../../core/models/clientes.models';
import { ApiError } from '../../../../core/models/auth.models';
import { DineroPipe } from '../../../../shared/dinero.pipe';

/**
 * AJUSTAR SU SALDO A FAVOR a mano (2026-10-16: "que sea ajuste de saldo a favor:
 * se le puede quitar o agregar"). Para lo que no es una devolución ni un
 * anticipo: corregir un error, quitarle lo que ya se le dio por fuera… Queda en
 * su historial como "Ajuste" con su motivo y quién lo hizo.
 *
 * Solo lo ofrece quien tiene «Corregir deuda» (`hacer:corregir_deuda`); el
 * servidor también lo exige. El motivo es obligatorio y no se le puede quitar
 * más de lo que tiene.
 */
@Component({
  selector: 'app-ajuste-favor-modal',
  imports: [FormsModule, DineroPipe],
  host: { '(document:keydown.escape)': 'cerrar()' },
  template: `
    <!-- No se cierra al hacer clic en el fondo; sale con la ✕, "Cancelar" o Escape. -->
    <div class="modal-overlay">
      <div class="modal angosto" role="dialog" aria-modal="true" aria-labelledby="modal-ajuste-favor-titulo">
        <div class="modal-head">
          <h2 id="modal-ajuste-favor-titulo">Ajustar su saldo a favor</h2>
          <button type="button" class="modal-cerrar" (click)="cerrar()" aria-label="Cerrar">✕</button>
        </div>

        <form (ngSubmit)="guardar()">
          <div class="modal-body">
            <div class="columna" style="gap: 16px">
              <p class="muted">
                Para corregir su saldo a favor a mano. Si regresó mercancía es una devolución, y si dejó
                dinero es un anticipo: esos van por su botón.
                <b style="color: var(--tinta)">{{ nombre() }}</b> tiene hoy {{ saldo() | dinero }} a favor.
              </p>
              @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }

              <div class="seg" role="radiogroup" aria-label="Sentido del ajuste">
                <label [class.on]="sentido === 'quita'">
                  <input type="radio" name="sentido" value="quita" [(ngModel)]="sentido" />
                  Quitarle
                  <span class="muted">se le dio de más o ya se le pagó</span>
                </label>
                <label [class.on]="sentido === 'agrega'">
                  <input type="radio" name="sentido" value="agrega" [(ngModel)]="sentido" />
                  Agregarle
                  <span class="muted">le faltó algo a su favor</span>
                </label>
              </div>

              <div class="form-grid">
                <label class="field">
                  De cuánto
                  <span class="moneda">
                    <span aria-hidden="true">$</span>
                    <input type="number" min="0.01" step="0.01" [(ngModel)]="monto" name="monto" />
                  </span>
                </label>
                <label class="field">
                  Motivo
                  <input type="text" maxlength="255" [(ngModel)]="motivo" name="motivo"
                         placeholder="Se le regresó en efectivo el 10 de octubre" />
                  <span class="ayuda">Queda escrito en su historial.</span>
                </label>
              </div>

              @if (monto) {
                <div class="dato">
                  <span>Le quedaría a favor</span>
                  <span [class.neg]="saldoTras() < 0"><b>{{ saldoTras() | dinero }}</b></span>
                </div>
              }
            </div>
          </div>

          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" (click)="cerrar()">Cancelar</button>
            <button type="submit" class="btn btn-primary" [disabled]="guardando()">
              {{ guardando() ? 'Guardando…' : 'Registrar el ajuste' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: `
    .moneda { position: relative; display: block; }
    .moneda > span { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--tinta-3); font-weight: 600; }
    .moneda > input { padding-left: 26px; }
    .seg > label { flex-direction: column; gap: 2px; padding: 10px 12px; min-height: 64px; text-align: center; }
    .seg > label .muted { font-size: 0.75rem; font-weight: 400; }
  `,
})
export class AjusteFavorModal {
  private readonly clientes = inject(ClientesService);

  readonly clienteId = input.required<number>();
  readonly nombre = input.required<string>();
  readonly saldo = input.required<number>();

  readonly cerrado = output<void>();
  readonly registrado = output<AjusteSaldoFavor>();

  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  sentido: 'quita' | 'agrega' = 'quita';
  monto: number | null = null;
  motivo = '';

  /** Cuánto le quedaría. Método, no `computed`: lee campos de ngModel. */
  saldoTras(): number {
    const m = Number(this.monto ?? 0);
    const s = Number(this.saldo());
    return Math.round((this.sentido === 'quita' ? s - m : s + m) * 100) / 100;
  }

  guardar(): void {
    const m = Number(this.monto ?? 0);
    const motivo = this.motivo.trim();
    if (!(m > 0)) {
      this.error.set('Pon de cuánto es el ajuste.');
      return;
    }
    if (motivo.length < 3) {
      this.error.set('Escribe el motivo: un saldo que cambia sin explicación no se puede aclarar después.');
      return;
    }
    if (this.saldoTras() < 0) {
      this.error.set(`No se le puede quitar más de lo que tiene a favor (${this.saldo().toFixed(2)}).`);
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.clientes.ajustarSaldoFavor(this.clienteId(), this.sentido === 'quita' ? -m : m, motivo).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.registrado.emit(r);
        this.cerrar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
