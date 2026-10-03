import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { NominaService } from '../../../core/services/nomina.service';
import {
  ClaveConcepto,
  DesgloseVentas,
  PeriodoNomina,
  ReciboNomina,
} from '../../../core/models/nomina.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';

/** Formulario de captura de un concepto manual sobre un recibo. */
interface FormConcepto {
  clave: ClaveConcepto;
  cantidad: number | null;
  importe: number | null;
  descripcion: string;
}

function formVacio(): FormConcepto {
  return { clave: 'horas_extra', cantidad: null, importe: null, descripcion: '' };
}

/**
 * El detalle de un recibo de nómina, en modal sobre la semana: de qué sale lo
 * que se le paga a la persona, sus ajustes (horas extra, faltas, descuentos) y
 * las ventas que formaron su comisión.
 *
 * Entra el recibo por input —la semana ya lo tiene— y abre armado; solo las
 * ventas se piden al servidor. Al agregar o quitar un ajuste el backend devuelve
 * el periodo entero: el modal se queda con su recibo nuevo y avisa a la semana
 * para que sus totales cuadren. NO se cierra al agregar: capturar varias cosas
 * seguidas en el mismo recibo es lo normal.
 *
 * Con la nómina pagada o cancelada solo se mira: el backend tampoco deja
 * tocarla.
 */
@Component({
  selector: 'app-recibo-modal',
  imports: [FormsModule, DineroPipe, FechaPipe],
  templateUrl: './recibo-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
  styles: `
    .resumen-recibo { display: flex; flex-direction: column; }
    .resumen-recibo .dato.total { border-bottom: 0; font-size: 16px; }
    .resumen-recibo .dato.total > :last-child { font-weight: 600; }
    /* Dos columnas que caben en el modal de 900 px (las .mitad globales piden 420 y se apilaban). */
    .dos { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
    .dos > section { flex: 1 1 340px; min-width: 0; }
    h3 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
    .concepto { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--borde-suave); }
    .concepto .que { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
    .concepto .que span { font-size: 13px; color: var(--tinta-3); }
    .concepto .monto { font-variant-numeric: tabular-nums; font-weight: 500; white-space: nowrap; }
    .form-concepto { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--borde); }
    .form-concepto .field { flex: 1 1 120px; }
    .form-concepto .field.ancho { flex: 2 1 180px; }
    .nota-chica { font-size: 13px; color: var(--tinta-3); margin: 8px 0 0; }
  `,
})
export class ReciboModal implements OnInit {
  private readonly api = inject(NominaService);

  readonly recibo = input.required<ReciboNomina>();
  readonly periodoId = input.required<number>();
  /** Solo un periodo en borrador acepta ajustes. */
  readonly editable = input(false);

  readonly cerrado = output<void>();
  /** El periodo con el recibo ya recalculado, para que la semana cuadre sus totales. */
  readonly actualizado = output<PeriodoNomina>();

  /** El recibo que se muestra: empieza con el del input y se renueva con cada ajuste. */
  readonly actual = signal<ReciboNomina | null>(null);
  readonly ventas = signal<DesgloseVentas | null>(null);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  form: FormConcepto = formVacio();

  /**
   * Los inputs se leen aquí y NO en el constructor: ahí las señales de input
   * todavía no están asignadas y el modal abriría en blanco.
   */
  ngOnInit(): void {
    const r = this.recibo();
    this.actual.set(r);
    this.api.ventas(this.periodoId(), r.usuario_id).subscribe({
      next: (v) => this.ventas.set(v),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  agregarConcepto(): void {
    const r = this.actual();
    if (!r) return;
    const f = this.form;
    if (f.clave === 'horas_extra' && !f.cantidad && !f.importe) {
      this.error.set('Captura las horas o el importe de las horas extra.');
      return;
    }
    if (f.clave !== 'horas_extra' && !f.importe) {
      this.error.set('Captura el importe del descuento.');
      return;
    }
    this.accion(
      this.api.agregarConcepto(r.id, {
        clave: f.clave,
        cantidad: f.cantidad ?? undefined,
        importe: f.importe ?? undefined,
        descripcion: f.descripcion.trim() || undefined,
      }),
      'Ajuste agregado.',
      () => (this.form = formVacio())
    );
  }

  quitarConcepto(id: number): void {
    this.accion(this.api.eliminarConcepto(id), 'Ajuste quitado.');
  }

  etiquetaConcepto(clave: ClaveConcepto): string {
    return (
      { horas_extra: 'Horas extra', falta: 'Falta', descuento: 'Descuento', otro: 'Otro' }[clave] ?? clave
    );
  }

  /** Los DECIMAL llegan como string; en la plantilla se comparan como número. */
  num(v: string | number | null | undefined): number {
    return Number(v ?? 0);
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  /** Ejecuta un ajuste; el backend devuelve el periodo entero, ya recalculado. */
  private accion(obs: Observable<PeriodoNomina>, msg: string, despues?: () => void): void {
    this.ocupado.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    obs.subscribe({
      next: (p) => {
        const nuevo = p.recibos.find((x) => x.id === this.actual()?.id) ?? null;
        if (nuevo) this.actual.set(nuevo);
        this.ocupado.set(false);
        this.mensaje.set(msg);
        despues?.();
        this.actualizado.emit(p);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.ocupado.set(false);
      },
    });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
