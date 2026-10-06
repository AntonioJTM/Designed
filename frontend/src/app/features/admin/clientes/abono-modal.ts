import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ClientesService } from '../../../core/services/clientes.service';
import { VentasService } from '../../../core/services/ventas.service';
import { MetodoPago, SesionCaja } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';

/**
 * Registrar un abono del cliente. Se abre desde "Cuánto debe" (el botón Abonar
 * de cada renglón) y desde el expediente: es el mismo modal en los dos lados.
 *
 * Un abono en EFECTIVO tiene que entrar a un turno de caja abierto, o el corte
 * no cuadra: entra dinero al cajón que ninguna venta explica. Por eso los
 * turnos se buscan al ABRIR el modal, para avisar antes de teclear el monto y
 * no al confirmar. Si hay más de un turno abierto (dos tiendas), se elige a
 * cuál entra: viene puesto el de la caja con que se está trabajando (la que
 * recuerdan el punto de venta y Caja en `localStorage['caja_sel']`); si no hay
 * una elegida, no se propone ninguno y hay que escogerlo. Antes se proponía el
 * primero de la lista y el efectivo de una tienda caía en el turno de otra.
 *
 * No se cierra al hacer clic en el fondo; sale con la ✕, "Cancelar" o Escape.
 */
@Component({
  selector: 'app-abono-modal',
  imports: [FormsModule, DineroPipe],
  templateUrl: './abono-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
  styles: `
    .moneda { position: relative; display: block; }
    .moneda > span { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--tinta-3); font-weight: 600; }
    .moneda > input { padding-left: 26px; }
  `,
})
export class AbonoModal implements OnInit {
  private readonly clientes = inject(ClientesService);
  private readonly ventas = inject(VentasService);

  readonly clienteId = input.required<number>();
  readonly nombre = input.required<string>();
  /** Lo que debe ahora: no se puede abonar más que eso. */
  readonly saldo = input.required<number>();

  readonly cerrado = output<void>();
  readonly registrado = output<{ saldo_nuevo: number }>();

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly metodos = signal<MetodoPago[]>([]);
  /** Los turnos abiertos de todas las cajas activas. */
  readonly turnos = signal<SesionCaja[]>([]);

  monto: number | null = null;
  metodoId: number | null = null;
  turnoId: number | null = null;
  referencia = '';

  /** Los inputs se leen AQUÍ: en el constructor todavía no están asignados. */
  ngOnInit(): void {
    this.monto = Number(this.saldo()) || null;
    forkJoin({
      metodos: this.ventas.metodosPago().pipe(catchError(() => of([] as MetodoPago[]))),
      turnos: this.buscarTurnos(),
    }).subscribe(({ metodos, turnos }) => {
      this.metodos.set(metodos);
      this.turnos.set(turnos);
      this.turnoId = this.turnoPropuesto(turnos);
      this.cargando.set(false);
    });
  }

  /**
   * El turno donde cae el efectivo: el único abierto, o el de la caja con que se
   * está trabajando. Con varios abiertos y ninguna elegida, ninguno: adivinar
   * descuadra dos cortes a la vez.
   */
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

  /** Método y no `computed`: lee un campo de ngModel. */
  esEfectivo(): boolean {
    const m = this.metodos().find((x) => x.id === Number(this.metodoId));
    return (m?.nombre ?? '').toLowerCase().includes('efectivo');
  }

  registrar(): void {
    const monto = Number(this.monto ?? 0);
    if (!(monto > 0)) {
      this.error.set('Pon cuánto está abonando.');
      return;
    }
    if (monto > Number(this.saldo()) + 0.001) {
      // Un saldo negativo se leería como crédito a favor, y no es eso.
      this.error.set('No se puede abonar más de lo que debe.');
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
          : 'Un abono en efectivo tiene que entrar en un turno de caja abierto, o el corte no va a ' +
            'cuadrar. Abre el turno en Caja, o registra el abono con otro método.'
      );
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.clientes
      .abonar(this.clienteId(), {
        monto,
        metodo_pago_id: Number(this.metodoId),
        sesion_caja_id: this.esEfectivo() ? Number(this.turnoId) : undefined,
        referencia: this.referencia.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.guardando.set(false);
          this.registrado.emit({ saldo_nuevo: Number(r.saldo_nuevo) });
          this.cerrar();
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

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
