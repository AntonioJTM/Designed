import { Component, inject, input, output, signal } from '@angular/core';
import { nuevaClave } from '../../../../core/clave-unica';
import { RouterLink } from '@angular/router';
import { ClientesService } from '../../../../core/services/clientes.service';
import { TicketService } from '../../../../core/services/ticket.service';
import { ConfirmacionService } from '../../../../core/services/confirmacion.service';
import {
  AplicacionSaldoFavor,
  DeudaTotal,
  MovimientoSaldoFavor,
} from '../../../../core/models/clientes.models';
import { ApiError } from '../../../../core/models/auth.models';
import { DineroPipe } from '../../../../shared/dinero.pipe';
import { FolioPipe } from '../../../../shared/folio.pipe';
import { fechaCorta, pesos } from '../clientes-ui';
import { BotonWhatsapp } from '../../../../shared/ticket/boton-whatsapp';

const ETIQUETA: Record<MovimientoSaldoFavor['tipo'], string> = {
  devolucion: 'Regresó mercancía',
  anticipo: 'Dejó a cuenta',
  uso: 'Pagó una compra con él',
  aplicado: 'Se descontó de lo que debía',
  reintegro: 'Le regresó lo de una compra',
  ajuste: 'Ajuste a mano',
};
const SIGNO: Record<MovimientoSaldoFavor['tipo'], number> = {
  devolucion: 1, anticipo: 1, uso: -1, aplicado: -1, reintegro: 1, ajuste: 1,
};

/**
 * SU SALDO A FAVOR (2026-10-13): lo que le quedó de las devoluciones y de sus
 * anticipos (dinero a cuenta, sin nota; 2026-10-14). "A veces
 * el cliente pide que su saldo a favor se utilice para otras compras y dejar su
 * crédito como está" (usuario): por eso va APARTE de lo que debe. Se usa al
 * cobrarle en el punto de venta, o se descuenta de lo que debe cuando él lo
 * pida (el botón de aquí). Abajo, de dónde salió y en qué se usó.
 */
