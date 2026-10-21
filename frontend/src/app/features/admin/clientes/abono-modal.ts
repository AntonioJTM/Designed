import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { nuevaClave } from '../../../core/clave-unica';
import { FormsModule } from '@angular/forms';
import { TransferenciasService } from '../../../core/services/transferencias.service';
import { CuentaDeposito } from '../../../shared/cuenta-deposito';
import { forkJoin, from, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ClientesService } from '../../../core/services/clientes.service';
import { VentasService } from '../../../core/services/ventas.service';
import { MetodoPago, SesionCaja } from '../../../core/models/ventas.models';
import { AbonoInput, NotaCredito, NotasCredito } from '../../../core/models/clientes.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';
import { turnoPropuesto, turnosAbiertos } from './turnos-caja';

/** Una nota en la lista "A notas": si se marcó y cuánto se le abona (campos de ngModel). */
interface FilaNota {
  nota: NotaCredito;
  elegida: boolean;
  monto: number | null;
}

/**
 * Registrar un abono del cliente. Se abre desde "Cuánto debe" (el botón Abonar
 * de cada renglón), desde el expediente y desde el detalle de una venta a
 * crédito ("Abonar a esta nota"): es el mismo modal en los tres lados.
 *
 * A SU CUENTA o A NOTAS (2026-10-19: "quiero hacer el abono a las notas, no en
 * general; y también así como está, abono a cuenta"). A la cuenta se aplica a
 * la nota más vieja primero, como siempre; a notas, a las que se marquen, cada
 * una con cuánto (de entrada, lo que debe). Las notas son las de sus tiendas y,
 * si el cliente también le compra a la suya, las de las otras (las dice el
 * servidor: `GET /clientes/:id/notas-credito`).
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
  imports: [FormsModule, DineroPipe, FechaPipe, FolioPipe, CuentaDeposito],
  templateUrl: './abono-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
  styles: `
    .moneda { position: relative; display: block; }
    .moneda > span { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--tinta-3); font-weight: 600; }
    .moneda > input { padding-left: 26px; }
    /* El selector "A su cuenta / A notas", como el de la ventana de Ajustar. */
    .seg > label { flex-direction: column; gap: 2px; padding: 10px 12px; min-height: 64px; text-align: center; }
    .seg > label .muted { font-size: 0.75rem; font-weight: 400; }
    .notas-abono { display: flex; flex-direction: column; gap: 8px; }
    .nota-abono .moneda, .nota-abono .moneda > input { width: 100%; }
    .nota-abono {
      display: grid; grid-template-columns: minmax(0, 1fr) min(150px, 40%); gap: 12px; align-items: center;
      padding: 10px 12px; border: 1px solid var(--borde); border-radius: 8px;
    }
    .nota-abono.on { border-color: var(--acento); background: var(--acento-tenue); }
    .nota-abono .marca { display: flex; gap: 10px; align-items: flex-start; min-width: 0; cursor: pointer; }
    .nota-abono .marca input { margin-top: 3px; }
    .nota-abono .folio { font-family: var(--mono); font-weight: 600; }
    .nota-abono .debe { font-variant-numeric: tabular-nums; }
    /* Cómo queda esa nota: a todo lo ancho del renglón; en rojo con su fondo si se pasa. */
    .nota-abono .nota-queda { grid-column: 1 / -1; font-size: 0.8125rem; color: var(--tinta-2); font-variant-numeric: tabular-nums; }
    .nota-abono .nota-queda.pasa { color: var(--peligro-t); background: var(--peligro-f); padding: 4px 8px; border-radius: 6px; }
  `,
})
export class AbonoModal implements OnInit {
  /** La llave de un solo uso de esta operación (2026-10-20): un doble clic no la registra dos veces. */
  private clave = nuevaClave();
  private readonly clientes = inject(ClientesService);
  private readonly ventas = inject(VentasService);

  readonly clienteId = input.required<number>();
  readonly nombre = input.required<string>();
  /** Lo que debe ahora, si quien abre la ventana ya lo sabe (el servidor lo confirma). */
  readonly saldo = input<number | null>(null);
  /** Una nota a crédito para abrir ya en "A notas" con ella marcada (desde el detalle de la venta). */
  readonly nota = input<number | null>(null);

  readonly cerrado = output<void>();
  /** `movimiento_id`: con él se imprime su ticket. */
  readonly registrado = output<{ saldo_nuevo: number; movimiento_id: number }>();

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly metodos = signal<MetodoPago[]>([]);
  /** Los turnos abiertos de todas las cajas activas. */
  readonly turnos = signal<SesionCaja[]>([]);
  /** Lo que debe en total: el del servidor en cuanto llega. */
  readonly debe = signal(0);
  /** Sus notas de otras tiendas que no se pueden escoger aquí. */
  readonly ocultas = signal(0);

  /** A su cuenta (de la más vieja a la más nueva) o a las notas que se marquen. */
  modo: 'cuenta' | 'notas' = 'cuenta';
  filas: FilaNota[] = [];
  monto: number | null = null;
  metodoId: number | null = null;
  turnoId: number | null = null;
  referencia = '';
  /** A qué cuenta llegó, si es por transferencia (Transferencias, 2026-10-20). */
  cuentaId: number | null = null;
  protected readonly transf = inject(TransferenciasService);

  /** Los inputs se leen AQUÍ: en el constructor todavía no están asignados. */
  ngOnInit(): void {
    this.debe.set(Number(this.saldo() ?? 0));
    this.monto = Number(this.saldo() ?? 0) || null;
    forkJoin({
      metodos: this.ventas.metodosPago().pipe(catchError(() => of([] as MetodoPago[]))),
      turnos: from(turnosAbiertos(this.ventas)),
      notas: this.clientes.notasCredito(this.clienteId()).pipe(catchError(() => of(null as NotasCredito | null))),
    }).subscribe(({ metodos, turnos, notas }) => {
      this.metodos.set(metodos);
      this.turnos.set(turnos);
      this.turnoId = turnoPropuesto(turnos);
      if (notas) this.usarNotas(notas);
      this.cargando.set(false);
    });
  }

  private usarNotas(n: NotasCredito): void {
    // Si no se había tocado lo propuesto (todo lo que debe), se propone lo del servidor.
    if (this.monto === (Number(this.saldo() ?? 0) || null)) this.monto = Number(n.saldo) || null;
    this.debe.set(Number(n.saldo));
    this.ocultas.set(n.ocultas);
    this.filas = n.notas.map((nota) => ({ nota, elegida: false, monto: null }));
    const pedida = this.nota();
    if (pedida != null) {
      const fila = this.filas.find((f) => f.nota.pedido_id === pedida);
      if (fila) {
        this.modo = 'notas';
        this.marcar(fila, true);
      } else {
        // Es informativo, no un error (2026-10-20): no va en rojo.
        this.avisoNota.set('Esa nota ya no debe nada o no es de las que puedes cobrar aquí: el abono va a su cuenta.');
      }
    }
  }

  /** Un aviso que no es error (la nota que se pidió ya no se puede escoger). */
  readonly avisoNota = signal<string | null>(null);

  /** El renglón se pasa de lo que debe ESA nota (2026-10-20: se marca en rojo al teclear). */
  pasaDeNota(f: FilaNota): boolean {
    return f.elegida && Number(f.monto ?? 0) > f.nota.por_pagar + 0.001;
  }

  /** Lo que le quedará debiendo a esa nota con lo tecleado (antes → después). */
  quedaNota(f: FilaNota): number {
    return Math.max(0, Math.round((f.nota.por_pagar - Number(f.monto ?? 0)) * 100) / 100);
  }

  /** Al marcar una nota se propone lo que debe; al desmarcarla, deja de contar. */
  marcar(f: FilaNota, elegida: boolean): void {
    f.elegida = elegida;
    if (elegida && !(Number(f.monto) > 0)) f.monto = f.nota.por_pagar;
  }

  /** Lo que se abona con lo que está en pantalla. Método: lee campos de ngModel. */
  montoAbono(): number {
    if (this.modo === 'cuenta') return Number(this.monto ?? 0);
    const suma = this.filas.filter((f) => f.elegida).reduce((s, f) => s + Number(f.monto ?? 0), 0);
    return Math.round(suma * 100) / 100;
  }

  /**
   * Cómo queda su cuenta con lo que se está tecleando (2026-10-19). Es un MÉTODO
   * y no un `computed`: lee campos de ngModel. null si el monto no sirve.
   */
  quedaDebiendo(): { queda: number } | null {
    const m = this.montoAbono();
    const debe = this.debe();
    if (!(m > 0) || m > debe + 0.001) return null;
    // Con un renglón que se pasa de su nota, no se enseña como si estuviera bien.
    if (this.modo === 'notas' && this.filas.some((f) => this.pasaDeNota(f))) return null;
    return { queda: Math.round((debe - m) * 100) / 100 };
  }

  /** A qué cuenta llegó (solo si es por transferencia y se sabe). */
  private cuentaDeposito(): { cuenta_bancaria_id?: number } {
    const c = this.esTransferencia() ? this.transf.elegida(this.cuentaId) : null;
    return c ? { cuenta_bancaria_id: c } : {};
  }

  /** Por transferencia: se pregunta a qué cuenta llegó. Método: lee ngModel. */
  esTransferencia(): boolean {
    const m = this.metodos().find((x) => x.id === Number(this.metodoId));
    return (m?.nombre ?? '').toLowerCase().includes('transferencia');
  }

  /** Método y no `computed`: lee un campo de ngModel. */
  esEfectivo(): boolean {
    const m = this.metodos().find((x) => x.id === Number(this.metodoId));
    return (m?.nombre ?? '').toLowerCase().includes('efectivo');
  }

  /** Lo que se le manda al servidor, o un error que decir. */
  private cuerpo(): Pick<AbonoInput, 'monto' | 'a_notas'> | string {
    if (this.modo === 'cuenta') {
      const monto = Number(this.monto ?? 0);
      if (!(monto > 0)) return 'Pon cuánto está abonando.';
      // Un saldo negativo se leería como crédito a favor, y no es eso.
      if (monto > this.debe() + 0.001) return 'No se puede abonar más de lo que debe.';
      return { monto };
    }
    const elegidas = this.filas.filter((f) => f.elegida);
    if (!elegidas.length) return 'Marca las notas que está pagando.';
    for (const f of elegidas) {
      const m = Number(f.monto ?? 0);
      if (!(m > 0)) return `Pon cuánto abona a la nota ${f.nota.numero_pedido}.`;
      if (m > f.nota.por_pagar + 0.001) {
        return `A la nota ${f.nota.numero_pedido} le faltan ${this.dinero(f.nota.por_pagar)}: no se le puede abonar más.`;
      }
    }
    return { a_notas: elegidas.map((f) => ({ pedido_id: f.nota.pedido_id, monto: Number(f.monto) })) };
  }

  registrar(): void {
    const cuerpo = this.cuerpo();
    if (typeof cuerpo === 'string') {
      this.error.set(cuerpo);
      return;
    }
    if (!this.metodoId) {
      this.error.set('Elige con qué está pagando.');
      return;
    }
    if (this.transf.faltaCuenta(this.esTransferencia(), this.cuentaId)) {
      this.error.set('Elige a qué cuenta llegó la transferencia.');
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
        ...cuerpo,
        metodo_pago_id: Number(this.metodoId),
        sesion_caja_id: this.esEfectivo() ? Number(this.turnoId) : undefined,
        referencia: this.referencia.trim() || undefined,
        ...this.cuentaDeposito(),
      }, this.clave)
      .subscribe({
        next: (r) => {
          this.guardando.set(false);
          this.clave = nuevaClave();
          this.registrado.emit({ saldo_nuevo: Number(r.saldo_nuevo), movimiento_id: Number(r.movimiento_id) });
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

  private dinero(n: number): string {
    return new DineroPipe().transform(n);
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
