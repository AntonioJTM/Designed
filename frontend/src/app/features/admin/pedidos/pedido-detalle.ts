import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { VentasService } from '../../../core/services/ventas.service';
import {
  DevolucionLinea,
  EstadoPedido,
  Pedido,
  PedidoLinea,
} from '../../../core/models/ventas.models';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { ApiError } from '../../../core/models/auth.models';

@Component({
  selector: 'app-pedido-detalle',
  imports: [FormsModule, RouterLink, FechaPipe, CantidadPipe],
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

    // Cancelar y devolver mueven mercancía y dinero: se confirma antes,
    // mostrando exactamente qué va a pasar.
    if (this.nuevoEstado === 'cancelado' || this.nuevoEstado === 'devuelto') {
      this.abrirDevolucion();
      return;
    }
    this.aplicarEstado(this.nuevoEstado);
  }

  // ---- Cancelación / devolución ----

  readonly confirmando = signal(false);
  readonly aplicando = signal(false);
  readonly mensaje = signal<string | null>(null);
  /** Presentación elegida por línea: detalle_id → variante_id. */
  retornoPresentacion: Record<number, number> = {};
  /** Cantidad que de verdad regresa, por línea. */
  retornoCantidad: Record<number, number> = {};

  /** Prepara el panel con lo que regresa tal como se vendió. */
  abrirDevolucion(): void {
    const p = this.pedido();
    if (!p?.detalle) return;
    this.retornoPresentacion = {};
    this.retornoCantidad = {};
    for (const d of p.detalle) {
      this.retornoPresentacion[d.id] = d.variante_id;
      this.retornoCantidad[d.id] = Number(d.cantidad);
    }
    this.error.set(null);
    this.confirmando.set(true);
  }

  cerrarDevolucion(): void {
    this.confirmando.set(false);
    this.nuevoEstado = this.pedido()?.estado ?? '';
  }

  /**
   * Al cambiar la presentación se propone la cantidad equivalente que calculó el
   * backend (19 kg de paquete → 12 conos). Sigue siendo editable: puede que el
   * cliente regrese menos de lo que se llevó.
   */
  alCambiarPresentacion(linea: PedidoLinea): void {
    const elegida = Number(this.retornoPresentacion[linea.id]);
    if (elegida === linea.variante_id) {
      this.retornoCantidad[linea.id] = Number(linea.cantidad);
      return;
    }
    const alt = linea.alternativas_devolucion?.find((a) => a.variante_id === elegida);
    if (alt) this.retornoCantidad[linea.id] = alt.cantidad_equivalente;
  }

  /** Unidad en que se captura lo que regresa de esta línea. */
  unidadRetorno(linea: PedidoLinea): string {
    const elegida = Number(this.retornoPresentacion[linea.id]);
    if (elegida === linea.variante_id) return '';
    return linea.alternativas_devolucion?.find((a) => a.variante_id === elegida)?.unidad ?? '';
  }

  /** True si esta línea va a regresar en otra presentación. */
  hayCambio(linea: PedidoLinea): boolean {
    return Number(this.retornoPresentacion[linea.id]) !== linea.variante_id;
  }

  /**
   * Efectivo que va a salir de la caja, para avisarlo antes de confirmar. Es
   * informativo: el monto real lo calcula el backend con los pagos del pedido.
   */
  efectivoADevolver(): number {
    const p = this.pedido();
    if (!p || p.canal !== 'punto_venta') return 0;
    return (p.pagos ?? [])
      .filter((g) => g.estado === 'completado' && /efectivo/i.test(g.metodo))
      .reduce((s, g) => s + Number(g.monto), 0);
  }

  confirmarDevolucion(): void {
    const p = this.pedido();
    if (!p?.detalle || !this.nuevoEstado) return;

    const devoluciones: DevolucionLinea[] = p.detalle.map((d) => ({
      detalle_id: d.id,
      variante_id: Number(this.retornoPresentacion[d.id]),
      cantidad: Number(this.retornoCantidad[d.id]),
    }));
    this.aplicarEstado(this.nuevoEstado, devoluciones);
  }

  private aplicarEstado(estado: EstadoPedido, devoluciones?: DevolucionLinea[]): void {
    const p = this.pedido();
    if (!p) return;
    this.aplicando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    this.ventas.cambiarEstado(p.id, estado, devoluciones).subscribe({
      next: () => {
        this.aplicando.set(false);
        this.confirmando.set(false);
        this.mensaje.set(
          estado === 'cancelado' || estado === 'devuelto'
            ? `Pedido ${estado}. La mercancía regresó al inventario de ${p.almacen ?? 'su almacén'}.`
            : `Pedido marcado como ${estado}.`
        );
        // Se recarga: cambiaron los bultos, los pagos y las alternativas.
        this.cargar(p.id);
      },
      error: (e) => {
        this.aplicando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error';
  }
}