@Component({
  selector: 'app-saldo-favor',
  imports: [BotonWhatsapp, RouterLink, DineroPipe, FolioPipe],
  template: `
    <section class="card">
      <div class="card-head">
        <div>
          <h2>Su saldo a favor</h2>
          <p>Lo que le quedó de lo que ha regresado y de sus anticipos. Se usa al cobrarle o se descuenta de lo que debe, como él lo pida.</p>
        </div>
        <div class="acciones">
          @if (puedeRecibir()) {
            <button type="button" class="btn btn-ghost btn-sm" (click)="recibir.emit()">Recibir anticipo</button>
          }
          @if (puedeAjustar()) {
            <button type="button" class="btn btn-ghost btn-sm" (click)="ajustar.emit()">Ajustar</button>
          }
          @if (saldo() > 0.004 && deuda().total > 0.004) {
            <button type="button" class="btn btn-primary btn-sm" (click)="aplicar()" [disabled]="aplicando()">
              {{ aplicando() ? 'Descontando…' : 'Descontar de lo que debe' }}
            </button>
          }
        </div>
      </div>
      @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
      <div class="sf-cifras">
        <div>
          <span class="muted">A su favor</span>
          <span class="sf-grande" [class.verde]="saldo() > 0.004">{{ saldo() | dinero }}</span>
        </div>
        @if (deuda().total > 0.004) {
          <div>
            <span class="muted">Debe</span>
            <span class="sf-grande">{{ deuda().total | dinero }}</span>
            <span class="muted">
              @if (deuda().notas > 0) { notas pendientes {{ deuda().notas | dinero }} }
              @if (deuda().notas > 0 && deuda().credito > 0) { · }
              @if (deuda().credito > 0) { crédito {{ deuda().credito | dinero }} }
            </span>
          </div>
        }
      </div>
      @if (movimientos().length === 0) {
        <p class="vacio">Todavía no ha regresado nada ni ha dejado anticipos.</p>
      } @else {
        <div class="tabla-scroll">
          <table class="grid sf-tabla">
            <thead><tr><th>Fecha</th><th>Qué pasó</th><th class="num">Monto</th><th>Quién</th><th><span class="oculto">Ticket</span></th></tr></thead>
            <tbody>
              @for (m of movimientos(); track m.id) {
                <tr>
                  <td class="muted sf-fecha">{{ fechaCorta(m.creado_en) }}</td>
                  <td>
                    {{ etiqueta(m) }}
                    @if (m.otra_tienda) { <span class="muted"> · en otra tienda</span> }
                    @if (m.metodo) { <span class="muted"> · {{ m.metodo.toLowerCase() }}</span> }
                    @if (m.referencia) { <span class="mono muted"> · {{ m.referencia }}</span> }
                    @if (m.devolucion_folio) { <span class="mono muted"> · {{ m.devolucion_folio | folio }}</span> }
                    @if (m.numero_pedido) {
                      ·
                      @if (vePedidos() && m.pedido_id) {
                        <a class="mono" [routerLink]="['/admin/ventas', m.pedido_id]" [title]="m.numero_pedido">{{ m.numero_pedido | folio }}</a>
                      } @else { <span class="mono muted" [title]="m.numero_pedido">{{ m.numero_pedido | folio }}</span> }
                    }
                    <!-- Las notas que pone el sistema repiten el folio; solo se dicen si
                         no hay venta a la cual ligarlo (su cuenta de crédito, un ajuste), o si
                         dicen por qué le regresó (se canceló, no había efectivo en la caja). -->
                    @if (m.notas && (!m.numero_pedido || m.tipo === 'reintegro') && m.tipo !== 'anticipo') {
                      <br /><span class="muted">{{ m.notas }}</span>
                    }
                  </td>
                  <td class="num sf-monto" [class.entra]="efecto(m) > 0">{{ monto(m) }}</td>
                  <td class="muted">{{ m.registro || '—' }}</td>
                  <!-- Cada anticipo se puede reimprimir (si dejó parte y parte, sale un solo ticket). -->
                  <td class="acciones">
                    @if (m.tipo === 'anticipo' && !m.otra_tienda) {
                      <button type="button" class="btn btn-ghost btn-sm" (click)="ticketAnticipo(m)"
                              [attr.aria-label]="'Ticket del anticipo del ' + fechaCorta(m.creado_en)">Ticket</button>
                      <app-boton-whatsapp [chico]="true" (mandar)="whatsappAnticipo(m)"
                                          [etiqueta]="'Mandar por WhatsApp el ticket del anticipo del ' + fechaCorta(m.creado_en)" />
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: `
    .sf-cifras { display: flex; flex-wrap: wrap; gap: 16px 32px; margin-bottom: 14px; }
    .sf-cifras > div { display: flex; flex-direction: column; gap: 4px; }
    .sf-cifras .muted { font-size: 0.8125rem; }
    .sf-grande { font-size: 1.875rem; font-weight: 600; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; line-height: 1.15; }
    .sf-grande.verde { color: var(--ok-t); }
    .alert { margin: 0 0 14px; }
    .sf-tabla { min-width: 600px; }
    .sf-fecha { white-space: nowrap; }
    .sf-monto { font-weight: 600; color: var(--tinta); }
    .sf-monto.entra { color: var(--ok-t); }
  `,
})
export class SaldoFavor {
  /** La llave de un solo uso de esta operación (2026-10-20): un doble clic no la registra dos veces. */
  private clave = nuevaClave();
  private readonly clientes = inject(ClientesService);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly tickets = inject(TicketService);

  readonly clienteId = input.required<number>();
  readonly nombre = input<string>('');
  readonly saldo = input<number>(0);
  readonly deuda = input<DeudaTotal>({ credito: 0, notas: 0, total: 0 });
  readonly movimientos = input<MovimientoSaldoFavor[]>([]);
  readonly vePedidos = input(false);
  /** Se ofrece "Recibir anticipo" (cliente activo). */
  readonly puedeRecibir = input(false);
  /** Se ofrece "Ajustar" (quien tiene «Corregir deuda»; 2026-10-16). */
  readonly puedeAjustar = input(false);
  readonly ajustar = output<void>();
  readonly aplicado = output<AplicacionSaldoFavor>();
  readonly recibir = output<void>();

  readonly aplicando = signal(false);
  readonly error = signal<string | null>(null);
  readonly fechaCorta = fechaCorta;

  etiqueta(m: MovimientoSaldoFavor): string {
    return ETIQUETA[m.tipo] ?? m.tipo;
  }

  efecto(m: MovimientoSaldoFavor): number {
    return (SIGNO[m.tipo] ?? 1) * Number(m.monto);
  }

  monto(m: MovimientoSaldoFavor): string {
    const n = this.efecto(m);
    return (n < 0 ? '−' : '+') + pesos(Math.abs(n)).replace('-', '');
  }

  /** El mismo ticket del anticipo, en PDF por WhatsApp (2026-10-16). */
  whatsappAnticipo(m: MovimientoSaldoFavor): void {
    this.tickets.whatsappAnticipo(this.clienteId(), m.id);
  }

  /** El ticket de un anticipo de su historial (sale igual que el día que lo dejó). */
  ticketAnticipo(m: MovimientoSaldoFavor): void {
    this.error.set(null);
    this.tickets.imprimirAnticipo(this.clienteId(), m.id).subscribe({
      error: (e) => this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'No se pudo imprimir el ticket.'),
    });
  }

  /** "Aplica mi saldo a lo que debo": pregunta antes, diciendo a qué se va. */
  async aplicar(): Promise<void> {
    const d = this.deuda();
    const usa = Math.min(this.saldo(), d.total);
    const partes = [
      d.notas > 0 ? `sus notas pendientes de pago (${pesos(d.notas)}), de la más vieja a la más nueva` : '',
      d.credito > 0 ? `su cuenta de crédito (${pesos(d.credito)})` : '',
    ].filter(Boolean);
    const si = await this.confirmacion.pedir({
      titulo: `¿Descontar ${pesos(usa)} de lo que debe?`,
      mensaje:
        `${this.nombre() || 'El cliente'} tiene ${pesos(this.saldo())} a favor y debe ${pesos(d.total)}. ` +
        `Se descuenta primero de ${partes.join(' y luego de ')}.` +
        (this.saldo() > d.total ? ` Le quedan ${pesos(this.saldo() - d.total)} a favor.` : ''),
      aceptar: `Descontar ${pesos(usa)}`,
    });
    if (!si) return;
    this.aplicando.set(true);
    this.error.set(null);
    this.clientes.aplicarSaldoFavor(this.clienteId(), undefined, this.clave).subscribe({
      next: (r) => {
        this.aplicando.set(false);
        this.clave = nuevaClave();
        this.aplicado.emit(r);
      },
      error: (e) => {
        this.aplicando.set(false);
        this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'No se pudo descontar.');
      },
    });
  }
}
