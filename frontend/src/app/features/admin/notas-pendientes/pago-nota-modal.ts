import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { VentasService } from '../../../core/services/ventas.service';
import { MetodoPago, NotaPendiente, ResultadoAbono, SesionCaja } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';

/**
 * Registrar el PAGO (o un abono) de una nota pendiente de pago (2026-10-13).
 *
 * El efectivo entra al turno de caja abierto que se elija: así cuenta en el
 * corte del DÍA EN QUE PAGA ("que se agreguen al corte de caja del día en el que
 * paguen", usuario). La transferencia no toca el cajón. Puede pagar en partes;
 * con el último abono la nota queda pagada sola.
 *
 * Es el mismo patrón del abono a la cuenta del cliente (`clientes/abono-modal`):
 * los turnos se buscan al ABRIR, y con varios abiertos se propone el de la caja
 * con que se trabaja (`localStorage['caja_sel']`) o ninguno.
 *
 * No se cierra al hacer clic en el fondo; sale con la ✕, "Cancelar" o Escape.
 */
@Component({
  selector: 'app-pago-nota-modal',
  imports: [FormsModule, DineroPipe],
  templateUrl: './pago-nota-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
  styles: `
    .moneda { position: relative; display: block; }
    .moneda > span { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--tinta-3); font-weight: 600; }
    .moneda > input { padding-left: 26px; }
  `,
})
export class PagoNotaModal implements OnInit {
  private readonly ventas = inject(VentasService);

  readonly nota = input.required<NotaPendiente>();
  readonly cerrado = output<void>();
  readonly registrado = output<ResultadoAbono>();

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly metodos = signal<MetodoPago[]>([]);
  readonly turnos = signal<SesionCaja[]>([]);

  monto: number | null = null;
  metodoId: number | null = null;
  turnoId: number | null = null;
  referencia = '';

  /** Los inputs se leen AQUÍ: en el constructor todavía no están asignados. */
  ngOnInit(): void {
    this.monto = Number(this.nota().falta) || null;
    forkJoin({
      metodos: this.ventas.metodosPago().pipe(catchError(() => of([] as MetodoPago[]))),
      turnos: this.buscarTurnos(),
    }).subscribe(({ metodos, turnos }) => {
      this.metodos.set(metodos);
      this.metodoId = metodos.find((m) => m.nombre.toLowerCase().includes('efectivo'))?.id ?? metodos[0]?.id ?? null;
      this.turnos.set(turnos);
      this.turnoId = this.turnoPropuesto(turnos);
      this.cargando.set(false);
    });
  }

  quien(): string {
    const n = this.nota();
    return n.nombre_comercial || n.cliente || 'el cliente';
  }

  /** Método y no `computed`: lee campos de ngModel. */
  esEfectivo(): boolean {
    const m = this.metodos().find((x) => x.id === Number(this.metodoId));
    return (m?.nombre ?? '').toLowerCase().includes('efectivo');
  }

  /** Lo que le quedaría por pagar después de este pago. Método: lee ngModel. */
  quedaria(): number {
    return Math.max(0, Math.round((Number(this.nota().falta) - Number(this.monto ?? 0)) * 100) / 100);
  }

  registrar(): void {
    const monto = Number(this.monto ?? 0);
    const falta = Number(this.nota().falta);
    if (!(monto > 0)) {
      this.error.set('Pon cuánto está pagando.');
      return;
    }
    if (monto > falta + 0.001) {
      this.error.set(`Le faltan ${this.dinero(falta)}: no se puede cobrar más.`);
      return;
    }
    if (!this.metodoId) {
      this.error.set('Elige con qué está pagando.');
      return;
    }
    if (this.esEfectivo() && !this.turnoId) {
      this.error.set(
        this.turnos().length > 1
          ? 'Elige a qué caja entra el efectivo: es la que lo recibió.'
          : 'El efectivo tiene que entrar en un turno de caja abierto, o el corte no va a cuadrar. ' +
            'Abre el turno en Caja, o registra el pago por transferencia.'
      );
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.ventas
      .pagarNota(this.nota().id, {
        monto,
        metodo_pago_id: Number(this.metodoId),
        sesion_caja_id: this.esEfectivo() ? Number(this.turnoId) : undefined,
        referencia: this.referencia.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.guardando.set(false);
          this.registrado.emit(r);
        },
        error: (e) => {
          this.guardando.set(false);
          this.error.set(this.msg(e));
        },
      });
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  /** El turno donde cae el efectivo: el único abierto, o el de la caja con que se trabaja. */
  private turnoPropuesto(turnos: SesionCaja[]): number | null {
    if (turnos.length === 1) return turnos[0].id;
    let elegida: number | null = null;
    try {
      const v = Number(localStorage.getItem('caja_sel'));
      elegida = Number.isFinite(v) && v > 0 ? v : null;
    } catch {
      elegida = null;
    }
    return turnos.find((t) => Number(t.caja_id) === elegida)?.id ?? null;
  }

  /** Prueba caja por caja; una caja que falla no tumba la búsqueda. */
  private buscarTurnos() {
    return new Promise<SesionCaja[]>((resolver) => {
      this.ventas.cajas().subscribe({
        next: (cajas) => {
          const activas = cajas.filter((c) => c.activo);
          if (activas.length === 0) return resolver([]);
          forkJoin(activas.map((c) => this.ventas.sesionAbierta(c.id).pipe(catchError(() => of(null))))).subscribe(
            (ss) => resolver(ss.filter((s): s is SesionCaja => !!s))
          );
        },
        error: () => resolver([]),
      });
    });
  }

  private dinero(n: number): string {
    return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
