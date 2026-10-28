import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { nuevaClave } from '../../../core/clave-unica';
import { FormsModule } from '@angular/forms';
import { TransferenciasService } from '../../../core/services/transferencias.service';
import { CuentaDeposito } from '../../../shared/cuenta-deposito';
import { PlazoCredito, PLAZO_CREDITO_POR_OMISION, plazoValido } from '../../../shared/plazo-credito';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { VentasService, PagoNotaInput } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { MetodoPago, NotaPendiente, ResultadoAbono } from '../../../core/models/ventas.models';
import {
  TurnoAbierto, avisoOtraTienda, buscarTurnos, nombreTurno, turnoPropuesto, turnoUnicoAqui,
} from '../../../shared/turnos-de-la-nota';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';

/**
 * Cómo se paga lo que falta de una nota: un método (su id), a crédito, su saldo a
 * favor, o DOS formas (2026-10-26).
 */
export type FormaNota =
  | number | 'credito' | 'saldo'
  | 'mixto' | 'efectivo_credito' | 'transferencia_credito'
  | 'saldo_efectivo' | 'saldo_transferencia' | 'saldo_credito';

/**
 * Registrar el PAGO (o un abono) de una nota pendiente de pago (2026-10-13).
 *
 * El efectivo entra al turno de caja abierto que se elija: así cuenta en el
 * corte del DÍA EN QUE PAGA ("que se agreguen al corte de caja del día en el que
 * paguen", usuario). La transferencia no toca el cajón. Puede pagar en partes;
 * con el último abono la nota queda pagada sola.
 *
 * HASTA DOS FORMAS (2026-10-26, usuario: "cuando se registra pago, que tenga
 * múltiples formas de pago: crédito, efectivo y transferencia o aplicación de
 * saldo a favor"), como al entregar una nota en espera: una forma (efectivo,
 * transferencia, a crédito o su saldo a favor) o dos (efectivo y transferencia,
 * efectivo y crédito, transferencia y crédito, o su saldo a favor con
 * efectivo, transferencia o crédito). Va todo en UNA operación del servidor
 * (`POST /pedidos/:id/pago-nota`): o entra todo o nada. Con crédito se salda la
 * nota completa (lo que no paga hoy va a su cuenta, con sus días); sin crédito se
 * puede pagar una parte.
 *
 * Es el mismo patrón del abono a la cuenta del cliente (`clientes/abono-modal`):
 * los turnos se buscan al ABRIR, y con varios abiertos se propone el de la caja
 * con que se trabaja (`localStorage['caja_sel']`) o ninguno.
 *
 * No se cierra al hacer clic en el fondo; sale con la ✕, "Cancelar" o Escape.
 */
@Component({
  selector: 'app-pago-nota-modal',
  imports: [FormsModule, DineroPipe, CuentaDeposito, PlazoCredito],
  templateUrl: './pago-nota-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
  styles: `
    .pago-nota { gap: 16px; }
    .pago-nota > .muted b { color: var(--tinta); }
    .moneda { position: relative; display: block; }
    .moneda > span { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--tinta-3); font-weight: 600; }
    .moneda > input { padding-left: 26px; }
  `,
})
export class PagoNotaModal implements OnInit {
  /** El número que se sugiere en el campo (sin "$" ni comas: es un campo numérico). */
  comoCampo(v: number): string {
    return Number(v ?? 0).toFixed(2);
  }

  /** La llave de un solo uso de esta operación (2026-10-20): un doble clic no la registra dos veces. */
  private clave = nuevaClave();
  private readonly ventas = inject(VentasService);
  private readonly auth = inject(AuthService);
  private readonly confirmacion = inject(ConfirmacionService);

  readonly nota = input.required<NotaPendiente>();
  readonly cerrado = output<void>();
  readonly registrado = output<ResultadoAbono>();

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly metodos = signal<MetodoPago[]>([]);
  readonly turnos = signal<TurnoAbierto[]>([]);
  readonly puedeFiar = computed(() => this.auth.puede('hacer:fiar'));

  /** Lo que paga hoy, sin crédito (vacío = todo lo que falta). */
  monto: number | null = null;
  forma: FormaNota | null = null;
  /**
   * Con dos formas, la parte que se teclea: lo que paga por transferencia
   * ('mixto') o lo que paga hoy (con crédito). El resto va en la otra.
   */
  parte: number | null = null;
  turnoId: number | null = null;
  referencia = '';
  /** A qué cuenta llegó, si es por transferencia (Transferencias, 2026-10-20). */
  cuentaId: number | null = null;
  /** A cuántos días queda lo que va a crédito (2026-10-20). */
  diasCredito: number | null = PLAZO_CREDITO_POR_OMISION;
  protected readonly transf = inject(TransferenciasService);

