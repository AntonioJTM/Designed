import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NominaService } from '../../../core/services/nomina.service';
import { EmpleadoNomina } from '../../../core/models/nomina.models';
import { ApiError } from '../../../core/models/auth.models';

/**
 * Configuración de nómina del personal: sueldo semanal, comisión y valor de
 * la hora extra. Solo el staff dado de alta aquí entra en el cálculo semanal.
 */
@Component({
  selector: 'app-nomina-config',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './nomina-config.html',
})
export class NominaConfig {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(NominaService);

  readonly empleados = signal<EmpleadoNomina[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly editando = signal<EmpleadoNomina | null>(null);

  readonly form = this.fb.nonNullable.group({
    sueldo_base_semanal: [0, [Validators.required, Validators.min(0)]],
    paga_comision: [false],
    porcentaje_comision: [10, [Validators.min(0), Validators.max(100)]],
    valor_hora_extra: [0, [Validators.min(0)]],
    activo: [true],
  });

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

  editar(e: EmpleadoNomina): void {
    this.editando.set(e);
    this.mensaje.set(null);
    this.form.reset({
      sueldo_base_semanal: Number(e.sueldo_base_semanal),
      paga_comision: !!e.paga_comision,
      // Un empleado nuevo arranca con el 10% que usa la tienda por omisión.
      porcentaje_comision: Number(e.porcentaje_comision) || 10,
      valor_hora_extra: Number(e.valor_hora_extra),
      activo: e.en_nomina ? !!e.activo : true,
    });
  }

  cerrar(): void {
    this.editando.set(null);
  }

  guardar(): void {
    const emp = this.editando();
    if (!emp || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);

    const v = this.form.getRawValue();
    this.api
      .guardarEmpleado(emp.usuario_id, {
        sueldo_base_semanal: v.sueldo_base_semanal,
        paga_comision: v.paga_comision,
        porcentaje_comision: v.porcentaje_comision,
        valor_hora_extra: v.valor_hora_extra,
        activo: v.activo,
      })
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.mensaje.set(`Configuración de ${emp.nombre} guardada.`);
          this.editando.set(null);
          this.cargar();
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.guardando.set(false);
        },
      });
  }

  /** Saca a un empleado de la nómina sin borrar su historial de recibos. */
  desactivar(e: EmpleadoNomina): void {
    if (!confirm(`¿Sacar a ${e.nombre} de la nómina?\n\nSus recibos anteriores se conservan.`)) return;
    this.api.guardarEmpleado(e.usuario_id, { ...this.aInput(e), activo: false }).subscribe({
      next: () => {
        this.mensaje.set(`${e.nombre} ya no entra en la nómina semanal.`);
        this.cargar();
      },
      error: (err) => this.error.set(this.msg(err)),
    });
  }

  private aInput(e: EmpleadoNomina) {
    return {
      sueldo_base_semanal: Number(e.sueldo_base_semanal),
      paga_comision: !!e.paga_comision,
      porcentaje_comision: Number(e.porcentaje_comision),
      valor_hora_extra: Number(e.valor_hora_extra),
    };
  }

  mx(v: string | number | null | undefined): string {
    return Number(v ?? 0).toFixed(2);
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
