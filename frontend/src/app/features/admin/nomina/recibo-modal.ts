import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { NominaService } from '../../../core/services/nomina.service';
import {
  ClaveConcepto,
  ConceptoNomina,
  DesgloseVentas,
  DiaHorario,
  PeriodoNomina,
  ReciboNomina,
} from '../../../core/models/nomina.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import {
  DIAS,
  DIAS_CORTOS,
  diaSemana,
  horasTexto,
  importeExtra,
  minutosExtra,
  turno,
} from './jornada';
import { diaCorto, sumarDias } from './semana';

/** Un día de la semana para elegir dónde hubo horas extra. */
interface DiaDeLaSemana {
  fecha: string;
  etiqueta: string;
  horario: DiaHorario | null;
}

/**
 * El detalle de un recibo de nómina, en modal sobre la semana: de qué sale lo
 * que se le paga a la persona, los días que trabajó, sus horas extra, sus
 * descuentos y las ventas que formaron su comisión.
 *
 * Desde el 2026-10-06, con horario:
 *  · se paga POR DÍAS: "Días trabajados" viene con los de su horario (menos
 *    vacaciones); bajarlo es registrar una falta;
 *  · las horas extra se capturan por día —a qué hora salió o entró de verdad—
 *    y el sistema las cuenta contra su horario de ESE día, al doble de su hora.
 *
 * Entra el recibo por input —la semana ya lo tiene— y abre armado; solo las
 * ventas se piden al servidor. Cada cambio devuelve el periodo entero: el modal
 * se queda con su recibo nuevo y avisa a la semana para que sus totales cuadren.
 * NO se cierra al agregar: capturar varias cosas seguidas es lo normal.
 *
 * Con la nómina pagada o cancelada solo se mira: el backend tampoco deja tocarla.
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
    .resumen-recibo .como { font-size: 13px; color: var(--tinta-3); }
    /* Dos columnas que caben en el modal de 900 px (las .mitad globales piden 420 y se apilaban). */
    .dos { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
    .dos > .col { flex: 1 1 360px; min-width: 0; display: flex; flex-direction: column; gap: 22px; }
    h3 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
    .concepto { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--borde-suave); }
    .concepto .que { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
    .concepto .que span { font-size: 13px; color: var(--tinta-3); }
    .concepto .monto { font-variant-numeric: tabular-nums; font-weight: 500; white-space: nowrap; }
    .form-concepto { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--borde); }
    .form-concepto .field { flex: 1 1 110px; }
    .form-concepto .field.ancho { flex: 2 1 200px; }
    .nota-chica { font-size: 13px; color: var(--tinta-3); margin: 8px 0 0; }
    .previa { font-size: 13.5px; margin: 8px 0 0; }
    .previa.mal { color: var(--alerta-t); }
    .dias-fila { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
    .dias-fila .field { width: 140px; }
    .chips-dias { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
    .chips-dias span { font-size: 12.5px; padding: 2px 8px; border-radius: 999px; background: var(--superficie-2); color: var(--tinta-2); }
    .chips-dias span.descanso { color: var(--tinta-3); text-decoration: line-through; }
  `,
})
export class ReciboModal implements OnInit {
  private readonly api = inject(NominaService);

  readonly recibo = input.required<ReciboNomina>();
  readonly periodoId = input.required<number>();
  /** El domingo con que empieza la semana: de ahí salen los días para las horas extra. */
  readonly semanaInicio = input.required<string>();
  /** Solo un periodo en borrador acepta cambios. */
  readonly editable = input(false);

  readonly cerrado = output<void>();
  /** El periodo con el recibo ya recalculado, para que la semana cuadre sus totales. */
  readonly actualizado = output<PeriodoNomina>();

  /** El recibo que se muestra: empieza con el del input y se renueva con cada cambio. */
  readonly actual = signal<ReciboNomina | null>(null);
  readonly ventas = signal<DesgloseVentas | null>(null);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  readonly DIAS_CORTOS = DIAS_CORTOS;

  /** Días trabajados que se están capturando. */
  diasTrabajados: number | null = null;
  /** Horas extra que se están capturando. */
  extra = { fecha: '', entrada: '', salida: '' };
  /** Descuento que se está capturando. */
  descuento = { importe: null as number | null, descripcion: '' };

  /** Los 7 días de la semana, con su horario de ese día (o descanso). */
  semana: DiaDeLaSemana[] = [];

  /**
   * Los inputs se leen aquí y NO en el constructor: ahí las señales de input
   * todavía no están asignadas y el modal abriría en blanco.
   */
  ngOnInit(): void {
    const r = this.recibo();
    this.actual.set(r);
    this.diasTrabajados = r.dias_trabajados !== null ? Number(r.dias_trabajados) : null;
    this.armarSemana(r);
    this.api.ventas(this.periodoId(), r.usuario_id).subscribe({
      next: (v) => this.ventas.set(v),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  private armarSemana(r: ReciboNomina): void {
    const porDia = new Map((r.horario ?? []).map((d) => [d.dia_semana, d]));
    this.semana = Array.from({ length: 7 }, (_, i) => {
      const fecha = sumarDias(this.semanaInicio(), i);
      const horario = porDia.get(diaSemana(fecha)) ?? null;
      const nombre = DIAS[diaSemana(fecha)];
      return {
        fecha,
        horario,
        etiqueta: `${nombre.charAt(0).toUpperCase() + nombre.slice(1)} ${diaCorto(fecha)} · ${horario ? turno(horario) : 'descansa'}`,
      };
    });
  }

  // ---- Lo que se lee ----

  conHorario(r: ReciboNomina): boolean {
    return r.dias_laborales !== null;
  }

  faltas(r: ReciboNomina): number {
    if (r.dias_laborales === null || r.dias_trabajados === null) return 0;
    return Math.max(0, Number(r.dias_laborales) - Number(r.dias_vacaciones) - Number(r.dias_trabajados));
  }

  /** "Su horario tiene 6 días y 2 fueron de vacaciones." */
  textoDias(r: ReciboNomina): string {
    const vac = this.num(r.dias_vacaciones);
    const lab = this.num(r.dias_laborales);
    return vac > 0
      ? `Su horario tiene ${lab} días y ${vac} ${vac === 1 ? 'fue' : 'fueron'} de vacaciones.`
      : `Su horario tiene ${lab} ${lab === 1 ? 'día' : 'días'}.`;
  }

  maxDias(r: ReciboNomina): number {
    return Number(r.dias_laborales ?? 0) - Number(r.dias_vacaciones ?? 0);
  }

  horasExtra(r: ReciboNomina): ConceptoNomina[] {
    return r.conceptos.filter((c) => c.clave === 'horas_extra');
  }

  otros(r: ReciboNomina): ConceptoNomina[] {
    return r.conceptos.filter((c) => c.clave !== 'horas_extra');
  }

  /** Vista previa de las horas extra que se están capturando. Método: lee ngModel. */
  previaExtra(): { texto: string; mal: boolean } | null {
    const r = this.actual();
    if (!r || !this.extra.fecha || (!this.extra.entrada && !this.extra.salida)) return null;
    const dia = this.semana.find((d) => d.fecha === this.extra.fecha);
    const res = minutosExtra(dia?.horario ?? null, this.extra.entrada || null, this.extra.salida || null);
    if (res.error) return { texto: res.error, mal: true };
    if (!res.minutos) {
      return { texto: `Con esas horas no hay tiempo extra: su horario ese día es de ${dia?.horario ? turno(dia.horario) : '—'}.`, mal: true };
    }
    const hora = Number(r.valor_hora ?? 0);
    const importe = importeExtra(res.minutos, hora);
    const d = new DineroPipe();
    return {
      texto: `${horasTexto(res.minutos)} extra × ${d.transform(hora * 2)} (el doble de su hora de ${d.transform(hora)}) = ${d.transform(importe)}`,
      mal: false,
    };
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

  // ---- Lo que se cambia ----

  guardarDias(): void {
    const r = this.actual();
    if (!r || this.diasTrabajados === null) return;
    const d = Number(this.diasTrabajados);
    if (Number.isNaN(d) || d < 0 || d > this.maxDias(r) || (d * 2) % 1 !== 0) {
      this.error.set(`Los días trabajados van de 0 a ${this.maxDias(r)}, de medio en medio día.`);
      return;
    }
    const faltas = this.maxDias(r) - d;
    this.accion(
      this.api.fijarDias(r.id, d),
      faltas > 0 ? `Listo: trabajó ${d} ${d === 1 ? 'día' : 'días'} y faltó ${faltas}.` : 'Listo: trabajó todos sus días.'
    );
  }

  agregarHorasExtra(): void {
    const r = this.actual();
    if (!r) return;
    if (!this.extra.fecha) {
      this.error.set('Elige el día.');
      return;
    }
    if (!this.extra.entrada && !this.extra.salida) {
      this.error.set('Escribe a qué hora salió (o entró) ese día.');
      return;
    }
    this.accion(
      this.api.agregarHorasExtra(r.id, {
        fecha: this.extra.fecha,
        hora_entrada: this.extra.entrada || undefined,
        hora_salida: this.extra.salida || undefined,
      }),
      'Horas extra agregadas.',
      () => (this.extra = { fecha: '', entrada: '', salida: '' })
    );
  }

  agregarDescuento(): void {
    const r = this.actual();
    if (!r) return;
    if (!this.descuento.importe || this.descuento.importe <= 0) {
      this.error.set('Captura el importe del descuento.');
      return;
    }
    this.accion(
      this.api.agregarConcepto(r.id, {
        clave: 'descuento',
        importe: this.descuento.importe,
        descripcion: this.descuento.descripcion.trim() || undefined,
      }),
      'Descuento agregado.',
      () => (this.descuento = { importe: null, descripcion: '' })
    );
  }

  quitarConcepto(id: number): void {
    this.accion(this.api.eliminarConcepto(id), 'Quitado.');
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  /** Ejecuta un cambio; el backend devuelve el periodo entero, ya recalculado. */
  private accion(obs: Observable<PeriodoNomina>, msg: string, despues?: () => void): void {
    this.ocupado.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    obs.subscribe({
      next: (p) => {
        const nuevo = p.recibos.find((x) => x.id === this.actual()?.id) ?? null;
        if (nuevo) {
          this.actual.set(nuevo);
          this.diasTrabajados = nuevo.dias_trabajados !== null ? Number(nuevo.dias_trabajados) : null;
        }
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
