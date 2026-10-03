import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { NominaService } from '../../../core/services/nomina.service';
import {
  EstadoPeriodoNomina,
  PeriodoNomina,
  PeriodoResumen,
  ReciboNomina,
  SemanaNomina,
} from '../../../core/models/nomina.models';
import { hoyLocal } from '../../../shared/fecha.pipe';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { ApiError } from '../../../core/models/auth.models';
import { ReciboModal } from './recibo-modal';
import { diaCorto, diaLargo, domingoDe, rangoCorto, rangoLargo, sumarDias } from './semana';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

/** Una opción del selector de semana. */
interface OpcionSemana {
  inicio: string;
  etiqueta: string;
}

/** Cuántas semanas hacia atrás ofrece el selector, además de las que ya tienen nómina. */
const SEMANAS_ATRAS = 12;

/**
 * Nómina semanal (rediseño 2026-10). La semana va de DOMINGO a SÁBADO y se paga
 * ese mismo sábado. La comisión es sobre la venta neta de cada quien —subtotal
 * menos descuento, sin IVA ni envío, sin lo cancelado ni lo devuelto— y al
 * calcular el recibo se CONGELAN la venta y el porcentaje, para que el histórico
 * no cambie si después se edita la configuración del empleado. Un periodo
 * pagado es inmutable: no se recalcula ni se reabre (lo garantiza el backend;
 * aquí ni se ofrece).
 *
 * La pantalla es para mirar la semana; el detalle de cada recibo (sus ajustes y
 * las ventas que formaron la comisión) es un modal.
 */
@Component({
  selector: 'app-nomina',
  imports: [RouterLink, DineroPipe, ReciboModal],
  templateUrl: './nomina.html',
  styles: `
    /* El punto de color de la cifra es fijo: la clase global .punto también es
       la de los "pensando…" del asistente y heredaba su parpadeo. */
    .kpi-label .punto { animation: none; opacity: 1; }
    .semana-sel { display: flex; align-items: center; gap: 6px; }
    .semana-sel select {
      min-height: 44px; min-width: 260px; padding: 0 12px; border: 1px solid var(--borde-campo);
      border-radius: 8px; background: #fff; font: inherit; font-size: 14px; color: var(--tinta);
    }
    .semana-sel select:focus { outline: none; border-color: var(--acento); box-shadow: 0 0 0 3px #2457C533; }
    .semana-sel .btn-icono { width: 44px; height: 44px; }
    .estado-periodo { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .sub2 { font-size: 12px; color: var(--tinta-3); }
    .extra { color: var(--ok-t); }
    .desc { color: var(--alerta-t); }
    @media (max-width: 640px) { .semana-sel select { min-width: 0; flex: 1; } .semana-sel { width: 100%; } }
  `,
})
export class Nomina {
  private readonly api = inject(NominaService);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly dinero = new DineroPipe();

  readonly semana = signal<SemanaNomina | null>(null);
  readonly periodo = signal<PeriodoNomina | null>(null);
  readonly historial = signal<PeriodoResumen[]>([]);
  readonly cargando = signal(true);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  /** Recibo abierto en el modal de detalle. */
  readonly reciboAbierto = signal<ReciboNomina | null>(null);

  /** Hoy en hora LOCAL: con toISOString() la semana se adelantaría desde las 18:00. */
  private readonly hoy = hoyLocal();

  /**
   * Día usado para ubicar la semana; el backend lo ajusta al domingo.
   */
  private fecha = this.hoy;

  readonly editable = computed(() => this.periodo()?.estado === 'borrador');

