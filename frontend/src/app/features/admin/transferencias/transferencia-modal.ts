import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TransferenciasService } from '../../../core/services/transferencias.service';
import { EstadoTransferencia, Transferencia } from '../../../core/models/transferencias.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';

/**
 * CORREGIR UNA TRANSFERENCIA (2026-10-20): a qué cuenta llegó, su número de
 * operación, si ya se vio en el banco y si se facturó. El número de operación
 * se corrige donde vive (la venta, el abono o el anticipo). No cierra al tocar
 * el fondo: sale con la ✕, "Cancelar" o Escape.
 */
@Component({
  selector: 'app-transferencia-modal',
  imports: [FormsModule, DineroPipe, FolioPipe, FechaPipe],
  host: { '(document:keydown.escape)': 'cerrado.emit()' },
  template: `
    <div class="modal-overlay">
      <div class="modal angosto" role="dialog" aria-modal="true" aria-labelledby="transf-titulo">
        <form (ngSubmit)="guardar()">
          <div class="modal-head">
            <h2 id="transf-titulo">Transferencia de {{ t().cliente || 'cliente de paso' }}</h2>
            <button type="button" class="modal-cerrar" (click)="cerrado.emit()" aria-label="Cerrar">✕</button>
          </div>
          <div class="modal-body columna">
            @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
            <p class="resumen">
              <b>{{ t().importe | dinero }}</b> · {{ t().fecha | fecha }}
              @if (t().ventas.length) {
                · {{ t().ventas.length === 1 ? 'venta' : 'ventas' }}
                @for (v of t().ventas; track v.id; let ultimo = $last) { <span class="mono">{{ v.folio | folio }}</span>@if (!ultimo) {, } }
              } @else {
                · {{ t().de === 'anticipo' ? 'anticipo' : 'abono a su cuenta' }}
              }
            </p>
            <label class="field">
              <span>¿A qué cuenta llegó?</span>
              <select [(ngModel)]="cuentaId" name="cuenta">
                <option [ngValue]="null">Sin cuenta</option>
                @for (c of svc.cuentas() ?? []; track c.id) { <option [ngValue]="c.id">{{ svc.nombreCuenta(c) }}</option> }
                @if (cuentaGuardadaInactiva()) {
                  <option [ngValue]="t().cuenta_bancaria_id">{{ svc.nombreCuenta({ banco: t().cuenta, cuenta_ultimos: t().cuenta_ultimos }) }} (desactivada)</option>
                }
              </select>
            </label>
            <label class="field">
              <span>No. de operación <span class="muted">(opcional)</span></span>
              <input type="text" [(ngModel)]="referencia" name="referencia" maxlength="120" autocomplete="off"
                     placeholder="El folio que trae el comprobante" />
            </label>
            <div class="field">
              <span>¿Ya se vio en el banco?</span>
              <div class="seg" role="radiogroup" aria-label="Estado">
                <button type="button" role="radio" [class.on]="estado === 'por_revisar'" [attr.aria-checked]="estado === 'por_revisar'"
                        (click)="estado = 'por_revisar'">Por revisar</button>
                <button type="button" role="radio" [class.on]="estado === 'procesada'" [attr.aria-checked]="estado === 'procesada'"
                        (click)="estado = 'procesada'">Procesada</button>
              </div>
              @if (t().revisada_por && t().estado === 'procesada') {
                <span class="ayuda">La marcó {{ t().revisada_por }} el {{ t().revisada_en | fecha }}.</span>
              }
            </div>
            <label class="field check">
              <input type="checkbox" [(ngModel)]="facturada" name="facturada" />
              <span>Facturada</span>
            </label>
            @if (t().facturada && t().facturada_por) {
              <span class="ayuda">La marcó {{ t().facturada_por }} el {{ t().facturada_en | fecha }}.</span>
            }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" (click)="cerrado.emit()">Cancelar</button>
            <button type="submit" class="btn btn-primary" [disabled]="guardando()">
              {{ guardando() ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: `
    .resumen { margin: 0; font-size: 0.875rem; color: var(--tinta-2); font-variant-numeric: tabular-nums; }
    .resumen b { color: var(--tinta); }
    .resumen .mono { font-family: var(--mono); font-size: 0.8125rem; }
  `,
})
export class TransferenciaModal implements OnInit {
  protected readonly svc = inject(TransferenciasService);
  readonly transferencia = input.required<Transferencia>();
  readonly cerrado = output<void>();
  readonly guardado = output<Transferencia>();

  readonly error = signal<string | null>(null);
  readonly guardando = signal(false);

  cuentaId: number | null = null;
  referencia = '';
  estado: EstadoTransferencia = 'por_revisar';
  facturada = false;

  t(): Transferencia {
    return this.transferencia();
  }

  ngOnInit(): void {
    const t = this.transferencia();
    this.cuentaId = t.cuenta_bancaria_id;
    this.referencia = t.referencia ?? '';
    this.estado = t.estado;
    this.facturada = t.facturada;
    this.svc.cargarCuentas();
  }

  /** La cuenta que ya tenía y que después se desactivó: se enseña para no perderla. */
  cuentaGuardadaInactiva(): boolean {
    const id = this.transferencia().cuenta_bancaria_id;
    return id != null && !(this.svc.cuentas() ?? []).some((c) => c.id === id);
  }

  guardar(): void {
    if (this.guardando()) return;
    this.guardando.set(true);
    this.error.set(null);
    this.svc.actualizar(this.transferencia().clave, {
      cuenta_bancaria_id: this.cuentaId,
      referencia: this.referencia.trim() || null,
      estado: this.estado,
      facturada: this.facturada,
    }).subscribe({
      next: (t) => {
        this.guardando.set(false);
        this.guardado.emit(t);
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'No se pudo guardar.');
      },
    });
  }
}
