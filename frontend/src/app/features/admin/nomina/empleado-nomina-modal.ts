import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { NominaService } from '../../../core/services/nomina.service';
import { ConfigEmpleadoInput, DiaHorario, EmpleadoNomina } from '../../../core/models/nomina.models';
import { ApiError } from '../../../core/models/auth.models';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { DineroPipe } from '../../../shared/dinero.pipe';
import {
  DIAS,
  FACTOR_HORA_EXTRA,
  ORDEN_SEMANA,
  diasLaborales,
  horasDelDia,
  horasSemana,
  minutos,
  salarioDiario,
  valorHora,
} from './jornada';

/** Un renglón del horario mientras se captura. */
interface DiaCaptura {
  dia: number;
  trabaja: boolean;
  entrada: string;
  salida: string;
}

/**
 * Sueldo, comisión, fecha de ingreso y HORARIO de un empleado, en modal sobre la
 * tabla de Sueldos y comisiones. El renglón ya trae su configuración y entra por
 * input, así que abre armado y sin velo.
 *
 * Del horario salen solos los días que trabaja, las horas de su semana y lo que
 * vale su día y su hora (2026-10-06): ya no se captura el valor de la hora extra
 * a mano. Cada día lleva su propia entrada y salida porque no todos los días
 * son iguales (el sábado suele ser más corto).
 *
 * "Sacar de la nómina" la desactiva sin borrar nada: sus recibos anteriores se
 * conservan, porque son lo que se le pagó.
 */
@Component({
  selector: 'app-empleado-nomina-modal',
  imports: [ReactiveFormsModule, FormsModule, DineroPipe],
  templateUrl: './empleado-nomina-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
  styles: `
    .horario { width: 100%; border-collapse: collapse; font-size: 14px; }
    .horario th { text-align: left; font-weight: 500; color: var(--tinta-3); font-size: 12.5px; padding: 0 8px 6px; }
    .horario td { padding: 4px 8px; border-top: 1px solid var(--borde-suave); }
    .horario td.dia { width: 120px; }
    .horario td.dia label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .horario input[type=time] {
      min-height: 38px; padding: 0 8px; border: 1px solid var(--borde-campo); border-radius: 8px;
      font: inherit; font-size: 14px; background: #fff; color: var(--tinta);
    }
    .horario input[type=time]:disabled { background: var(--superficie-2); color: var(--tinta-3); }
    .horario td.horas { color: var(--tinta-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .horario tr.descanso td.dia { color: var(--tinta-3); }
    .seccion { display: flex; flex-direction: column; gap: 10px; }
    .seccion h3 { margin: 0; font-size: 15px; font-weight: 600; }
    .seccion .ayuda-sec { margin: -6px 0 0; font-size: 13px; color: var(--tinta-3); }
    .resumen-jornada {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;
      padding: 12px 14px; border-radius: 10px; background: var(--superficie-2);
    }
    .resumen-jornada div { display: flex; flex-direction: column; gap: 2px; }
    .resumen-jornada span { font-size: 12.5px; color: var(--tinta-3); }
    .resumen-jornada b { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .fila-botones { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  `,
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

  readonly DIAS = DIAS;
  readonly FACTOR = FACTOR_HORA_EXTRA;

  readonly form = this.fb.nonNullable.group({
    sueldo_base_semanal: [0, [Validators.required, Validators.min(0)]],
    fecha_ingreso: [''],
    paga_comision: [false],
    porcentaje_comision: [10, [Validators.min(0), Validators.max(100)]],
    activo: [true],
  });

  /** El horario, de lunes a domingo. Campos con ngModel: la vista previa es de MÉTODOS. */
  dias: DiaCaptura[] = [];
  comidaMin = 0;

  /**
   * El input se lee aquí y NO en el constructor: ahí las señales de input
   * todavía no están asignadas y el modal abriría en blanco.
   */
  ngOnInit(): void {
    const e = this.empleado();
    this.form.reset({
      sueldo_base_semanal: Number(e.sueldo_base_semanal),
      fecha_ingreso: e.fecha_ingreso ?? '',
      paga_comision: !!e.paga_comision,
      // Un empleado nuevo arranca con el 10% que usa la tienda por omisión.
      porcentaje_comision: Number(e.porcentaje_comision) || 10,
      activo: e.en_nomina ? !!e.activo : true,
    });
    this.comidaMin = Number(e.comida_min ?? 0);
    const tiene = new Map((e.horario ?? []).map((d) => [d.dia_semana, d]));
    // Sin horario todavía, se propone lunes a sábado de 9 a 18 para no empezar de cero.
    const propuesto = !tiene.size;
    this.dias = ORDEN_SEMANA.map((dia) => {
      const d = tiene.get(dia);
      return {
        dia,
        trabaja: d ? true : propuesto && dia !== 0,
        entrada: d?.hora_entrada ?? '09:00',
        salida: d?.hora_salida ?? '18:00',
      };
    });
  }

  // ---- Vista previa (métodos: leen campos con ngModel) ----

  horario(): DiaHorario[] {
    return this.dias
      .filter((d) => d.trabaja && minutos(d.entrada) !== null && minutos(d.salida) !== null)
      .map((d) => ({ dia_semana: d.dia, hora_entrada: d.entrada, hora_salida: d.salida }));
  }

  horasDe(d: DiaCaptura): string {
    if (!d.trabaja) return 'descansa';
    const h = horasDelDia({ dia_semana: d.dia, hora_entrada: d.entrada, hora_salida: d.salida }, this.comidaMin);
    return h > 0 ? `${h.toLocaleString('es-MX', { maximumFractionDigits: 2 })} h` : '—';
  }

  sueldo(): number {
    return Number(this.form.controls.sueldo_base_semanal.value || 0);
  }

  diasQueTrabaja(): number {
    return diasLaborales(this.horario());
  }

  horas(): number {
    return Math.round(horasSemana(this.horario(), this.comidaMin) * 100) / 100;
  }

  valorDia(): number | null {
    return salarioDiario(this.sueldo(), this.horario());
  }

  valorDeLaHora(): number | null {
    return valorHora(this.sueldo(), this.horario(), this.comidaMin);
  }

  valorHoraExtra(): number | null {
    const v = this.valorDeLaHora();
    return v === null ? null : Math.round(v * FACTOR_HORA_EXTRA * 100) / 100;
  }

  /** Pone la entrada y salida del lunes a martes, miércoles, jueves y viernes. */
  copiarLunes(): void {
    const lunes = this.dias.find((d) => d.dia === 1);
    if (!lunes) return;
    for (const d of this.dias) {
      if (d.dia >= 2 && d.dia <= 5) {
        d.trabaja = lunes.trabaja;
        d.entrada = lunes.entrada;
        d.salida = lunes.salida;
      }
    }
  }

  // ---- Guardar ----

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const malo = this.dias.find((d) => {
      if (!d.trabaja) return false;
      const e = minutos(d.entrada);
      const s = minutos(d.salida);
      return e === null || s === null || s <= e;
    });
    if (malo) {
      this.error.set(`Revisa el ${DIAS[malo.dia]}: la salida tiene que ser después de la entrada.`);
      return;
    }
    const v = this.form.getRawValue();
    const e = this.empleado();
    this.enviar(
      {
        sueldo_base_semanal: v.sueldo_base_semanal,
        paga_comision: v.paga_comision,
        porcentaje_comision: v.porcentaje_comision,
        fecha_ingreso: v.fecha_ingreso || null,
        comida_min: Number(this.comidaMin) || 0,
        horario: this.horario(),
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
