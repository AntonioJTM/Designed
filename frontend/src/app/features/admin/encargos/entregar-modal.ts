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
import { Encargo, MetodoPago, Pedido } from '../../../core/models/ventas.models';
import {
  TurnoAbierto, avisoOtraTienda, buscarTurnos, nombreTurno, turnoPropuesto, turnoUnicoAqui,
} from '../../../shared/turnos-de-la-nota';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';

/**
 * ENTREGAR una nota en espera (encargo): aquí se cobra lo que falta —a crédito,
 * o como NOTA PENDIENTE DE PAGO (2026-10-13)— y la mercancía sale del
 * inventario. Lo que ya dejó pagado se descuenta solo.
 *
 *   · Se cobra con UNA forma —efectivo, transferencia o a crédito— o con DOS
 *     (2026-10-23, usuario: "que se puedan seleccionar hasta 2 métodos de pago"):
 *     efectivo y transferencia (2026-10-21), efectivo y crédito, o transferencia
 *     y crédito. Con dos se teclea una parte y el resto va en la otra. En
 *     efectivo se teclea lo recibido y se da cambio, y el dinero entra a un
 *     turno de caja abierto (el de la caja elegida en el punto de venta,
 *     `localStorage['caja_sel']`, o el único abierto).
 *   · Lo que va a crédito pide «Vender a crédito» (y el servidor revisa su
 *     crédito) y a cuántos días.
 *   · Su SALDO A FAVOR es una forma más (2026-10-23, usuario: "que igual se pueda
 *     pagar con saldo a favor si es que tiene el cliente"): «Todo con su saldo a
 *     favor» si le alcanza, o «Saldo a favor y efectivo / transferencia /
 *     crédito» (usa todo lo que alcance y el resto va en la otra). Como nota
 *     pendiente de pago sigue siendo la casilla.
 *   · Sin nada pendiente, solo se entrega.
 *   · Si al modificarlo quedó en MENOS de lo que dejó pagado, se le devuelve la
 *     diferencia en efectivo: sale de un turno abierto.
 */
/** Cómo se paga lo que falta: un método (su id), a crédito, o dos formas (con su saldo a favor, también). */
export type FormaPago =
  | number | 'credito' | 'mixto' | 'efectivo_credito' | 'transferencia_credito'
  | 'saldo' | 'saldo_efectivo' | 'saldo_transferencia' | 'saldo_credito';

