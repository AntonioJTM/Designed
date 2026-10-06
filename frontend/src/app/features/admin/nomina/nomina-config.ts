import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NominaService } from '../../../core/services/nomina.service';
import { EmpleadoNomina } from '../../../core/models/nomina.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { EmpleadoNominaModal } from './empleado-nomina-modal';
import { VacacionesModal } from './vacaciones-modal';
import { DIAS_CORTOS, ORDEN_SEMANA } from './jornada';

/**
 * Configuración de nómina del personal: sueldo semanal, comisión y valor de
 * la hora extra (rediseño 2026-10). Solo el staff dado de alta aquí entra en el
 * cálculo semanal. Cambiarla NO toca las semanas ya calculadas: el recibo
 * congela la venta neta y el porcentaje, y una semana pagada no se recalcula.
 *
 * La tabla es para mirar; dar de alta, editar o sacar de la nómina es un modal.
 */
@Component({
  selector: 'app-nomina-config',
  imports: [RouterLink, DineroPipe, FechaPipe, EmpleadoNominaModal, VacacionesModal],
  templateUrl: './nomina-config.html',
})
export class NominaConfig {
  private readonly api = inject(NominaService);

  readonly empleados = signal<EmpleadoNomina[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  /** Empleado abierto en el modal. */
  readonly editando = signal<EmpleadoNomina | null>(null);
  /** Empleado con el modal de vacaciones abierto. */
  readonly vacacionesDe = signal<EmpleadoNomina | null>(null);

  /** Cuántos entran hoy en la nómina, para el título de la tarjeta. */
  readonly enNomina = computed(() => this.empleados().filter((e) => e.en_nomina && e.activo).length);

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.api.empleados().subscribe({
      next: (e) => {
        this.empleados.set(e);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  abrir(e: EmpleadoNomina): void {
    this.mensaje.set(null);
    this.error.set(null);
    this.editando.set(e);
  }

  abrirVacaciones(e: EmpleadoNomina): void {
    this.mensaje.set(null);
    this.error.set(null);
    this.vacacionesDe.set(e);
  }

  /** "Lun a Sáb", "Lun a Vie y Dom"…: qué días trabaja, en corto. */
  diasDe(e: EmpleadoNomina): string {
    const tiene = new Set(e.horario.map((d) => d.dia_semana));
    const orden = ORDEN_SEMANA.filter((d) => tiene.has(d));
    // Tramos seguidos en el orden lunes → domingo.
    const tramos: number[][] = [];
    for (const d of orden) {
      const ult = tramos[tramos.length - 1];
      if (ult && ORDEN_SEMANA.indexOf(d) === ORDEN_SEMANA.indexOf(ult[ult.length - 1]) + 1) ult.push(d);
      else tramos.push([d]);
    }
    const textos = tramos.map((t) =>
      t.length === 1 ? DIAS_CORTOS[t[0]] : t.length === 2 ? `${DIAS_CORTOS[t[0]]} y ${DIAS_CORTOS[t[1]]}` : `${DIAS_CORTOS[t[0]]} a ${DIAS_CORTOS[t[t.length - 1]]}`
    );
    return textos.length > 1 ? `${textos.slice(0, -1).join(', ')} y ${textos[textos.length - 1]}` : textos[0] ?? '';
  }

  guardado(texto: string): void {
    this.mensaje.set(texto);
    this.cargar();
  }

  num(v: string | number | null | undefined): number {
    return Number(v ?? 0);
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
