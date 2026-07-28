import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VentasService } from '../../../core/services/ventas.service';
import { CodigoResuelto, InventarioService } from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { Almacen } from '../../../core/models/inventario.models';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { TipoCliente } from '../../../core/models/catalogo.models';
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
  private readonly auth = inject(AuthService);
  private readonly catalogo = inject(CatalogoService);

  /** Listas de precio. Se cobra la elegida; por omisión, la del público. */
  readonly tiposCliente = signal<TipoCliente[]>([]);
  tipoClienteSel: number | '' = '';

  /** Dar de alta o editar cajas es configuración: solo administradores. */
  readonly esAdmin = computed(() => this.auth.sesion()?.rol === 'administrador');

  readonly cajas = signal<Caja[]>([]);
  readonly metodos = signal<MetodoPago[]>([]);
  readonly sesion = signal<SesionCaja | null>(null);
  readonly error = signal<string | null>(null);
  readonly ticket = signal<{ pedido: Pedido; cambio: number } | null>(null);

  cajaSel: number | '' = '';
  montoInicial: number | null = 0;
  montoFinal: number | null = null;

  // ---- Administración de cajas (solo admin) ----
  readonly almacenes = signal<Almacen[]>([]);
  readonly administrando = signal(false);
  readonly editandoCaja = signal<number | null>(null);
  readonly mensaje = signal<string | null>(null);
  formCaja = { nombre: '', almacen_id: '' as number | '', activo: true };

  // Búsqueda de variantes
  qVar = '';
  resultados = signal<
    {
      id: number;
      sku: string;
      producto: string;
      presentacion?: string | null;
      precio: number;
      unidad?: string;
    }[]
  >([]);

  // Carrito
  readonly carrito = signal<ItemCarrito[]>([]);
  readonly subtotalEstimado = computed(() =>
    this.carrito().reduce((s, i) => s + i.precio * i.cantidad, 0)
  );

  // Cobro
  metodoSel: number | '' = '';
  montoPago: number | null = null;

  constructor() {
    // La sesión puede venir vacía al recargar directo en /admin/pos.
    if (!this.auth.sesion()) {
      this.auth.cargarPerfil().subscribe({ next: () => {}, error: () => {} });
    }
    this.inv.almacenes().subscribe({
      next: (a) => {
        this.almacenes.set(a);
        if (a[0] && !this.formCaja.almacen_id) this.formCaja.almacen_id = a[0].id;
      },
      error: () => {},
    });
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
    this.catalogo.tiposCliente().subscribe({
      next: (ts) => {
        const activos = ts.filter((x) => x.activo);
        this.tiposCliente.set(activos);
        // Arranca en el público: es el precio de mostrador.
        this.tipoClienteSel = (activos.find((x) => x.es_publico) ?? activos[0])?.id ?? '';
      },
      error: () => {},
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

  // ---- Alta y edición de cajas ----

  abrirAdmin(): void {
    this.administrando.set(true);
    this.nuevaCaja();
  }

  cerrarAdmin(): void {
    this.administrando.set(false);
    this.editandoCaja.set(null);
    this.mensaje.set(null);
  }

  nuevaCaja(): void {
    this.editandoCaja.set(null);
    this.formCaja = {
      nombre: '',
      almacen_id: this.almacenes()[0]?.id ?? '',
      activo: true,
    };
  }

  editarCaja(c: Caja): void {
    this.editandoCaja.set(c.id);
    this.formCaja = { nombre: c.nombre, almacen_id: c.almacen_id, activo: !!c.activo };
  }

  guardarCaja(): void {
    const nombre = this.formCaja.nombre.trim();
    if (!nombre || !this.formCaja.almacen_id) {
      this.error.set('Ponle nombre a la caja y elige su almacén.');
      return;
    }
    this.error.set(null);
    this.mensaje.set(null);

    const body = {
      nombre,
      almacen_id: Number(this.formCaja.almacen_id),
      activo: this.formCaja.activo,
    };
    const id = this.editandoCaja();
    const obs = id ? this.ventas.actualizarCaja(id, body) : this.ventas.crearCaja(body);

    obs.subscribe({
      next: () => {
        this.mensaje.set(id ? `Caja "${nombre}" actualizada.` : `Caja "${nombre}" dada de alta.`);
        this.nuevaCaja();
        this.recargarCajas();
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  eliminarCaja(c: Caja): void {
    if (!confirm(`¿Eliminar la caja "${c.nombre}"?`)) return;
    this.error.set(null);
    this.ventas.eliminarCaja(c.id).subscribe({
      next: () => {
        this.mensaje.set(`Caja "${c.nombre}" eliminada.`);
        this.recargarCajas();
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  private recargarCajas(): void {
    this.ventas.cajas().subscribe({
      next: (c) => {
        this.cajas.set(c);
        // Si la caja seleccionada desapareció, cae a la primera disponible.
        if (!c.some((x) => x.id === Number(this.cajaSel))) {
          this.cajaSel = c[0]?.id ?? '';
          if (this.cajaSel) this.verificarSesion();
          else this.sesion.set(null);
        }
      },
      error: (e) => this.error.set(this.msg(e)),
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

  /**
   * Enter del lector de códigos. Primero intenta resolver lo teclado como un
   * código exacto: si es un BULTO, se agrega con su peso real (los bultos de una
   * remesa pesan distinto: 18.65, 18.80, 19.05…) y cobrar por el nominal sería
   * cobrar mal. Si no es un código, cae a la búsqueda normal por nombre o SKU.
   */
  escanearOBuscar(): void {
    const q = this.qVar.trim();
    if (!q) return;
    this.error.set(null);
    this.inv.resolverCodigo(q).subscribe({
      next: (r) => this.agregarPorCodigo(r),
      // 404 = no es un código registrado; se busca como texto.
      error: () => this.buscar(),
    });
  }

  /** Mete al carrito lo que resolvió el lector. */
  private agregarPorCodigo(r: CodigoResuelto): void {
    const v = r.variante;

    // Un bulto ya vendido o desarmado no existe físicamente: no se vuelve a
    // vender. El backend también lo rechaza; esto es para avisar antes de que
    // el cajero cierre el ticket.
    if (r.bulto && r.bulto.estado && r.bulto.estado !== 'disponible') {
      const donde = r.bulto.consumido_folio ? ` en ${r.bulto.consumido_folio}` : '';
      this.error.set(
        `El bulto ${r.bulto.codigo} ya está ${r.bulto.estado}${donde}. Escanea otro.`
      );
      this.qVar = '';
      return;
    }

    const peso = r.bulto?.peso_kg != null ? Number(r.bulto.peso_kg) : null;

    // Código de la presentación (no de un bulto): se agrega como siempre.
    if (!r.bulto || !peso || peso <= 0) {
      this.agregar({
        id: v.id,
        sku: v.sku,
        producto: v.producto ?? '',
        presentacion: v.presentacion,
        precio: Number(v.precio_oferta ?? v.precio),
        unidad: v.unidad,
      });
      this.qVar = '';
      this.resultados.set([]);
      return;
    }

    const bulto = { codigo: r.bulto.codigo, peso_kg: peso, lote: r.bulto.lote };
    let repetido = false;

    this.carrito.update((arr) => {
      const item = arr.find((i) => i.variante_id === v.id);
      if (!item) {
        return [
          ...arr,
          {
            variante_id: v.id,
            sku: v.sku,
            producto: v.producto ?? '',
            presentacion: v.presentacion,
            precio: Number(v.precio_oferta ?? v.precio),
            unidad: v.unidad,
            cantidad: peso,
            bultos: [bulto],
          },
        ];
      }
      // El bulto es una pieza física única: escanearlo dos veces es un error de
      // captura, no una venta doble.
      if ((item.bultos ?? []).some((b) => b.codigo === bulto.codigo)) {
        repetido = true;
        return arr;
      }
      return arr.map((i) =>
        i.variante_id === v.id
          ? {
              ...i,
              cantidad: this.round3(i.cantidad + peso),
              bultos: [...(i.bultos ?? []), bulto],
            }
          : i
      );
    });

    if (repetido) {
      this.error.set(`El bulto ${bulto.codigo} ya está en el ticket; no se cobra dos veces.`);
    } else {
      this.mensaje.set(
        `Bulto ${bulto.codigo}: ${peso} kg${r.bulto.lote ? ` · lote ${r.bulto.lote}` : ''}`
      );
    }
    this.qVar = '';
    this.resultados.set([]);
  }

  private round3(n: number): number {
    return Math.round((n + Number.EPSILON) * 1000) / 1000;
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
            unidad: v.unidad,
          }))
        ),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  agregar(r: {
    id: number;
    sku: string;
    producto: string;
    presentacion?: string | null;
    precio: number;
    unidad?: string;
  }): void {
    this.carrito.update((arr) => {
      const existe = arr.find((i) => i.variante_id === r.id);
      if (existe) {
        return arr.map((i) => (i.variante_id === r.id ? { ...i, cantidad: i.cantidad + 1 } : i));
      }
      return [
        ...arr,
        {
          variante_id: r.id,
          sku: r.sku,
          producto: r.producto,
          presentacion: r.presentacion,
          precio: r.precio,
          unidad: r.unidad,
          cantidad: 1,
        },
      ];
    });
  }

  /** La venta es por peso: la cantidad admite decimales (2.5 kg). */
  cambiarCantidad(item: ItemCarrito, cantidad: number): void {
    const n = Number(cantidad);
    if (!Number.isFinite(n) || n <= 0) return this.quitar(item);
    // 3 decimales = el mismo alcance que DECIMAL(12,3) en la BD (1 gramo).
    const redondeada = Math.round(n * 1000) / 1000;
    this.carrito.update((arr) =>
      arr.map((i) => (i.variante_id === item.variante_id ? { ...i, cantidad: redondeada } : i))
    );
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
        tipo_cliente_id: this.tipoClienteSel ? Number(this.tipoClienteSel) : undefined,
        items: this.carrito().map((i) => ({
          variante_id: i.variante_id,
          cantidad: i.cantidad,
          // Va el rastro de los bultos escaneados, si hubo.
          bultos: i.bultos?.length ? i.bultos : undefined,
        })),
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

  /** Nombre del tipo elegido, para rotular el carrito. */
  nombreTipoCliente(): string {
    return this.tiposCliente().find((t) => t.id === Number(this.tipoClienteSel))?.nombre ?? '';
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