  /** Los inputs se leen AQUÍ: en el constructor todavía no están asignados. */
  ngOnInit(): void {
    this.monto = Number(this.nota().falta) || null;
    forkJoin({
      metodos: this.ventas.metodosPago().pipe(catchError(() => of([] as MetodoPago[]))),
      turnos: buscarTurnos(this.ventas),
    }).subscribe(({ metodos, turnos }) => {
      this.metodos.set(metodos);
      this.forma = metodos.find((m) => m.nombre.toLowerCase().includes('efectivo'))?.id ?? metodos[0]?.id ?? null;
      this.turnos.set(turnos);
      this.turnoId = turnoPropuesto(turnos, this.nota().almacen_id);
      this.cargando.set(false);
    });
  }

  quien(): string {
    const n = this.nota();
    return n.nombre_comercial || n.cliente || 'el cliente';
  }

  falta(): number {
    return Number(this.nota().falta);
  }

  /** Su saldo a favor (anticipos, lo que regresó). */
  saldoFavor(): number {
    return Math.max(0, Number(this.nota().saldo_favor ?? 0));
  }

  /** El id del método cuyo nombre lleva ese texto ("efectivo", "transferencia"). */
  idDe(texto: string): number | null {
    return this.metodos().find((m) => m.nombre.toLowerCase().includes(texto))?.id ?? null;
  }

  /** Parte y parte: efectivo y transferencia, si existen los dos. */
  permiteMixto(): boolean {
    return !!this.idDe('efectivo') && !!this.idDe('transferencia');
  }

  /** Se cambió la forma de pagar: la parte tecleada era de la anterior. */
  cambiarForma(forma: FormaNota | null): void {
    this.forma = forma;
    this.parte = null;
  }

  /** Lleva crédito: lo que no paga hoy va a su cuenta (y se salda la nota). */
  conCredito(): boolean {
    return this.forma === 'credito' || this.forma === 'efectivo_credito'
      || this.forma === 'transferencia_credito' || this.forma === 'saldo_credito';
  }

  /** Lleva su saldo a favor. */
  conSaldo(): boolean {
    return typeof this.forma === 'string' && this.forma.startsWith('saldo');
  }

  /** Se teclea una parte (parte y parte, o lo de hoy con crédito). */
  tecleaParte(): boolean {
    return this.forma === 'mixto' || this.forma === 'efectivo_credito' || this.forma === 'transferencia_credito';
  }

  /** Sin crédito se dice cuánto paga hoy (puede ser una parte). */
  pideMonto(): boolean {
    return !this.conCredito();
  }

