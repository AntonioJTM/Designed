import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { nuevaClave } from '../../../core/clave-unica';
import { FormsModule } from '@angular/forms';
import { TransferenciasService } from '../../../core/services/transferencias.service';
import { CuentaDeposito } from '../../../shared/cuenta-deposito';
import { ClientesService } from '../../../core/services/clientes.service';
import { VentasService } from '../../../core/services/ventas.service';
import { SesionCaja } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { turnoPropuesto, turnosAbiertos } from './turnos-caja';

/**
 * RECIBIR UN ANTICIPO (2026-10-14: "se dan anticipos en efectivo y
 * transferencia"): el cliente deja dinero a cuenta, sin nota, y le queda como
 * saldo a favor para sus compras. Puede dejar parte en efectivo y parte por
 * transferencia.
 *
 * El EFECTIVO entra a un turno de caja abierto, o el corte no cuadra: desde el
 * punto de venta es el turno de esa caja (`sesionId`); desde el expediente se
 * buscan los turnos al abrir, como en el abono. La transferencia no toca la caja
 * y lleva su referencia.
 *
 * No se cierra al hacer clic en el fondo; sale con la ✕, "Cancelar" o Escape.
 */
@Component({
  selector: 'app-anticipo-modal',
  imports: [FormsModule, DineroPipe, CuentaDeposito],
  templateUrl: './anticipo-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
  styles: `
    .anticipo { gap: 16px; }
    .anticipo > .muted b { color: var(--tinta); }
    .moneda { position: relative; display: block; }
    .moneda > span { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--tinta-3); font-weight: 600; }
    .moneda > input { padding-left: 26px; }
    .total-anticipo { margin: 0; font-size: 0.9375rem; }
    .total-anticipo b { font-variant-numeric: tabular-nums; }
  `,
})
export class AnticipoModal implements OnInit {
  /** La llave de un solo uso de esta operación (2026-10-20): un doble clic no la registra dos veces. */
  private clave = nuevaClave();
  private readonly clientes = inject(ClientesService);
  private readonly ventas = inject(VentasService);

  readonly clienteId = input.required<number>();
  readonly nombre = input.required<string>();
  /** Lo que ya tiene a favor. */
  readonly saldoFavor = input(0);
  /** El turno de la caja desde la que se recibe (el punto de venta). Sin él, se buscan. */
  readonly sesionId = input<number | null>(null);

  readonly cerrado = output<void>();
  /** `movimiento_id`: con él se imprime su ticket. */
  readonly registrado = output<{ total: number; saldo_favor: number; movimiento_id: number }>();

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  /** Los turnos abiertos (solo si no viene `sesionId`). */
  readonly turnos = signal<SesionCaja[]>([]);

  efectivo: number | null = null;
  transferencia: number | null = null;
  turnoId: number | null = null;
  referencia = '';
  /** A qué cuenta llegó la transferencia (Transferencias, 2026-10-20). */
  cuentaId: number | null = null;
  protected readonly transf = inject(TransferenciasService);

  /** Los inputs se leen AQUÍ: en el constructor todavía no están asignados. */
  ngOnInit(): void {
    if (this.sesionId()) {
      this.turnoId = this.sesionId();
      this.cargando.set(false);
      return;
    }
    turnosAbiertos(this.ventas).then((turnos) => {
      this.turnos.set(turnos);
      this.turnoId = turnoPropuesto(turnos);
      this.cargando.set(false);
    });
  }

  // Métodos y no `computed`: leen campos de ngModel.
  parteEfectivo(): number {
    const v = Number(this.efectivo);
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
  }

  parteTransferencia(): number {
    const v = Number(this.transferencia);
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
  }

  total(): number {
    return Math.round((this.parteEfectivo() + this.parteTransferencia()) * 100) / 100;
  }

  /** Hace falta elegir a qué caja entra el efectivo (desde el expediente, con varias abiertas). */
  eligeCaja(): boolean {
    return !this.sesionId() && this.parteEfectivo() > 0 && this.turnos().length > 1;
  }

  registrar(): void {
    if (this.total() <= 0) {
      this.error.set('Pon cuánto deja: en efectivo, por transferencia o las dos.');
      return;
    }
    if (this.parteEfectivo() > 0 && !this.turnoId) {
      this.error.set(
        this.turnos().length > 1
          ? 'Elige a qué caja entra el efectivo: es la que lo recibió.'
          : 'El efectivo tiene que entrar en un turno de caja abierto, o el corte no va a cuadrar. ' +
            'Abre el turno en Caja, o recíbelo por transferencia.'
      );
      return;
    }
    if (this.transf.faltaCuenta(this.parteTransferencia() > 0, this.cuentaId)) {
      this.error.set('Elige a qué cuenta llegó la transferencia.');
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.clientes
      .recibirAnticipo(this.clienteId(), {
        efectivo: this.parteEfectivo() || undefined,
        transferencia: this.parteTransferencia() || undefined,
        sesion_caja_id: this.parteEfectivo() > 0 ? Number(this.turnoId) : undefined,
        referencia: this.parteTransferencia() > 0 ? this.referencia.trim() || undefined : undefined,
        ...(this.parteTransferencia() > 0 && this.transf.elegida(this.cuentaId)
          ? { cuenta_bancaria_id: this.transf.elegida(this.cuentaId)! } : {}),
      }, this.clave)
      .subscribe({
        next: (r) => {
          this.guardando.set(false);
          this.clave = nuevaClave();
          this.registrado.emit({ total: Number(r.total), saldo_favor: Number(r.saldo_favor), movimiento_id: Number(r.movimiento_id) });
        },
        error: (e) => {
          this.guardando.set(false);
          this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'No se pudo registrar el anticipo.');
        },
      });
  }

  cerrar(): void {
    if (!this.guardando()) this.cerrado.emit();
  }
}
