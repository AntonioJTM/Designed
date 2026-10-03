import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClientesService } from '../../../core/services/clientes.service';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';

/**
 * Corregir la deuda de un cliente: para lo que NO es un abono. Condonar una
 * deuda, quitar un cargo capturado de más o agregar uno que faltó. Queda en el
 * libro de crédito como 'ajuste' con su motivo; el cargo original no se borra.
 *
 * Solo lo ofrece quien tiene «Corregir la deuda de un cliente»
 * (`hacer:corregir_deuda`); el servidor también lo exige. El motivo es
 * obligatorio: un saldo que cambia sin explicación no se puede aclarar después.
 */
@Component({
  selector: 'app-ajuste-modal',
  imports: [FormsModule, DineroPipe],
  templateUrl: './ajuste-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
  styles: `
    .moneda { position: relative; display: block; }
    .moneda > span { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--tinta-3); font-weight: 600; }
    .moneda > input { padding-left: 26px; }
    .seg > label { flex-direction: column; gap: 2px; padding: 10px 12px; min-height: 64px; text-align: center; }
    .seg > label .muted { font-size: 12px; font-weight: 400; }
  `,
})
export class AjusteModal {
  private readonly clientes = inject(ClientesService);

  readonly clienteId = input.required<number>();
  readonly nombre = input.required<string>();
  readonly saldo = input.required<number>();

  readonly cerrado = output<void>();
  readonly registrado = output<{ saldo_nuevo: number }>();

  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  sentido: 'baja' | 'sube' = 'baja';
  monto: number | null = null;
  motivo = '';

  /** Cómo quedaría la deuda. Método, no `computed`: lee campos de ngModel. */
  saldoTras(): number {
    const m = Number(this.monto ?? 0);
    const s = Number(this.saldo());
    return Math.round((this.sentido === 'baja' ? s - m : s + m) * 100) / 100;
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
      // Un saldo negativo se leería como crédito a favor.
      this.error.set('No se le puede quitar más de lo que debe.');
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    const saldoNuevo = this.saldoTras();
    this.clientes.ajustar(this.clienteId(), this.sentido === 'baja' ? -m : m, motivo).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.registrado.emit({ saldo_nuevo: Number(r?.saldo ?? saldoNuevo) });
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
