import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NominaService } from '../../../core/services/nomina.service';
import { EmpleadoNomina, VacacionesEmpleado, VacacionesRegistro } from '../../../core/models/nomina.models';
import { ApiError } from '../../../core/models/auth.models';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { diasHabilesEnRango } from './jornada';
import { sumarDias } from './semana';

/**
 * Las vacaciones de un empleado (2026-10-06): cuántos días le tocan por ley
 * según su antigüedad, cuántos lleva y cuántos le quedan en su año vigente, y
 * las que ha tomado. Se registran POR FECHAS; los días que gastan son los de
 * trabajo de su horario (sus descansos no cuentan), y la nómina de esa semana
 * los paga sola como días normales.
 *
 * NO se cierra al registrar: dar varios periodos seguidos es normal.
 */
@Component({
  selector: 'app-vacaciones-modal',
  imports: [FormsModule, FechaPipe],
  templateUrl: './vacaciones-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
  styles: `
    .saldo { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
    .saldo div {
      display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border-radius: 10px;
      background: var(--superficie-2);
    }
    .saldo span { font-size: 12.5px; color: var(--tinta-3); }
    .saldo b { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .saldo .queda { background: var(--ok-f); }
    .saldo .queda b { color: var(--ok-t); }
    .form-vac { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
    .form-vac .field { flex: 1 1 150px; }
    .form-vac .field.ancho { flex: 2 1 220px; }
    h3 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
  `,
})
export class VacacionesModal implements OnInit {
  private readonly api = inject(NominaService);
  private readonly confirmacion = inject(ConfirmacionService);

  readonly empleado = input.required<EmpleadoNomina>();
  readonly cerrado = output<void>();
  /** Cambió su saldo: el listado se recarga. */
  readonly cambiado = output<void>();

  readonly datos = signal<VacacionesEmpleado | null>(null);
  readonly cargando = signal(true);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  desde = '';
  hasta = '';
  notas = '';

  /** El input se lee aquí y NO en el constructor (ahí todavía no está asignado). */
  ngOnInit(): void {
    this.api.vacaciones(this.empleado().usuario_id).subscribe({
      next: (d) => {
        this.datos.set(d);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  /** Cuántos días de trabajo son las fechas elegidas. Método: lee campos con ngModel. */
  diasElegidos(): number {
    const d = this.datos();
    if (!d || !this.desde) return 0;
    return diasHabilesEnRango(d.horario, this.desde, this.hasta || this.desde);
  }

  /** El último día de su año de vacaciones (el aniversario es exclusivo). */
  finDeAnio(hasta: string): string {
    return sumarDias(hasta, -1);
  }

  registrar(): void {
    const d = this.datos();
    if (!d || !this.desde) {
      this.error.set('Elige desde cuándo.');
      return;
    }
    const hasta = this.hasta || this.desde;
    if (hasta < this.desde) {
      this.error.set('La fecha final va después de la inicial.');
      return;
    }
    this.ocupado.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    this.api
      .registrarVacaciones(d.usuario_id, { fecha_inicio: this.desde, fecha_fin: hasta, notas: this.notas.trim() || undefined })
      .subscribe({
        next: (nuevo) => {
          const reg = nuevo.registros.find((r) => r.fecha_inicio === this.desde);
          this.datos.set(nuevo);
          this.mensaje.set(
            `Vacaciones registradas: ${Number(reg?.dias ?? 0)} días. Se pagan en la nómina de esa semana como días normales.`
          );
          this.desde = '';
          this.hasta = '';
          this.notas = '';
          this.ocupado.set(false);
          this.cambiado.emit();
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.ocupado.set(false);
        },
      });
  }

  async quitar(r: VacacionesRegistro): Promise<void> {
    const si = await this.confirmacion.pedir({
      titulo: '¿Quitar estas vacaciones?',
      mensaje: `Del ${new FechaPipe().transform(r.fecha_inicio)} al ${new FechaPipe().transform(r.fecha_fin)}: ${Number(r.dias)} días le regresan a su saldo.`,
      aceptar: 'Quitar',
      peligro: true,
    });
    if (!si) return;
    this.ocupado.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    this.api.quitarVacaciones(r.id).subscribe({
      next: (nuevo) => {
        this.datos.set(nuevo);
        this.mensaje.set('Vacaciones quitadas.');
        this.ocupado.set(false);
        this.cambiado.emit();
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.ocupado.set(false);
      },
    });
  }

  num(v: string | number | null | undefined): number {
    return Number(v ?? 0);
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