  readonly totales = computed(() => {
    const recibos = this.periodo()?.recibos ?? [];
    const suma = (f: (r: ReciboNomina) => string) => recibos.reduce((s, r) => s + Number(f(r)), 0);
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

  /**
   * Las semanas del selector: las últimas doce y todas las que ya tienen
   * nómina, la más reciente arriba. Las flechas de al lado llevan a cualquier
   * otra, igual que antes el "Ir a la semana de".
   */
  readonly opcionesSemana = computed<OpcionSemana[]>(() => {
    const inicios = new Set<string>();
    const actual = domingoDe(this.hoy);
    for (let i = 0; i <= SEMANAS_ATRAS; i++) inicios.add(sumarDias(actual, -7 * i));
    for (const h of this.historial()) inicios.add(h.fecha_inicio);
    const vista = this.semana()?.fecha_inicio;
    if (vista) inicios.add(vista);
    return [...inicios]
      .sort((a, b) => b.localeCompare(a))
      .map((inicio) => ({ inicio, etiqueta: rangoCorto(inicio, sumarDias(inicio, 6), this.hoy) }));
  });

  /** "Semana del domingo 27 de septiembre al sábado 3 de octubre · se paga el sábado." */
  readonly subtitulo = computed(() => {
    const s = this.semana();
    if (!s) return 'La semana va de domingo a sábado y se paga el sábado.';
    return `Semana del domingo ${diaLargo(s.fecha_inicio, this.hoy)} al sábado ${diaLargo(s.fecha_fin, this.hoy)} · se paga el sábado.`;
  });

  /** Las demás semanas con nómina (la que se está viendo ya está arriba). */
  readonly anteriores = computed(() => {
    const vista = this.semana()?.fecha_inicio;
    return this.historial().filter((h) => h.fecha_inicio !== vista);
  });

  constructor() {
    this.cargarSemana();
    this.cargarHistorial();
  }

  // ---- Carga ----

  cargarSemana(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.reciboAbierto.set(null);
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

  /** Mueve la semana a la anterior o a la siguiente. */
  moverSemana(dias: number): void {
    const base = this.semana()?.fecha_inicio ?? this.fecha;
    this.fecha = sumarDias(base, dias);
    this.mensaje.set(null);
    this.cargarSemana();
  }

  irASemanaDe(fecha: string): void {
    this.fecha = String(fecha).slice(0, 10);
    this.mensaje.set(null);
    this.cargarSemana();
  }

  // ---- Acciones sobre el periodo ----

  crear(): void {
    this.accion(this.api.crearPeriodo(this.fecha), 'Nómina de la semana creada.');
  }

  calcular(): void {
    const p = this.periodo();
    if (!p) return;
    this.accion(this.api.calcular(p.id), 'Sueldos y comisiones recalculados con las ventas de la semana.');
  }

  async marcarPagada(): Promise<void> {
    const p = this.periodo();
    if (!p) return;
    const total = this.dinero.transform(this.totales().total);
    const si = await this.confirmacion.pedir({
      titulo: `¿Marcar como pagada la nómina del sábado ${diaLargo(p.fecha_pago, this.hoy)}?`,
      mensaje: `Por ${total}. Después ya no podrá editarse ni recalcularse.`,
      aceptar: 'Marcar como pagada',
    });
    if (!si) return;
    this.cambiarEstado('pagado', 'Nómina marcada como pagada.');
  }

  async cancelar(): Promise<void> {
    const p = this.periodo();
    if (!p) return;
    const si = await this.confirmacion.pedir({
      titulo: '¿Cancelar esta nómina?',
      mensaje: 'Los recibos se conservan, pero quedan sin efecto.',
      aceptar: 'Cancelar la nómina',
      cancelar: 'No, regresar',
      peligro: true,
    });
    if (!si) return;
    this.cambiarEstado('cancelado', 'Nómina cancelada.');
  }

  private cambiarEstado(estado: EstadoPeriodoNomina, msg: string): void {
    const p = this.periodo();
    if (!p) return;
    this.accion(this.api.cambiarEstado(p.id, estado), msg);
  }

  // ---- Detalle por empleado (modal) ----

  abrirRecibo(r: ReciboNomina): void {
    this.mensaje.set(null);
    this.reciboAbierto.set(r);
  }

  /** El modal agregó o quitó un ajuste: el periodo regresa con los totales nuevos. */
  periodoActualizado(p: PeriodoNomina): void {
    this.periodo.set(p);
    this.cargarHistorial();
  }

  // ---- Presentación ----

  /** Los DECIMAL llegan como string; en la plantilla se comparan como número. */
  num(v: string | number | null | undefined): number {
    return Number(v ?? 0);
  }

  /** "+$250.00" / "-$200.00": las horas extra suman y los descuentos restan. */
  conSigno(n: number): string {
    return (n > 0 ? '+' : '') + this.dinero.transform(n);
  }

  diaPago(iso: string): string {
    return diaLargo(iso, this.hoy);
  }

  rango(h: PeriodoResumen): string {
    return rangoLargo(h.fecha_inicio, h.fecha_fin, this.hoy);
  }

  etiquetaEstado(h: PeriodoResumen): string {
    if (h.estado === 'pagado') return `Pagada el ${diaCorto(h.fecha_pago)}`;
    return h.estado === 'borrador' ? 'Borrador' : 'Cancelada';
  }

  // ---- Utilidades internas ----

  /** Ejecuta una acción que devuelve el periodo actualizado. */
  private accion(obs: Observable<PeriodoNomina>, msg: string): void {
    this.ocupado.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    obs.subscribe({
      next: (p) => {
        this.periodo.set(p);
        this.mensaje.set(msg);
        this.ocupado.set(false);
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