  private r2(n: number): number {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  /** Lo que paga hoy sin crédito (vacío = todo lo que falta). Método: lee ngModel. */
  montoHoy(): number {
    const v = this.monto == null || (this.monto as unknown) === '' ? this.falta() : Number(this.monto);
    return Number.isFinite(v) && v > 0 ? this.r2(v) : 0;
  }

  /** La parte tecleada, o 0. Método: lee ngModel. */
  montoParte(): number {
    if (!this.tecleaParte()) return 0;
    const v = Number(this.parte);
    return Number.isFinite(v) && v > 0 ? this.r2(v) : 0;
  }

  /** Lo que se paga con su saldo a favor: lo tecleado (solo saldo) o todo lo que alcance. */
  saldoUsado(): number {
    if (this.forma === 'saldo') return this.montoHoy();
    if (!this.conSaldo()) return 0;
    const hasta = this.forma === 'saldo_credito' ? this.falta() : this.montoHoy();
    return this.r2(Math.min(this.saldoFavor(), hasta));
  }

  /** Lo que va a su cuenta de crédito. */
  aCredito(): number {
    if (this.forma === 'credito') return this.falta();
    if (this.forma === 'efectivo_credito' || this.forma === 'transferencia_credito') {
      return Math.max(0, this.r2(this.falta() - this.montoParte()));
    }
    if (this.forma === 'saldo_credito') return Math.max(0, this.r2(this.falta() - this.saldoUsado()));
    return 0;
  }

  /** Lo que se cobra en efectivo. */
  enEfectivo(): number {
    const ef = this.idDe('efectivo');
    if (this.forma === 'mixto') return Math.max(0, this.r2(this.montoHoy() - this.montoParte()));
    if (this.forma === 'efectivo_credito') return this.montoParte();
    if (this.forma === 'saldo_efectivo') return Math.max(0, this.r2(this.montoHoy() - this.saldoUsado()));
    return ef != null && this.forma === ef ? this.montoHoy() : 0;
  }

  /** Lo que se cobra por transferencia. */
  enTransferencia(): number {
    const tr = this.idDe('transferencia');
    if (this.forma === 'mixto') return Math.min(this.montoParte(), this.montoHoy());
    if (this.forma === 'transferencia_credito') return this.montoParte();
    if (this.forma === 'saldo_transferencia') return Math.max(0, this.r2(this.montoHoy() - this.saldoUsado()));
    return tr != null && this.forma === tr ? this.montoHoy() : 0;
  }

  /** Un método que no es efectivo ni transferencia (si algún día se activa otro). */
  enOtroMetodo(): number {
    const f = this.forma;
    return typeof f === 'number' && f !== this.idDe('efectivo') && f !== this.idDe('transferencia') ? this.montoHoy() : 0;
  }

  esEfectivo(): boolean {
    return this.enEfectivo() > 0;
  }

  esTransferencia(): boolean {
    return this.enTransferencia() > 0;
  }

  /** Lo que le quedaría por pagar después de este pago (con crédito, nada). Método: lee ngModel. */
  quedaria(): number {
    if (this.conCredito()) return 0;
    return Math.max(0, this.r2(this.falta() - this.montoHoy()));
  }

  /** El rótulo de la parte que se teclea. */
  etiquetaParte(): string {
    if (this.forma === 'mixto') return 'Por transferencia';
    return this.forma === 'efectivo_credito' ? 'Paga hoy en efectivo' : 'Paga hoy por transferencia';
  }

  /** Debajo de la parte: a dónde va el resto. Método: lee ngModel. */
  ayudaParte(): string {
    if (this.forma === 'mixto') return `El resto, ${this.dinero(this.enEfectivo())}, en efectivo.`;
    return `El resto, ${this.dinero(this.aCredito())}, va a crédito.`;
  }

  /** Cómo queda repartido, cuando son dos formas o va a crédito. Método: lee ngModel. */
  reparto(): string | null {
    const partes: string[] = [];
    if (this.saldoUsado() > 0) partes.push(`${this.dinero(this.saldoUsado())} con su saldo a favor (le quedan ${this.dinero(Math.max(0, this.saldoFavor() - this.saldoUsado()))})`);
    if (this.enEfectivo() > 0 && (this.conSaldo() || this.forma === 'mixto' || this.conCredito())) partes.push(`${this.dinero(this.enEfectivo())} en efectivo`);
    if (this.enTransferencia() > 0 && (this.conSaldo() || this.forma === 'mixto' || this.conCredito())) partes.push(`${this.dinero(this.enTransferencia())} por transferencia`);
    if (this.aCredito() > 0) partes.push(`${this.dinero(this.aCredito())} a su cuenta de crédito`);
    if (this.forma === 'saldo' || partes.length < 1 || (partes.length === 1 && !this.conCredito())) return null;
    return `Paga ${partes.join(' y ')}.`;
  }

  /** Por qué no se puede registrar todavía, o null. */
  motivo(): string | null {
    const falta = this.falta();
    if (!this.forma) return 'Elige con qué está pagando.';
    if (this.conCredito() && !this.puedeFiar()) return 'Tu puesto no tiene permiso para «Vender a crédito».';
    if (this.pideMonto()) {
      if (!(this.montoHoy() > 0)) return 'Pon cuánto está pagando.';
      if (this.montoHoy() > falta + 0.001) return `Le faltan ${this.dinero(falta)}: no se puede cobrar más.`;
    }
    if (this.forma === 'saldo' && this.montoHoy() > this.saldoFavor() + 0.001) {
      return `Tiene ${this.dinero(this.saldoFavor())} a favor: no alcanza para ${this.dinero(this.montoHoy())}.`;
    }
    if ((this.forma === 'saldo_efectivo' || this.forma === 'saldo_transferencia') && this.montoHoy() <= this.saldoUsado() + 0.004) {
      return 'Con su saldo a favor alcanza para lo que paga: elige «Su saldo a favor».';
    }
    if (this.forma === 'saldo_credito' && this.saldoUsado() >= falta - 0.004) {
      return 'Su saldo a favor alcanza para toda la nota: elige «Su saldo a favor».';
    }
    if (this.tecleaParte()) {
      if (!(this.montoParte() > 0)) {
        return this.forma === 'mixto' ? 'Pon cuánto paga por transferencia.' : `Pon cuánto ${this.etiquetaParte().toLowerCase()}.`;
      }
      if (this.forma === 'mixto' && this.montoParte() >= this.montoHoy() - 0.004) {
        return `Si todo (${this.dinero(this.montoHoy())}) es por transferencia, elige solo «Transferencia».`;
      }
      if (this.forma !== 'mixto' && this.montoParte() >= falta - 0.004) {
        return `Si hoy paga todo (${this.dinero(falta)}), elige solo ${this.forma === 'efectivo_credito' ? '«Efectivo»' : '«Transferencia»'}: ` +
          'a crédito va lo que NO paga hoy.';
      }
    }
    if (this.aCredito() > 0 && !plazoValido(this.diasCredito)) return 'Di a cuántos días queda la nota a crédito (de 1 a 365).';
    if (this.transf.faltaCuenta(this.esTransferencia(), this.cuentaId)) return 'Elige a qué cuenta llegó la transferencia.';
    if (this.esEfectivo() && !this.turnoId) {
      return this.turnos().length > 1
        ? 'Elige a qué caja entra el efectivo: es la que lo recibió.'
        : 'El efectivo tiene que entrar en un turno de caja abierto, o el corte no va a cuadrar. ' +
          'Abre el turno en Caja, o registra el pago por transferencia.';
    }
    return null;
  }

  /** El texto del botón: lo que de verdad va a pasar. */
  textoBoton(): string {
    if (this.guardando()) return 'Registrando…';
    const hoy = this.r2(this.saldoUsado() + this.enEfectivo() + this.enTransferencia() + this.enOtroMetodo());
    if (this.conCredito() && hoy <= 0.004) return 'Pasarla a crédito';
    return `Registrar ${this.dinero(hoy)}${this.conCredito() ? ' y lo demás a crédito' : ''}`;
  }

  registrar(): void {
    const m = this.motivo();
    if (m) {
      this.error.set(m);
      return;
    }
    const cuenta = this.transf.elegida(this.cuentaId);
    const ref = this.referencia.trim() || undefined;
    const partes: NonNullable<PagoNotaInput['partes']> = [];
    if (this.saldoUsado() > 0) partes.push({ con_saldo_favor: true, monto: this.saldoUsado() });
    if (this.enTransferencia() > 0) {
      partes.push({
        metodo_pago_id: Number(this.idDe('transferencia')), monto: this.enTransferencia(), referencia: ref,
        ...(cuenta ? { cuenta_bancaria_id: cuenta } : {}),
      });
    }
    if (this.enEfectivo() > 0) {
      partes.push({ metodo_pago_id: Number(this.idDe('efectivo')), monto: this.enEfectivo(), referencia: this.esTransferencia() ? undefined : ref });
    }
    if (this.enOtroMetodo() > 0) partes.push({ metodo_pago_id: Number(this.forma), monto: this.enOtroMetodo(), referencia: ref });
    this.enviar({
      partes: partes.length ? partes : undefined,
      sesion_caja_id: this.esEfectivo() ? Number(this.turnoId) : undefined,
      ...(this.conCredito() ? { a_credito: true, dias_credito: Number(this.diasCredito) } : {}),
    });
  }

  private enviar(body: PagoNotaInput): void {
    this.guardando.set(true);
    this.error.set(null);
    this.ventas.pagarNota(this.nota().id, body, this.clave).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.clave = nuevaClave();
        this.registrado.emit(r);
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
            titulo: '¿Pasar a crédito con la cuenta atrasada?', mensaje: api.message,
            aceptar: 'Pasar a crédito de todos modos', peligro: true,
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
    return turnoUnicoAqui(this.turnos(), this.nota().almacen_id);
  }

  nombreTurno(t: TurnoAbierto): string {
    return nombreTurno(t, this.nota().almacen_id);
  }

  /** El elegido es de otra tienda: en qué corte cae el efectivo. */
  avisoOtraTienda(): string | null {
    return avisoOtraTienda(this.turnos(), this.turnoId, this.nota().almacen_id, this.nota().almacen);
  }

  private dinero(n: number): string {
    return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
