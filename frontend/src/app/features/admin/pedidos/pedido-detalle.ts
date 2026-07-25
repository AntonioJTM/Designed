import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { VentasService } from '../../../core/services/ventas.service';
import { EstadoPedido, Pedido } from '../../../core/models/ventas.models';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { ApiError } from '../../../core/models/auth.models';

@Component({
  selector: 'app-pedido-detalle',
  imports: [FormsModule, RouterLink, FechaPipe],
  templateUrl: './pedido-detalle.html',
})
export class PedidoDetalle {
  private readonly ventas = inject(VentasService);
  private readonly route = inject(ActivatedRoute);

  readonly pedido = signal<Pedido | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  nuevoEstado: EstadoPedido | '' = '';

  readonly estados: EstadoPedido[] = [
    'pendiente', 'pagado', 'en_preparacion', 'enviado', 'entregado', 'cancelado', 'devuelto',
  ];

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.cargar(id);
  }

  private cargar(id: number): void {
    this.cargando.set(true);
    this.ventas.obtenerPedido(id).subscribe({
      next: (p) => {
        this.pedido.set(p);
        this.nuevoEstado = p.estado;
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  cambiarEstado(): void {
    const p = this.pedido();
    if (!p || !this.nuevoEstado || this.nuevoEstado === p.estado) return;
    this.ventas.cambiarEstado(p.id, this.nuevoEstado).subscribe({
      next: (fresh) => this.pedido.set({ ...fresh, detalle: p.detalle, pagos: p.pagos }),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error';
  }
}
