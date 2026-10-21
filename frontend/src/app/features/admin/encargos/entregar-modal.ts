import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { nuevaClave } from '../../../core/clave-unica';
import { FormsModule } from '@angular/forms';
import { TransferenciasService } from '../../../core/services/transferencias.service';
import { CuentaDeposito } from '../../../shared/cuenta-deposito';
import { PlazoCredito, PLAZO_CREDITO_POR_OMISION, plazoValido } from '../../../shared/plazo-credito';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { VentasService } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { Encargo, MetodoPago, Pedido, SesionCaja } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';

/**
 * ENTREGAR una nota en espera (encargo): aquí se cobra lo que falta —a crédito,
 * o como NOTA PENDIENTE DE PAGO (2026-10-13)— y la mercancía sale del
 * inventario. Lo que ya dejó pagado se descuenta solo.
 *
 *   · Se cobra con un método; en efectivo se teclea lo recibido y se da cambio,
 *     y el dinero entra a un turno de caja abierto (el de la caja elegida en el
 *     punto de venta, `localStorage['caja_sel']`, o el único abierto).
 *   · Si se cobra menos de lo que falta, el resto se FÍA (pide «Fiar» y el
 *     servidor revisa su crédito).
 *   · Sin nada pendiente, solo se entrega.
 *   · Si al modificarlo quedó en MENOS de lo que dejó pagado, se le devuelve la
 *     diferencia en efectivo: sale de un turno abierto.
 */
