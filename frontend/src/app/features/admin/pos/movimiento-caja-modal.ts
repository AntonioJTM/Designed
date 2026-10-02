import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VentasService } from '../../../core/services/ventas.service';
import { MovimientoCaja, SesionCaja } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';

/**
 * RETIRO o INGRESO de efectivo a mano en el turno abierto: el dueño saca dinero
 * para depositar, se paga una compra chica con el cajón, se mete cambio a media
 * mañana. Sin esto, ese dinero aparecía en el corte como faltante o sobrante sin
 * explicación.
 *
 * El retiro exige motivo y no deja sacar más de lo que debería haber en el
 * cajón; las dos cosas las valida también el servidor.
 *
 * La sesión entra por input: el modal abre armado con lo que hay en el cajón.
 */
@Component({
  selector: 'app-movimiento-caja-modal',
  imports: [FormsModule],
  templateUrl: './movimiento-caja-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class MovimientoCajaModal implements OnInit {
  private readonly ventas = inject(VentasService);

  readonly sesion = input.required<SesionCaja>();

  readonly cerrado = output<void>();
  /** Se registró: el POS pinta la sesión con el efectivo actualizado. */
  readonly guardado = output<SesionCaja>();

  readonly error = signal<string | null>(null);
  readonly guardando = signal(false);

  tipo: 'retiro' | 'ingreso' = 'retiro';
  monto: number | null = null;
  motivo = '';

  /** El input se lee aquí, no en el constructor: ahí todavía no está puesto. */
  ngOnInit(): void {
    this.error.set(null);
  }

  enCajon(): number {
    return Number(this.sesion().esperado_actual ?? 0);
  }

  /** Cómo queda el cajón si se confirma. Método, no `computed`: lee ngModel. */
  quedaria(): number {
    const m = Number(this.monto ?? 0);
    const r = this.tipo === 'retiro' ? this.enCajon() - m : this.enCajon() + m;
    return Math.round(r * 100) / 100;
  }

  /** Los retiros e ingresos que ya hubo en el turno, para no registrar uno dos veces. */
  manuales(): MovimientoCaja[] {
    return (this.sesion().movimientos ?? []).filter(
      (m) => (m.tipo === 'retiro' || m.tipo === 'ingreso') && !m.referencia_id
    );
  }

  hora(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? ''
      : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  dinero(v: unknown): string {
    return Number(v ?? 0).toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 2,
    });
  }

  guardar(): void {
    const monto = Number(this.monto ?? 0);
    const motivo = this.motivo.trim();
    if (!(monto > 0)) {
      this.error.set('Escribe cuánto dinero es.');
      return;
    }
    if (this.tipo === 'retiro' && motivo.length < 3) {
      this.error.set('Di para qué se saca el dinero: sin eso, en el corte nadie sabrá explicarlo.');
      return;
    }
    if (this.tipo === 'retiro' && monto > this.enCajon() + 0.001) {
      this.error.set(`En el cajón debería haber ${this.dinero(this.enCajon())}: no alcanza para sacar ${this.dinero(monto)}.`);
      return;
    }
    this.error.set(null);
    this.guardando.set(true);
    this.ventas
      .movimientoCaja(this.sesion().id, { tipo: this.tipo, monto, motivo: motivo || undefined })
      .subscribe({
        next: (s) => {
          this.guardando.set(false);
          this.guardado.emit(s);
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
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
