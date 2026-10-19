import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VentasService } from '../../../core/services/ventas.service';
import { TicketService } from '../../../core/services/ticket.service';
import { TicketDelAviso } from '../../../shared/ticket/ticket-del-aviso';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { NotaPendiente, NotaPendienteHilo, NotasPendientes, ResultadoAbono } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { PagoNotaModal } from './pago-nota-modal';
import { BotonWhatsapp } from '../../../shared/ticket/boton-whatsapp';

/**
 * NOTAS PENDIENTES DE PAGO (2026-10-13): "si no me pagan ese día el ticket, que
 * exista un apartado de notas pendientes de pago de los clientes y que se
 * agreguen al corte de caja del día en el que paguen, o si el cliente pide que
 * se vaya a crédito que exista esa opción" (usuario).
 *
 * Se dan en el punto de venta con «Nota pendiente de pago»: el cliente se lleva
 * la mercancía y sale su ticket, sin forma de pago. Aquí se ven las que todavía
 * se deben, de la más antigua a la más nueva, y:
 *   · «Registrar pago» (`pago-nota-modal.ts`): efectivo o transferencia, en una
 *     o varias veces; el efectivo entra al corte del día en que paga. Con el
 *     último abono queda pagada y sale de la lista.
 *   · «Pasar a crédito»: lo que falta se carga a su cuenta (con su límite) y se
 *     cobra desde su expediente. Pide el permiso de vender a crédito.
 */
@Component({
  selector: 'app-notas-pendientes',
  imports: [BotonWhatsapp, FormsModule, RouterLink, DineroPipe, FolioPipe, FechaPipe, PagoNotaModal],
  templateUrl: './notas-pendientes.html',
})
export class NotasPendientesPantalla {
  private readonly ventas = inject(VentasService);
  private readonly tickets = inject(TicketService);
  private readonly auth = inject(AuthService);
  private readonly confirmacion = inject(ConfirmacionService);

  readonly datos = signal<NotasPendientes | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  /** El botón de ticket del aviso: el pago recién registrado (2026-10-15). */
  readonly ticketAviso = new TicketDelAviso(this.mensaje);
  /** La nota a la que se le está registrando un pago (abre la ventana). */
  readonly pagando = signal<NotaPendiente | null>(null);
  /** La que se está pasando a crédito (apaga su botón mientras). */
  readonly pasando = signal<number | null>(null);

  readonly puedeCredito = computed(() => this.auth.puede('hacer:fiar'));
  readonly veClientes = computed(() => this.auth.puede('ver:clientes'));
  readonly items = computed(() => this.datos()?.items ?? []);

  q = '';
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.ventas.notasPendientes({ q: this.q.trim() || undefined }).subscribe({
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

  alTeclear(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.cargar(), 350);
  }

  quien(n: NotaPendiente): string {
    return n.nombre_comercial || n.cliente || 'Sin cliente';
  }

  /** "ROJO 2/30 · 18.5 kg · 1 paquete" o "· 6 conos". */
  queLlevo(h: NotaPendienteHilo): string {
    const kg = `${h.kg.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`;
    const extra = h.piezas
      ? ` · ${h.piezas} ${h.piezas === 1 ? 'cono' : 'conos'}`
      : h.paquetes
        ? ` · ${h.paquetes} ${h.paquetes === 1 ? 'paquete' : 'paquetes'}`
        : '';
    return `${h.hilo} · ${kg}${extra}`;
  }

  /** "hoy", "ayer", "hace 5 días". */
  hace(dias: number): string {
    if (dias <= 0) return 'hoy';
    if (dias === 1) return 'ayer';
    return `hace ${dias} días`;
  }

  /** Se registró un pago: dice cuánto queda, o que ya quedó pagada. */
  alPagar(r: ResultadoAbono): void {
    this.pagando.set(null);
    const dinero = (n: number) => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const texto = r.liquidado
      ? `${r.numero_pedido} quedó pagada.`
      : `Pago registrado en ${r.numero_pedido}. Le faltan ${dinero(r.pendiente)}.`;
    this.mensaje.set(texto);
    if (r.pago_id) {
      const pagoId = r.pago_id;
      this.ticketAviso.poner(texto, 'Imprimir ticket del abono', () =>
        this.tickets.imprimirPagoNota(r.pedido_id, pagoId).subscribe({ error: (e) => this.error.set(this.msg(e)) }),
        () => this.tickets.whatsappPagoNota(r.pedido_id, pagoId));
    }
    this.error.set(null);
    this.cargar();
  }

  async pasarACredito(n: NotaPendiente): Promise<void> {
    const dinero = (x: number) => `$${Number(x).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const si = await this.confirmacion.pedir({
      titulo: '¿Pasar a crédito?',
      mensaje:
        `Se cargan ${dinero(n.falta)} a la cuenta de crédito de ${this.quien(n)} y la nota sale de esta lista: ` +
        'desde ahí se cobra con abonos a su cuenta, en su expediente.',
      aceptar: 'Pasar a crédito',
    });
    if (!si) return;
    this.pasando.set(n.id);
    this.error.set(null);
    this.ventas.pasarACredito(n.id).subscribe({
      next: (p) => {
        this.pasando.set(null);
        this.mensaje.set(
          `${n.numero_pedido}: ${dinero(p.a_credito)} pasaron a la cuenta de crédito de ${this.quien(n)}` +
            (p.estado === 'pagado' ? '; su saldo a favor la cubrió y ya está pagada.' : '.')
        );
        this.cargar();
      },
      error: (e) => {
        this.pasando.set(null);
        this.mensaje.set(null);
        this.error.set(this.msg(e));
      },
    });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