@Component({
  selector: 'app-entregar-pedido-modal',
  imports: [FormsModule, DineroPipe, CuentaDeposito, PlazoCredito],
  templateUrl: './entregar-modal.html',
  styleUrl: './entregar-modal.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class EntregarPedidoModal implements OnInit {
  /** La llave de un solo uso de esta operación (2026-10-20): un doble clic no la registra dos veces. */
  private clave = nuevaClave();
  private readonly ventas = inject(VentasService);
  private readonly auth = inject(AuthService);
  private readonly confirmacion = inject(ConfirmacionService);

  readonly pedido = input.required<Encargo>();
  readonly cerrado = output<void>();
  readonly entregado = output<Pedido>();

  readonly metodos = signal<MetodoPago[]>([]);
  readonly turnos = signal<SesionCaja[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  readonly puedeFiar = computed(() => this.auth.puede('hacer:fiar'));

  /** Lo que se cobra ahora (vacío = todo lo que falta). */
  cobra: number | null = null;
  metodoId: number | null = null;
  /** Por transferencia: a qué cuenta llegó y su número de operación (Transferencias, 2026-10-20). */
  cuentaId: number | null = null;
  operacion = '';
  protected readonly transf = inject(TransferenciasService);
  /** Lo que entrega en efectivo (vacío = justo). */
  recibido: number | null = null;
  turnoId: number | null = null;
  /** Lo que no se cobra, va a crédito. */
  fiarResto = false;
  /** A cuántos días queda lo que se fía (2026-10-20). */
  diasCredito: number | null = PLAZO_CREDITO_POR_OMISION;
  /**
   * Se la lleva como NOTA PENDIENTE DE PAGO: no se cobra nada ahora y el pago se
   * registra después, en Notas pendientes de pago.
   */
  comoNota = false;
  /** Pagar primero con su SALDO A FAVOR (anticipos, lo que regresó; 2026-10-20). */
  usarFavor = false;

  ngOnInit(): void {
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

  /** Lo que falta de la nota, sin contar su saldo a favor. */
  faltaNota(): number {
    return Number(this.pedido().falta);
  }

  /** Su saldo a favor (lo que la tienda le guarda). */
  saldoFavor(): number {
    return Math.max(0, Number(this.pedido().saldo_favor ?? 0));
  }

  /** Lo que se paga con su saldo a favor: todo lo que alcance, hasta lo que falta. */
  favor(): number {
    if (!this.usarFavor || this.aFavor() > 0) return 0;
    return Math.round(Math.min(this.saldoFavor(), this.faltaNota()) * 100) / 100;
  }

  /** Lo que falta por cobrar (o dar a crédito) después de su saldo a favor. Método: lee ngModel. */
  falta(): number {
    return Math.max(0, Math.round((this.faltaNota() - this.favor()) * 100) / 100);
  }

  /** Pagó de más (el pedido pesó menos): se le devuelve al entregar. */
  aFavor(): number {
    return Number(this.pedido().a_favor ?? 0);
  }

  /** Lo que se cobra ahora. Método: lee campos de ngModel. */
  aCobrar(): number {
    const c = this.cobra == null || (this.cobra as unknown) === '' ? this.falta() : Number(this.cobra);
    return Math.max(0, Math.round(c * 100) / 100);
  }

  /** Lo que queda sin cobrar: se fía si se marca, si no, no se puede entregar. */
  resto(): number {
    return Math.max(0, Math.round((this.falta() - this.aCobrar()) * 100) / 100);
  }

  esEfectivo(): boolean {
    const m = this.metodos().find((x) => x.id === Number(this.metodoId));
    return (m?.nombre ?? '').toLowerCase().includes('efectivo');
  }

  esTransferencia(): boolean {
    const m = this.metodos().find((x) => x.id === Number(this.metodoId));
    return (m?.nombre ?? '').toLowerCase().includes('transferencia');
  }

  cambio(): number {
    if (!this.esEfectivo() || this.recibido == null || (this.recibido as unknown) === '') return 0;
    return Math.max(0, Math.round((Number(this.recibido) - this.aCobrar()) * 100) / 100);
  }

  /** Por qué no se puede entregar todavía, o null. */
  motivo(): string | null {
    if (this.comoNota && this.falta() > 0) return null;
    if (this.aFavor() > 0) {
      if (this.turnoId) return null;
      return this.turnos().length === 0
        ? 'Hay que devolverle efectivo y no hay ningún turno de caja abierto: ábrelo en Caja.'
        : 'Elige de qué caja sale lo que se le devuelve.';
    }
    if (this.aCobrar() > this.falta() + 0.001) return 'No se puede cobrar más de lo que falta.';
    if (this.resto() > 0.004 && this.fiarResto && !plazoValido(this.diasCredito)) {
      return 'Di a cuántos días queda la nota a crédito (de 1 a 365).';
    }
    if (this.resto() > 0.004 && !this.fiarResto) {
      return this.puedeFiar()
        ? `Faltan ${this.dinero(this.resto())}: cóbralos, márcalos a crédito o entrégala como pendiente de pago.`
        : `Faltan ${this.dinero(this.resto())}: cóbralos o entrégala como pendiente de pago.`;
    }
    if (this.aCobrar() > 0 && !this.metodoId) return 'Elige con qué paga.';
    if (this.aCobrar() > 0 && this.transf.faltaCuenta(this.esTransferencia(), this.cuentaId)) {
      return 'Elige a qué cuenta llegó la transferencia.';
    }
    if (this.aCobrar() > 0 && this.esEfectivo()) {
      if (!this.turnoId) {
        return this.turnos().length === 0
          ? 'No hay ningún turno de caja abierto: el efectivo tiene que entrar a uno. Ábrelo en Caja o cobra con otro método.'
          : 'Elige a qué caja entra el efectivo.';
      }
      if (this.recibido != null && (this.recibido as unknown) !== '' && Number(this.recibido) + 0.001 < this.aCobrar()) {
        return `Recibió menos de lo que se cobra (${this.dinero(this.aCobrar())}).`;
      }
    }
    return null;
  }

  entregar(): void {
    const m = this.motivo();
    if (m) {
      this.error.set(m);
      return;
    }
    if (this.aFavor() > 0) {
      this.enviar({ sesion_caja_id: Number(this.turnoId) });
      return;
    }
    // Solo se manda si se usa (el cuerpo va igual que antes si no).
    const conFavor = this.favor() > 0 ? { saldo_favor: this.favor() } : {};
    if (this.comoNota && this.falta() > 0) {
      this.enviar({ pendiente_pago: true, ...conFavor });
      return;
    }
    const cobra = this.aCobrar();
    const efectivo = this.esEfectivo();
    const recibido = efectivo && this.recibido != null && (this.recibido as unknown) !== '' ? Number(this.recibido) : cobra;
    const fiado = this.fiarResto ? this.resto() : 0;
    this.enviar({
      pagos: cobra > 0 ? [{
        metodo_pago_id: Number(this.metodoId), monto: recibido,
        ...(this.esTransferencia() && this.transf.elegida(this.cuentaId) ? { cuenta_bancaria_id: this.transf.elegida(this.cuentaId)! } : {}),
        ...(this.esTransferencia() && this.operacion.trim() ? { referencia_transaccion: this.operacion.trim() } : {}),
      }] : undefined,
      sesion_caja_id: cobra > 0 && efectivo ? Number(this.turnoId) : undefined,
      a_credito: fiado > 0 ? fiado : undefined,
      ...(fiado > 0 ? { dias_credito: Number(this.diasCredito) } : {}),
      ...conFavor,
    });
  }

  private enviar(body: Parameters<VentasService['entregarPedido']>[1]): void {
    this.guardando.set(true);
    this.error.set(null);
    this.ventas
      .entregarPedido(this.pedido().id, body, this.clave)
      .subscribe({
        next: (p) => {
          this.guardando.set(false);
          this.clave = nuevaClave();
          this.entregado.emit(p);
        },
        error: async (e) => {
          this.guardando.set(false);
          // Con la cuenta atrasada se pregunta (y, si no lo hace directo, se autoriza).
          const api = (e as { error?: { error?: ApiError } })?.error?.error;
          if (api?.code === 'CREDITO_ATRASADO' && !body.fiar_con_atraso) {
            if (!this.auth.puedeOPide('hacer:fiar_atrasado')) {
              this.error.set(`${api.message} Tu puesto no le puede dar a crédito así.`);
              return;
            }
            const si = await this.confirmacion.pedir({
              titulo: '¿Darle a crédito con la cuenta atrasada?', mensaje: api.message,
              aceptar: 'Darle a crédito de todos modos', peligro: true,
            });
            if (si) this.enviar({ ...body, fiar_con_atraso: true });
            return;
          }
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

  /** Los turnos abiertos de las cajas activas (una caja que falla no tumba la búsqueda). */
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