@Component({
  selector: 'app-entregar-pedido-modal',
  imports: [FormsModule, DineroPipe, CuentaDeposito, PlazoCredito],
  templateUrl: './entregar-modal.html',
  styleUrl: './entregar-modal.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class EntregarPedidoModal implements OnInit {
  /** El número que se sugiere en el campo (sin "$" ni comas: es un campo numérico). */
  comoCampo(v: number): string {
    return Number(v ?? 0).toFixed(2);
  }

  /** La llave de un solo uso de esta operación (2026-10-20): un doble clic no la registra dos veces. */
  private clave = nuevaClave();
  private readonly ventas = inject(VentasService);
  private readonly auth = inject(AuthService);
  private readonly confirmacion = inject(ConfirmacionService);

  readonly pedido = input.required<Encargo>();
  readonly cerrado = output<void>();
  readonly entregado = output<Pedido>();

  readonly metodos = signal<MetodoPago[]>([]);
  readonly turnos = signal<TurnoAbierto[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  readonly puedeFiar = computed(() => this.auth.puede('hacer:fiar'));

  /**
   * Cómo paga lo que falta: el id de un método, 'credito', o dos formas: 'mixto'
   * (transferencia y el resto en efectivo), 'efectivo_credito' o
   * 'transferencia_credito' (lo que paga hoy y el resto a crédito).
   */
  metodoId: FormaPago | null = null;
  /**
   * Con dos formas, la parte que se teclea: lo que paga por transferencia
   * ('mixto') o lo que paga hoy (con crédito). El resto va en la otra.
   */
  parte: number | null = null;
  /** Por transferencia: a qué cuenta llegó y su número de operación (Transferencias, 2026-10-20). */
  cuentaId: number | null = null;
  operacion = '';
  protected readonly transf = inject(TransferenciasService);
  /** Lo que entrega en efectivo (vacío = justo). */
  recibido: number | null = null;
  turnoId: number | null = null;
  /** A cuántos días queda lo que se fía (2026-10-20). */
  diasCredito: number | null = PLAZO_CREDITO_POR_OMISION;
  /**
   * Se la lleva como NOTA PENDIENTE DE PAGO: no se cobra nada ahora y el pago se
   * registra después, en Notas pendientes de pago.
   */
  comoNota = false;
  /** Como nota pendiente de pago: pagar primero una parte con su SALDO A FAVOR (2026-10-20). */
  usarFavor = false;

  ngOnInit(): void {
    forkJoin({
      metodos: this.ventas.metodosPago().pipe(catchError(() => of([] as MetodoPago[]))),
      turnos: buscarTurnos(this.ventas),
    }).subscribe(({ metodos, turnos }) => {
      this.metodos.set(metodos);
      this.metodoId = metodos.find((m) => m.nombre.toLowerCase().includes('efectivo'))?.id ?? metodos[0]?.id ?? null;
      this.turnos.set(turnos);
      this.turnoId = turnoPropuesto(turnos, this.pedido().almacen_id);
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

  /**
   * Lo que se paga con su saldo a favor: todo lo que alcance, hasta lo que falta.
   * Cobrando, si la forma lo lleva; como nota pendiente de pago, con la casilla.
   */
  favor(): number {
    if (this.aFavor() > 0) return 0;
    if (!(this.comoNota ? this.usarFavor : this.conSaldo())) return 0;
    return Math.round(Math.min(this.saldoFavor(), this.faltaNota()) * 100) / 100;
  }

  /** La forma lleva su saldo a favor ('saldo' o 'saldo_…'). */
  conSaldo(): boolean {
    return typeof this.metodoId === 'string' && this.metodoId.startsWith('saldo');
  }

  /** Su saldo a favor alcanza para toda la nota. */
  saldoCubreTodo(): boolean {
    return this.saldoFavor() > 0 && this.saldoFavor() + 0.004 >= this.faltaNota();
  }

  /** Cómo se paga lo que queda después de su saldo a favor (sin saldo, la forma elegida). */
  base(): FormaPago | null {
    switch (this.metodoId) {
      case 'saldo': return null;
      case 'saldo_efectivo': return this.idDe('efectivo');
      case 'saldo_transferencia': return this.idDe('transferencia');
      case 'saldo_credito': return 'credito';
      default: return this.metodoId;
    }
  }

  /** "Usa $300.00 de su saldo a favor (le quedan $0.00); el resto, $2,717.55, en efectivo." */
  resumenSaldo(): string {
    const queda = this.dinero(Math.max(0, Math.round((this.saldoFavor() - this.favor()) * 100) / 100));
    const usa = `Usa ${this.dinero(this.favor())} de su saldo a favor (le quedan ${queda})`;
    if (this.falta() <= 0) return `${usa} y con eso queda pagada.`;
    const como = this.base() === 'credito' ? 'va a su cuenta de crédito'
      : this.esEfectivo() ? 'en efectivo' : this.esTransferencia() ? 'por transferencia' : 'con el otro método';
    return `${usa}; el resto, ${this.dinero(this.falta())}, ${como}.`;
  }

  /** Lo que falta por cobrar (o dar a crédito) después de su saldo a favor. Método: lee ngModel. */
  falta(): number {
    return Math.max(0, Math.round((this.faltaNota() - this.favor()) * 100) / 100);
  }

  /** Pagó de más (el pedido pesó menos): se le devuelve al entregar. */
  aFavor(): number {
    return Number(this.pedido().a_favor ?? 0);
  }

  /** Va algo a crédito: solo a crédito, o con efectivo o transferencia. */
  conCredito(): boolean {
    const b = this.base();
    return b === 'credito' || b === 'efectivo_credito' || b === 'transferencia_credito';
  }

  /** Paga con DOS formas: se teclea una parte y el resto va en la otra. */
  dosFormas(): boolean {
    return this.esMixto() || this.base() === 'efectivo_credito' || this.base() === 'transferencia_credito';
  }

  /** La parte tecleada (con dos formas), o 0. Método: lee ngModel. */
  montoParte(): number {
    if (!this.dosFormas()) return 0;
    const v = Number(this.parte);
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
  }

  /** Lo que va a su cuenta de crédito: todo (a crédito) o lo que no paga hoy. */
  aCredito(): number {
    if (this.base() === 'credito') return this.falta();
    if (this.base() === 'efectivo_credito' || this.base() === 'transferencia_credito') {
      return Math.max(0, Math.round((this.falta() - this.montoParte()) * 100) / 100);
    }
    return 0;
  }

  /** Lo que se cobra ahora (en dinero): lo que falta menos lo que va a crédito. */
  aCobrar(): number {
    return Math.max(0, Math.round((this.falta() - this.aCredito()) * 100) / 100);
  }

  /** Paga en efectivo: solo efectivo, o la parte de hoy en efectivo y crédito. */
  esEfectivo(): boolean {
    const b = this.base();
    return b === 'efectivo_credito' || (b != null && b === this.idDe('efectivo'));
  }

  /** Paga por transferencia: solo transferencia, o la parte de hoy en transferencia y crédito. */
  esTransferencia(): boolean {
    const b = this.base();
    return b === 'transferencia_credito' || (b != null && b === this.idDe('transferencia'));
  }

  /** El id del método cuyo nombre lleva ese texto ("efectivo", "transferencia"). */
  idDe(texto: string): number | null {
    return this.metodos().find((m) => m.nombre.toLowerCase().includes(texto))?.id ?? null;
  }

  /** Se cambió la forma de pagar: la parte tecleada era de la anterior. */
  cambiarForma(forma: FormaPago | null): void {
    this.metodoId = forma;
    this.parte = null;
  }

  /** El rótulo de la parte que se teclea con dos formas. */
  etiquetaParte(): string {
    if (this.esMixto()) return 'Por transferencia';
    return this.base() === 'efectivo_credito' ? 'Paga hoy en efectivo' : 'Paga hoy por transferencia';
  }

  /** Debajo de la parte: a dónde va el resto. Método: lee ngModel. */
  ayudaParte(): string {
    if (this.esMixto()) return `El resto, ${this.dinero(this.enEfectivo())}, en efectivo.`;
    return `El resto, ${this.dinero(this.aCredito())}, va a crédito.`;
  }

  /**
   * COBRAR PARTE Y PARTE (2026-10-21, usuario: "cuando se cobra no deja
   * seleccionar dos formas de pago"): "Efectivo y transferencia", como en la caja,
   * si existen los dos métodos. Se teclea lo que paga por transferencia y el resto
   * de lo que se cobra va en efectivo (solo el efectivo da cambio).
   */
  permiteMixto(): boolean {
    return !!this.idDe('efectivo') && !!this.idDe('transferencia');
  }

  esMixto(): boolean {
    return this.base() === 'mixto';
  }

  /** Lo que se cobra en efectivo: todo (si es efectivo) o lo que no cubre la transferencia. */
  enEfectivo(): number {
    if (this.esMixto()) return Math.max(0, Math.round((this.aCobrar() - this.montoParte()) * 100) / 100);
    return this.esEfectivo() ? this.aCobrar() : 0;
  }

  /** Lo que se cobra por transferencia: todo, o la parte tecleada en parte y parte. */
  enTransferencia(): number {
    if (this.esMixto()) return Math.min(this.montoParte(), this.aCobrar());
    return this.esTransferencia() ? this.aCobrar() : 0;
  }

  /** Un método que no es efectivo ni transferencia (si algún día se activa otro). */
  enOtroMetodo(): number {
    return typeof this.base() === 'number' && !this.esEfectivo() && !this.esTransferencia() ? this.aCobrar() : 0;
  }

  /** Algo de lo que se cobra va en efectivo: pide lo recibido y la caja. */
  llevaEfectivo(): boolean {
    return this.enEfectivo() > 0;
  }

  /** Algo de lo que se cobra va por transferencia: pide la cuenta y el folio. */
  llevaTransferencia(): boolean {
    return this.enTransferencia() > 0;
  }

  /** Con crédito, cómo queda repartido ("Hoy paga $1,000.00 en efectivo y $2,017.50 van a su crédito."). */
  resumenCredito(): string {
    const cr = this.dinero(this.aCredito());
    if (this.base() === 'credito') return `Los ${cr} van a su cuenta de crédito.`;
    const como = this.base() === 'efectivo_credito' ? 'en efectivo' : 'por transferencia';
    return `Hoy paga ${this.dinero(this.aCobrar())} ${como} y ${cr} van a su cuenta de crédito.`;
  }

  cambio(): number {
    if (!this.llevaEfectivo() || this.recibido == null || (this.recibido as unknown) === '') return 0;
    return Math.max(0, Math.round((Number(this.recibido) - this.enEfectivo()) * 100) / 100);
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
    if (this.conSaldo() && !(this.saldoFavor() > 0)) return 'No tiene saldo a favor: elige con qué paga.';
    if (this.metodoId === 'saldo' && this.falta() > 0) {
      return `Su saldo a favor no alcanza: elige «Saldo a favor y …» para pagar los ${this.dinero(this.falta())} que faltan.`;
    }
    if (this.falta() <= 0) return null;
    if (!this.metodoId || !this.base()) return 'Elige con qué paga.';
    if (this.conCredito() && !this.puedeFiar()) return 'Tu puesto no tiene permiso para «Vender a crédito».';
    if (this.dosFormas()) {
      if (!(this.montoParte() > 0)) {
        return this.esMixto() ? 'Pon cuánto paga por transferencia.' : `Pon cuánto ${this.etiquetaParte().toLowerCase()}.`;
      }
      if (this.esMixto() && this.montoParte() > this.falta() + 0.001) {
        return `Por transferencia son a lo más ${this.dinero(this.falta())}: la transferencia no da cambio.`;
      }
      if (this.conCredito() && this.montoParte() > this.falta() - 0.004) {
        return `Si hoy paga todo (${this.dinero(this.falta())}), elige solo ${this.base() === 'efectivo_credito' ? 'Efectivo' : 'Transferencia'}: ` +
          'a crédito va lo que NO paga hoy.';
      }
    }
    if (this.aCredito() > 0 && !plazoValido(this.diasCredito)) {
      return 'Di a cuántos días queda la nota a crédito (de 1 a 365).';
    }
    if (this.transf.faltaCuenta(this.llevaTransferencia(), this.cuentaId)) {
      return 'Elige a qué cuenta llegó la transferencia.';
    }
    if (this.llevaEfectivo()) {
      if (!this.turnoId) {
        return this.turnos().length === 0
          ? 'No hay ningún turno de caja abierto: el efectivo tiene que entrar a uno. Ábrelo en Caja o cobra con otro método.'
          : 'Elige a qué caja entra el efectivo.';
      }
      if (this.recibido != null && (this.recibido as unknown) !== '' && Number(this.recibido) + 0.001 < this.enEfectivo()) {
        return this.dosFormas()
          ? `Recibió menos de lo que va en efectivo (${this.dinero(this.enEfectivo())}).`
          : `Recibió menos de lo que se cobra (${this.dinero(this.aCobrar())}).`;
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
    const enEfectivo = this.enEfectivo();
    const enTransferencia = this.enTransferencia();
    const otro = this.enOtroMetodo();
    // Lo que entrega en efectivo (vacío = justo): el servidor resta el cambio.
    const recibido = enEfectivo > 0 && this.recibido != null && (this.recibido as unknown) !== '' ? Number(this.recibido) : enEfectivo;
    const cuenta = this.transf.elegida(this.cuentaId);
    const datosTransf = {
      ...(cuenta ? { cuenta_bancaria_id: cuenta } : {}),
      ...(this.operacion.trim() ? { referencia_transaccion: this.operacion.trim() } : {}),
    };
    const fiado = this.aCredito();
    // Hasta dos formas: la transferencia, el efectivo (lo recibido) y lo que va a crédito.
    const pagos: { metodo_pago_id: number; monto: number; cuenta_bancaria_id?: number; referencia_transaccion?: string }[] = [];
    if (enTransferencia > 0) {
      pagos.push({ metodo_pago_id: Number(this.idDe('transferencia')), monto: enTransferencia, ...datosTransf });
    }
    if (enEfectivo > 0) pagos.push({ metodo_pago_id: Number(this.idDe('efectivo')), monto: recibido });
    if (otro > 0) pagos.push({ metodo_pago_id: Number(this.base()), monto: otro });
    this.enviar({
      pagos: pagos.length ? pagos : undefined,
      sesion_caja_id: enEfectivo > 0 ? Number(this.turnoId) : undefined,
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

  // ---- EL TURNO DE LA TIENDA DE LA NOTA (2026-10-26): `shared/turnos-de-la-nota.ts`.
  /** Hay un solo turno abierto y es de la tienda de la nota: no hay qué preguntar. */
  turnoUnicoAqui(): boolean {
    return turnoUnicoAqui(this.turnos(), this.pedido().almacen_id);
  }

  nombreTurno(t: TurnoAbierto): string {
    return nombreTurno(t, this.pedido().almacen_id);
  }

  /** El elegido es de otra tienda: en qué corte cae el efectivo. */
  avisoOtraTienda(): string | null {
    return avisoOtraTienda(this.turnos(), this.turnoId, this.pedido().almacen_id, this.pedido().almacen);
  }

  private dinero(n: number): string {
    return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
