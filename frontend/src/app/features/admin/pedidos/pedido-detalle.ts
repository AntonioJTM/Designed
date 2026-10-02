import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { VentasService } from '../../../core/services/ventas.service';
import {
  DevolucionLinea,
  EstadoPedido,
  PagoLinea,
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
export class PedidoDetalle implements OnDestroy {
  private readonly ventas = inject(VentasService);
  private readonly route = inject(ActivatedRoute);

  readonly pedido = signal<Pedido | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  nuevoEstado: EstadoPedido | '' = '';

  private readonly ESTADOS_VENTA: EstadoPedido[] = [
    'pendiente', 'pagado', 'en_preparacion', 'enviado', 'entregado', 'cancelado', 'devuelto',
  ];

  /**
   * Un APARTADO sin entregar tiene su propio camino y el selector no ofrece
   * atajos: se entrega desde Apartados (exige liquidarlo y ahí se descuenta),
   * aquí solo se cancela, y cancelado se reactiva como apartado. Como
   * "pendiente" o "entregado" quedaba una venta viva sin la mercancía apartada
   * ni descontada. El backend lo valida igual.
   */
  readonly estados = computed<EstadoPedido[]>(() => {
    const p = this.pedido();
    if (p && this.esApartadoSinEntregar(p)) {
      return p.estado === 'apartado' ? ['apartado', 'cancelado'] : [p.estado, 'apartado'];
    }
    return this.ESTADOS_VENTA;
  });

  /** Nunca descontó: es un apartado vigente, o uno que se canceló antes de entregarse. */
  esApartadoSinEntregar(p: Pedido): boolean {
    return !Number(p.inventario_descontado ?? 1);
  }

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

    // Un apartado nunca salió de la bodega: no hay nada que regrese ni en qué
    // presentación, solo se libera lo apartado.
    if (this.esApartadoSinEntregar(p)) {
      this.aplicarEstado(this.nuevoEstado);
      return;
    }

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
        const almacen = p.almacen ?? 'su almacén';
        this.mensaje.set(
          this.esApartadoSinEntregar(p)
            ? estado === 'apartado'
              ? `Se volvió a apartar la mercancía en ${almacen}.`
              : `Apartado cancelado. Se liberó lo apartado en ${almacen}.`
            : estado === 'cancelado' || estado === 'devuelto'
              ? `Pedido ${estado}. La mercancía regresó al inventario de ${almacen}.`
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

  // ---- Comprobante de pago ----
  //
  // La captura que el cliente manda al depositar. La sube SOLO el personal —el
  // cliente se la manda por WhatsApp o correo— y subirla da el pedido por
  // pagado en un paso, que es como lo pidió el usuario el 2026-09-05.

  readonly subiendoComprobante = signal(false);
  readonly errorComprobante = signal<string | null>(null);
  /** URL local del archivo bajado, para pintarlo. Se libera al salir. */
  readonly comprobanteUrl = signal<string | null>(null);
  readonly cargandoComprobante = signal(false);

  /** El pago que trae la captura, si alguno la tiene. */
  pagoConComprobante(): PagoLinea | null {
    return (this.pedido()?.pagos ?? []).find((g) => g.tiene_comprobante) ?? null;
  }

  /**
   * Si a este pedido se le puede subir una captura. No a un apartado (se paga
   * con abonos) ni a uno cancelado, y tampoco a una venta ya cobrada completa
   * sin transferencia: ahí no hay pago al cual pegarla, y antes el backend
   * creaba otro por el total. El backend lo valida igual.
   */
  aceptaComprobante(): boolean {
    const p = this.pedido();
    if (!p || p.estado === 'apartado' || p.estado === 'cancelado' || p.estado === 'devuelto') {
      return false;
    }
    const pagos = p.pagos ?? [];
    const hayAQuienPegarla = pagos.some(
      (g) =>
        g.estado === 'pendiente' ||
        g.estado === 'procesando' ||
        (g.estado === 'completado' && /transferencia/i.test(g.metodo))
    );
    const cobrado = pagos
      .filter((g) => g.estado === 'completado')
      .reduce((s, g) => s + Number(g.monto), 0);
    return hayAQuienPegarla || Number(p.total) - cobrado > 0.004;
  }

  /** Un PDF no se puede pintar con `<img>`: se ofrece abrirlo aparte. */
  comprobanteEsPdf(): boolean {
    return this.pagoConComprobante()?.comprobante_tipo === 'application/pdf';
  }

  /**
   * Baja el archivo y lo deja listo para mostrar. Va por HttpClient porque el
   * endpoint exige sesión y un `<img src>` no manda el token.
   */
  verComprobante(): void {
    const p = this.pedido();
    if (!p || this.cargandoComprobante() || this.comprobanteUrl()) return;
    this.cargandoComprobante.set(true);
    this.errorComprobante.set(null);
    this.ventas.comprobante(p.id).subscribe({
      next: (blob) => {
        this.liberarComprobante();
        this.comprobanteUrl.set(URL.createObjectURL(blob));
        this.cargandoComprobante.set(false);
      },
      error: (e) => {
        this.errorComprobante.set(this.msg(e));
        this.cargandoComprobante.set(false);
      },
    });
  }

  /** Abre el archivo en otra pestaña. Es la única forma de leer un PDF aquí. */
  abrirComprobante(): void {
    const url = this.comprobanteUrl();
    if (url) window.open(url, '_blank');
  }

  elegirArchivo(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    // El input se limpia siempre: si no, volver a elegir el MISMO archivo no
    // dispara el evento y parecería que el botón dejó de funcionar.
    input.value = '';
    if (archivo) this.subirComprobante(archivo);
  }

  private subirComprobante(archivo: File): void {
    const p = this.pedido();
    if (!p) return;
    this.subiendoComprobante.set(true);
    this.errorComprobante.set(null);
    this.mensaje.set(null);

    this.ventas.subirComprobante(p.id, archivo).subscribe({
      next: (actualizado) => {
        this.pedido.set(actualizado);
        this.nuevoEstado = actualizado.estado;
        this.subiendoComprobante.set(false);
        // La captura anterior ya no vale: se descarta para que el siguiente
        // "Ver" baje la nueva.
        this.liberarComprobante();
        this.mensaje.set(
          actualizado.estado === 'pagado'
            ? 'Comprobante guardado. El pedido quedó PAGADO.'
            : 'Comprobante guardado.'
        );
      },
      error: (e) => {
        this.errorComprobante.set(this.msg(e));
        this.subiendoComprobante.set(false);
      },
    });
  }

  quitarComprobante(): void {
    const p = this.pedido();
    if (!p) return;
    if (!confirm('¿Quitar la captura? El pedido seguirá marcado como pagado.')) return;

    this.errorComprobante.set(null);
    this.ventas.eliminarComprobante(p.id).subscribe({
      next: (actualizado) => {
        this.pedido.set(actualizado);
        this.liberarComprobante();
        this.mensaje.set('Se quitó la captura.');
      },
      error: (e) => this.errorComprobante.set(this.msg(e)),
    });
  }

  /** Un object URL que no se revoca deja el archivo en memoria del navegador. */
  private liberarComprobante(): void {
    const url = this.comprobanteUrl();
    if (url) URL.revokeObjectURL(url);
    this.comprobanteUrl.set(null);
  }

  ngOnDestroy(): void {
    this.liberarComprobante();
  }

  // ---- Artículos ----

  /**
   * Qué hilo es, en una línea: "2/30 · ACRILAN · Turco". Se arma aquí y no en
   * la plantilla para no repetir tres veces la lógica de los guiones cuando
   * alguno de los tres falta.
   */
  /** Pesos con separador de miles: "$12,450.00", no "$12450.00". */
  dinero(v: unknown): string {
    return Number(v ?? 0).toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 2,
    });
  }

  fichaDelHilo(d: PedidoLinea): string {
    return [d.calibre, d.material, d.linea].filter(Boolean).join(' · ');
  }

  /**
   * Por qué una línea no muestra bultos. Un pedido en línea no escanea nada, y
   * decirlo evita que se lea como un dato perdido.
   */
  porQueSinBultos(): string {
    return this.pedido()?.canal === 'tienda_linea'
      ? 'Venta en línea: no se escanearon bultos.'
      : 'No se escanearon bultos en esta línea.';
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error';
  }
}
