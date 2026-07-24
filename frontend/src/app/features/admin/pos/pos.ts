import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VentasService } from '../../../core/services/ventas.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { Caja, ItemCarrito, MetodoPago, Pedido, SesionCaja } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';

@Component({
  selector: 'app-pos',
  imports: [FormsModule],
  templateUrl: './pos.html',
})
export class Pos {
  private readonly ventas = inject(VentasService);
  private readonly inv = inject(InventarioService);

  readonly cajas = signal<Caja[]>([]);
  readonly metodos = signal<MetodoPago[]>([]);
  readonly sesion = signal<SesionCaja | null>(null);
  readonly error = signal<string | null>(null);
  readonly ticket = signal<{ pedido: Pedido; cambio: number } | null>(null);

  cajaSel: number | '' = '';
  montoInicial: number | null = 0;
  montoFinal: number | null = null;

  // Búsqueda de variantes
  qVar = '';
  resultados = signal<{ id: number; sku: string; producto: string; presentacion?: string | null; precio: number }[]>([]);

  // Carrito
  readonly carrito = signal<ItemCarrito[]>([]);
  readonly subtotalEstimado = computed(() =>
    this.carrito().reduce((s, i) => s + i.precio * i.cantidad, 0)
  );

  // Cobro
  metodoSel: number | '' = '';
  montoPago: number | null = null;

  constructor() {
    this.ventas.cajas().subscribe({
      next: (c) => {
        this.cajas.set(c);
        if (c[0]) {
          this.cajaSel = c[0].id;
          this.verificarSesion();
        }
      },
      error: (e) => this.error.set(this.msg(e)),
    });
    this.ventas.metodosPago().subscribe({
      next: (m) => {
        this.metodos.set(m);
        const efectivo = m.find((x) => x.nombre.toLowerCase().includes('efectivo'));
        this.metodoSel = efectivo?.id ?? m[0]?.id ?? '';
      },
      error: () => {},
    });
  }

  verificarSesion(): void {
    if (!this.cajaSel) return;
    this.error.set(null);
    this.ventas.sesionAbierta(Number(this.cajaSel)).subscribe({
      next: (s) => this.sesion.set(s),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  abrirCaja(): void {
    if (!this.cajaSel) return;
    this.ventas.abrirSesion(Number(this.cajaSel), this.montoInicial ?? 0).subscribe({
      next: (s) => this.sesion.set(s),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  buscar(): void {
    if (!this.qVar.trim()) return;
    this.inv.buscarVariantes(this.qVar.trim()).subscribe({
      next: (vs) =>
        this.resultados.set(
          vs.map((v) => ({
            id: v.id,
            sku: v.sku,
            producto: v.producto ?? '',
            presentacion: v.presentacion,
            precio: Number(v.precio_oferta ?? v.precio),
          }))
        ),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  agregar(r: { id: number; sku: string; producto: string; presentacion?: string | null; precio: number }): void {
    this.carrito.update((arr) => {
      const existe = arr.find((i) => i.variante_id === r.id);
      if (existe) {
        return arr.map((i) => (i.variante_id === r.id ? { ...i, cantidad: i.cantidad + 1 } : i));
      }
      return [...arr, { variante_id: r.id, sku: r.sku, producto: r.producto, presentacion: r.presentacion, precio: r.precio, cantidad: 1 }];
    });
  }

  cambiarCantidad(item: ItemCarrito, cantidad: number): void {
    if (cantidad <= 0) return this.quitar(item);
    this.carrito.update((arr) => arr.map((i) => (i.variante_id === item.variante_id ? { ...i, cantidad } : i)));
  }

  quitar(item: ItemCarrito): void {
    this.carrito.update((arr) => arr.filter((i) => i.variante_id !== item.variante_id));
  }

  cobrar(): void {
    const s = this.sesion();
    if (!s || this.carrito().length === 0 || !this.metodoSel) {
      this.error.set('Agrega productos y elige método de pago.');
      return;
    }
    this.error.set(null);
    const monto = this.montoPago ?? 0;

    this.ventas
      .crearPedido({
        canal: 'punto_venta',
        sesion_caja_id: s.id,
        items: this.carrito().map((i) => ({ variante_id: i.variante_id, cantidad: i.cantidad })),
        pagos: [{ metodo_pago_id: Number(this.metodoSel), monto }],
      })
      .subscribe({
        next: (pedido) => {
          const cambio = Math.max(0, monto - Number(pedido.total));
          this.ticket.set({ pedido, cambio });
          this.carrito.set([]);
          this.montoPago = null;
          this.qVar = '';
          this.resultados.set([]);
          // Refresca la sesión para ver el efectivo esperado actualizado.
          this.ventas.obtenerSesion(s.id).subscribe({ next: (fresh) => this.sesion.set(fresh) });
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  cerrarCaja(): void {
    const s = this.sesion();
    if (!s || this.montoFinal == null) {
      this.error.set('Indica el monto final contado.');
      return;
    }
    this.ventas.cerrarSesion(s.id, this.montoFinal).subscribe({
      next: (fresh) => {
        this.sesion.set(fresh);
        this.montoFinal = null;
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  nuevaVenta(): void {
    this.ticket.set(null);
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
