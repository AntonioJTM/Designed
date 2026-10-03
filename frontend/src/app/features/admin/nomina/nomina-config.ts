import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NominaService } from '../../../core/services/nomina.service';
import { EmpleadoNomina } from '../../../core/models/nomina.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { EmpleadoNominaModal } from './empleado-nomina-modal';

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
  imports: [RouterLink, DineroPipe, EmpleadoNominaModal],
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
