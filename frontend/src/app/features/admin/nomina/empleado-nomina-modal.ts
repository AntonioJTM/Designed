import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NominaService } from '../../../core/services/nomina.service';
import { ConfigEmpleadoInput, EmpleadoNomina } from '../../../core/models/nomina.models';
import { ApiError } from '../../../core/models/auth.models';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

/**
 * Sueldo, comisión y hora extra de un empleado, en modal sobre la tabla de
 * Sueldos y comisiones. El renglón ya trae su configuración y entra por input,
 * así que abre armado y sin velo.
 *
 * "Sacar de la nómina" la desactiva sin borrar nada: sus recibos anteriores se
 * conservan, porque son lo que se le pagó.
 */
@Component({
  selector: 'app-empleado-nomina-modal',
  imports: [ReactiveFormsModule],
  templateUrl: './empleado-nomina-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class EmpleadoNominaModal implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly api = inject(NominaService);

  readonly empleado = input.required<EmpleadoNomina>();

  readonly cerrado = output<void>();
  /** El mensaje para el listado; el listado se recarga. */
  readonly guardado = output<string>();

  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    sueldo_base_semanal: [0, [Validators.required, Validators.min(0)]],
    paga_comision: [false],
    porcentaje_comision: [10, [Validators.min(0), Validators.max(100)]],
    valor_hora_extra: [0, [Validators.min(0)]],
    activo: [true],
  });

  /**
   * El input se lee aquí y NO en el constructor: ahí las señales de input
   * todavía no están asignadas y el modal abriría en blanco.
   */
  ngOnInit(): void {
    const e = this.empleado();
    this.form.reset({
      sueldo_base_semanal: Number(e.sueldo_base_semanal),
      paga_comision: !!e.paga_comision,
      // Un empleado nuevo arranca con el 10% que usa la tienda por omisión.
      porcentaje_comision: Number(e.porcentaje_comision) || 10,
      valor_hora_extra: Number(e.valor_hora_extra),
      activo: e.en_nomina ? !!e.activo : true,
    });
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const e = this.empleado();
    this.enviar(
      {
        sueldo_base_semanal: v.sueldo_base_semanal,
        paga_comision: v.paga_comision,
        porcentaje_comision: v.porcentaje_comision,
        valor_hora_extra: v.valor_hora_extra,
        activo: v.activo,
      },
      `Configuración de ${e.nombre} guardada.`
    );
  }

  /** Saca a un empleado de la nómina sin borrar su historial de recibos. */
  async sacar(): Promise<void> {
    const e = this.empleado();
    const si = await this.confirmacion.pedir({
      titulo: `¿Sacar a ${e.nombre} de la nómina?`,
      mensaje: 'Sus recibos anteriores se conservan.',
      aceptar: 'Sacar de la nómina',
      peligro: true,
    });
    if (!si) return;
    this.enviar(
      {
        sueldo_base_semanal: Number(e.sueldo_base_semanal),
        paga_comision: !!e.paga_comision,
        porcentaje_comision: Number(e.porcentaje_comision),
        valor_hora_extra: Number(e.valor_hora_extra),
        activo: false,
      },
      `${e.nombre} ya no entra en la nómina semanal.`
    );
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  private enviar(body: ConfigEmpleadoInput, texto: string): void {
    this.guardando.set(true);
    this.error.set(null);
    this.api.guardarEmpleado(this.empleado().usuario_id, body).subscribe({
      next: () => {
        this.guardando.set(false);
        this.guardado.emit(texto);
        this.cerrar();
      },
      error: (err) => {
        this.error.set(this.msg(err));
        this.guardando.set(false);
      },
    });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
