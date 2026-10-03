import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PedidoDeCliente } from '../../../../core/models/clientes.models';
import { CantidadPipe } from '../../../../shared/cantidad.pipe';
import { DineroPipe } from '../../../../shared/dinero.pipe';
import { fechaCorta } from '../clientes-ui';
import { FolioPipe } from '../../../../shared/folio.pipe';

/**
 * "Sus compras": fecha, folio, qué hilos se llevó, kilos, total y CÓMO pagó.
 * Lo cancelado y lo devuelto aparece (dice algo del cliente) pero atenuado y
 * con su estado en lugar del pago: no cuenta en sus totales.
 *
 * El folio lleva al pedido solo si el puesto puede ver Pedidos: no se enlaza a
 * una pantalla que no se va a abrir.
 */
@Component({
  selector: 'app-tabla-compras',
  imports: [FolioPipe, RouterLink, CantidadPipe, DineroPipe],
  template: `
    <div class="tabla-scroll">
      <table class="grid" [style.min-width.px]="completa() ? 900 : 760">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Folio</th>
            <th>Qué se llevó</th>
            <th class="num">Kilos</th>
            <th class="num">Total</th>
            <th>Cómo pagó</th>
            @if (completa()) { <th>Atendió</th> }
          </tr>
        </thead>
        <tbody>
          @for (p of pedidos(); track p.id) {
            <tr [class.muerto]="p.estado === 'cancelado' || p.estado === 'devuelto'">
              <td style="font-variant-numeric: tabular-nums; white-space: nowrap">{{ fechaCorta(p.creado_en) }}</td>
              <td class="mono">
                @if (vePedidos()) {
                  <a [routerLink]="['/admin/pedidos', p.id]" [title]="p.numero_pedido" style="text-decoration: none">{{ p.numero_pedido | folio }}</a>
                } @else { <span [title]="p.numero_pedido">{{ p.numero_pedido | folio }}</span> }
              </td>
              <td>{{ hilos(p) }}</td>
              <td class="num">{{ p.kilos ?? 0 | cantidad: 'kg' }}</td>
              <td class="num" style="font-weight: 600">{{ p.total | dinero }}</td>
              <td><span [class]="'pill ' + pago(p).pill">{{ pago(p).texto }}</span></td>
              @if (completa()) { <td class="muted">{{ p.atendio || '—' }}</td> }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    tr.muerto td { color: var(--tinta-3); }
    tr.muerto td:nth-child(5) { text-decoration: line-through; font-weight: 400 !important; }
  `,
})
export class TablaCompras {
  readonly pedidos = input.required<PedidoDeCliente[]>();
  readonly vePedidos = input(false);
  /** Con la columna "Atendió" (en la pestaña Cuánto gasta). */
  readonly completa = input(false);

  readonly fechaCorta = fechaCorta;

  /** Los hilos con su calibre; más de tres se resumen para no partir el renglón. */
  hilos(p: PedidoDeCliente): string {
    const h = (p.hilos ?? []).map((x) => x.hilo);
    if (h.length === 0) return '—';
    return h.length <= 3 ? h.join(', ') : `${h.slice(0, 2).join(', ')} y ${h.length - 2} más`;
  }

  /** Cómo pagó, en palabras: el método, lo que quedó a deber o los dos. */
  pago(p: PedidoDeCliente): { texto: string; pill: string } {
    if (p.estado === 'cancelado') return { texto: 'Cancelado', pill: 'rojo' };
    if (p.estado === 'devuelto') return { texto: 'Devuelto', pill: 'rojo' };
    if (p.estado === 'apartado') return { texto: 'Apartado', pill: 'ambar' };
    const metodos = (p.pagado_con ?? []).map((x) => x.metodo);
    const fiado = Number(p.a_credito ?? 0) > 0;
    if (fiado && metodos.length) return { texto: `Mixto: ${metodos.join(', ').toLowerCase()} y crédito`, pill: 'gris' };
    if (fiado) return { texto: 'A crédito', pill: 'gris' };
    if (metodos.length === 0) return { texto: p.estado === 'pendiente' ? 'Sin pagar' : '—', pill: 'gris' };
    const texto = metodos.join(' y ');
    const t = texto.toLowerCase();
    return { texto, pill: t === 'efectivo' ? 'verde' : t.includes('transfer') ? 'azul' : 'gris' };
  }
}
