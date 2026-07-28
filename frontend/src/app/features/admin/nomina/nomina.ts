import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { NominaService } from '../../../core/services/nomina.service';
import {
  ClaveConcepto,
  DesgloseVentas,
  EstadoPeriodoNomina,
  PeriodoNomina,
  PeriodoResumen,
  ReciboNomina,
  SemanaNomina,
} from '../../../core/models/nomina.models';
import { FechaPipe, hoyLocal } from '../../../shared/fecha.pipe';
import { ApiError } from '../../../core/models/auth.models';

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

@Component({
  selector: 'app-nomina',
  imports: [FormsModule, RouterLink, FechaPipe],
  templateUrl: './nomina.html',
})
export class Nomina {
  private readonly api = inject(NominaService);

  readonly semana = signal<SemanaNomina | null>(null);
  readonly periodo = signal<PeriodoNomina | null>(null);
  readonly historial = signal<PeriodoResumen[]>([]);
  readonly cargando = signal(true);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  /** Recibo con la fila expandida (conceptos + desglose de ventas). */
  readonly expandido = signal<number | null>(null);
  readonly ventas = signal<DesgloseVentas | null>(null);
  form: FormConcepto = formVacio();

  /**
   * Día usado para ubicar la semana; el backend lo ajusta al domingo.
   * Se toma en hora LOCAL: con toISOString() la semana se adelantaría a partir
   * de las 18:00 en México (UTC-6).
   */
  fecha = hoyLocal();

  readonly editable = computed(() => this.periodo()?.estado === 'borrador');

  readonly totales = computed(() => {
    const recibos = this.periodo()?.recibos ?? [];
    const suma = (f: (r: ReciboNomina) => string) =>
      recibos.reduce((s, r) => s + Number(f(r)), 0);
    return {
      empleados: recibos.length,
      sueldos: suma((r) => r.sueldo_base),
      ventas: suma((r) => r.ventas_netas),
      comisiones: suma((r) => r.comision),
      percepciones: suma((r) => r.otras_percepciones),
      deducciones: suma((r) => r.deducciones),
      total: suma((r) => r.total_pagar),
    };
  });

  constructor() {
    this.cargarSemana();
    this.cargarHistorial();
  }

  // ---- Carga ----

  cargarSemana(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.expandido.set(null);
    this.api.semanaActual(this.fecha).subscribe({
      next: (r) => {
        this.semana.set(r.semana);
        this.periodo.set(r.periodo);
        this.cargando.set(false);
      },
      error: (e) => this.fallo(e, true),
    });
  }

  private cargarHistorial(): void {
    this.api.listarPeriodos(1, 12).subscribe({
      next: (p) => this.historial.set(p.items),
      error: () => {},
    });
  }

  /** Mueve la fecha de referencia una semana hacia atrás o hacia adelante. */
  moverSemana(dias: number): void {
    const d = new Date(`${this.fecha}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    this.fecha = d.toISOString().slice(0, 10);
    this.cargarSemana();
  }

  irASemanaDe(fecha: string): void {
    this.fecha = String(fecha).slice(0, 10);
    this.cargarSemana();
  }

  // ---- Acciones sobre el periodo ----

  crear(): void {
    this.accion(this.api.crearPeriodo(this.fecha), 'Nómina de la semana creada.');
  }

  calcular(): void {
    const p = this.periodo();
    if (!p) return;
    this.accion(
      this.api.calcular(p.id),
      'Sueldos y comisiones recalculados con las ventas de la semana.'
    );
  }

  marcarPagada(): void {
    const p = this.periodo();
    if (!p) return;
    const total = this.totales().total.toFixed(2);
    if (!confirm(`¿Marcar como pagada la nómina del ${p.fecha_pago} por $${total}?\n\nDespués ya no podrá editarse.`)) {
      return;
    }
    this.cambiarEstado('pagado', 'Nómina marcada como pagada.');
  }

  cancelar(): void {
    const p = this.periodo();
    if (!p) return;
    if (!confirm('¿Cancelar esta nómina? Los recibos se conservan pero quedan sin efecto.')) return;
    this.cambiarEstado('cancelado', 'Nómina cancelada.');
  }

  private cambiarEstado(estado: EstadoPeriodoNomina, msg: string): void {
    const p = this.periodo();
    if (!p) return;
    this.accion(this.api.cambiarEstado(p.id, estado), msg);
  }

  // ---- Detalle por empleado ----

  alternar(recibo: ReciboNomina): void {
    if (this.expandido() === recibo.id) {
      this.expandido.set(null);
      return;
    }
    this.expandido.set(recibo.id);
    this.form = formVacio();
    this.ventas.set(null);
    const p = this.periodo();
    if (!p) return;
    this.api.ventas(p.id, recibo.usuario_id).subscribe({
      next: (v) => this.ventas.set(v),
      error: (e) => this.fallo(e),
    });
  }

  agregarConcepto(recibo: ReciboNomina): void {
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
      this.api.agregarConcepto(recibo.id, {
        clave: f.clave,
        cantidad: f.cantidad ?? undefined,
        importe: f.importe ?? undefined,
        descripcion: f.descripcion.trim() || undefined,
      }),
      'Concepto agregado.',
      () => (this.form = formVacio())
    );
  }

  quitarConcepto(id: number): void {
    this.accion(this.api.eliminarConcepto(id), 'Concepto eliminado.');
  }

  // ---- Presentación ----

  /** Los DECIMAL llegan como string; en la plantilla se comparan como número. */
  num(v: string | number | null | undefined): number {
    return Number(v ?? 0);
  }

  mx(v: string | number | null | undefined): string {
    return this.num(v).toFixed(2);
  }

  etiquetaConcepto(clave: ClaveConcepto): string {
    return (
      { horas_extra: 'Horas extra', falta: 'Falta', descuento: 'Descuento', otro: 'Otro' }[clave] ??
      clave
    );
  }

  // ---- Utilidades internas ----

  /** Ejecuta una acción que devuelve el periodo actualizado. */
  private accion(obs: Observable<PeriodoNomina>, msg: string, despues?: () => void): void {
    this.ocupado.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    obs.subscribe({
      next: (p) => {
        this.periodo.set(p);
        this.mensaje.set(msg);
        this.ocupado.set(false);
        despues?.();
        this.cargarHistorial();
      },
      error: (e) => this.fallo(e),
    });
  }

  private fallo(e: unknown, finCarga = false): void {
    this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.');
    this.ocupado.set(false);
    if (finCarga) this.cargando.set(false);
  }
}
