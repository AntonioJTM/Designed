import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VentasService } from '../../../core/services/ventas.service';
import { CodigoResuelto, InventarioService } from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { Almacen } from '../../../core/models/inventario.models';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { TipoCliente } from '../../../core/models/catalogo.models';
import { Caja, ItemCarrito, MetodoPago, Pedido, SesionCaja } from '../../../core/models/ventas.models';
import { ClientesService } from '../../../core/services/clientes.service';
import { ClienteParaVenta } from '../../../core/models/clientes.models';
import { TiendaService } from '../../../core/services/tienda.service';
import { ApiError } from '../../../core/models/auth.models';

@Component({
  selector: 'app-pos',
  imports: [FormsModule, RouterLink],
  templateUrl: './pos.html',
})
export class Pos {
  private readonly ventas = inject(VentasService);
  private readonly inv = inject(InventarioService);
  private readonly auth = inject(AuthService);
  private readonly catalogo = inject(CatalogoService);
  private readonly clientesSvc = inject(ClientesService);
  private readonly tienda = inject(TiendaService);

  /** Listas de precio. Se cobra la elegida; por omisión, la del público. */
  readonly tiposCliente = signal<TipoCliente[]>([]);
  tipoClienteSel: number | '' = '';

  // ---- El cliente de la venta ----
  //
  // Es OPCIONAL: la mayoría de las ventas de mostrador son a quien pasa, y
  // exigir un nombre frenaría la caja. Pero si se identifica, la venta queda en
  // su historial —qué colores se lleva, cuánto compra— y se le puede fiar.
  readonly clienteSel = signal<ClienteParaVenta | null>(null);
  readonly resultadosCliente = signal<ClienteParaVenta[]>([]);
  readonly buscandoCliente = signal(false);
  qCliente = '';
  /**
   * Alta rápida del cliente DESDE LA CAJA. Solo nombre y teléfono: al cajero
   * con gente esperando no se le puede pedir RFC ni dirección, y el expediente
   * completo se llena después en Admin → Clientes.
   *
   * Nace SIN crédito (límite en cero), así que el cobro es completo: todavía no
   * se sabe si paga. El administrador recibe el aviso en la campana para
   * decidir si le autoriza.
   */
  readonly creandoCliente = signal(false);
  readonly guardandoCliente = signal(false);
  nuevoCliente = { nombre: '', telefono: '', nombre_comercial: '' };
  /** Cuánto de esta venta se va a crédito. */
  aCredito: number | null = null;
  readonly fiando = signal(false);

  /**
   * APARTAR: el cliente deja un anticipo y la mercancía se le guarda sin
   * descontarse del inventario. Es lo contrario de fiar —fiar es entregar sin
   * cobrar, apartar es cobrar sin entregar— así que los dos no pueden estar
   * activos a la vez.
   */
  readonly apartando = signal(false);
  anticipo: number | null = null;

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

  /**
   * El TOTAL de verdad, con IVA, calculado por el servidor.
   *
   * Hace falta para poder fiar: sin él, el cajero tendría que adivinar cuánto
   * es el total con impuestos y "fiar todo" dejaría siempre un pedazo sin
   * cubrir. Se pide con `POST /pedidos/cotizacion`, que corre la MISMA función
   * que la venta, así que el número es el que se va a cobrar.
   */
  readonly totalReal = signal<number | null>(null);
  readonly cotizando = signal(false);

  /** El total que se usa para todo: el del servidor, o el estimado mientras llega. */
  readonly total = computed(() => this.totalReal() ?? this.subtotalEstimado());

  // Cobro
  metodoSel: number | '' = '';
  montoPago: number | null = null;

  constructor() {
    // Cada vez que cambia el carrito (o la lista de precios) se pide el total
    // real. Va en un `effect` y no en cada punto donde se toca el carrito:
    // son cinco sitios distintos y era cuestión de tiempo que alguno se
    // olvidara.
    effect(() => {
      const items = this.carrito();
      const tipo = this.tipoClienteSel;
      const s = this.sesion();
      if (items.length === 0 || !s) {
        this.totalReal.set(null);
        return;
      }
      this.cotizando.set(true);
      this.tienda
        .cotizar({
          canal: 'punto_venta',
          sesion_caja_id: s.id,
          tipo_cliente_id: tipo ? Number(tipo) : undefined,
          items: items.map((i) => ({ variante_id: i.variante_id, cantidad: i.cantidad })),
        })
        .subscribe({
          next: (c) => {
            this.totalReal.set(c.total);
            this.cotizando.set(false);
          },
          // Si la cotización falla se sigue con el estimado: no vale la pena
          // frenar la caja por no poder mostrar el IVA.
          error: () => {
            this.totalReal.set(null);
            this.cotizando.set(false);
          },
        });
    });

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

  /** `Number()` no existe en las plantillas y los DECIMAL llegan como string. */
  num(v: unknown): number {
    return Number(v ?? 0);
  }

  dinero(v: unknown): string {
    return this.num(v).toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 2,
    });
  }

  // ---------------------------------------------------------------- cliente

  /**
   * Busca al cliente por nombre, apodo, teléfono o código. Se pide al servidor
   * a partir de dos letras: con una devolvería media tienda.
   */
  buscarCliente(): void {
    const q = this.qCliente.trim();
    if (q.length < 2) {
      this.resultadosCliente.set([]);
      return;
    }
    this.buscandoCliente.set(true);
    this.clientesSvc.buscar(q).subscribe({
      next: (r) => {
        this.resultadosCliente.set(r);
        this.buscandoCliente.set(false);
      },
      error: () => {
        this.resultadosCliente.set([]);
        this.buscandoCliente.set(false);
      },
    });
  }

  /**
   * Al elegirlo se aplica SU lista de precios, si tiene una. Así nadie le cobra
   * precio público a un cliente de mayoreo por descuido, que es justo el error
   * que un selector aparte deja pasar.
   */
  elegirCliente(c: ClienteParaVenta): void {
    this.clienteSel.set(c);
    this.resultadosCliente.set([]);
    this.qCliente = '';
    if (c.tipo_cliente_id) this.tipoClienteSel = c.tipo_cliente_id;
    this.error.set(null);
  }

  /** Abre el alta rápida, con lo que ya se hubiera teclesado en el buscador. */
  abrirAltaCliente(): void {
    // Lo que escribió buscando probablemente es el nombre: se aprovecha en vez
    // de hacerle teclearlo otra vez.
    const q = this.qCliente.trim();
    const esTelefono = /^[\d\s()+-]{7,}$/.test(q);
    this.nuevoCliente = {
      nombre: esTelefono ? '' : q,
      telefono: esTelefono ? q : '',
      nombre_comercial: '',
    };
    this.resultadosCliente.set([]);
    this.error.set(null);
    this.creandoCliente.set(true);
  }

  cerrarAltaCliente(): void {
    this.creandoCliente.set(false);
  }

  guardarNuevoCliente(): void {
    const nombre = this.nuevoCliente.nombre.trim();
    if (!nombre) {
      this.error.set('Ponle al menos un nombre al cliente.');
      return;
    }
    this.guardandoCliente.set(true);
    this.error.set(null);
    this.clientesSvc
      .crear({
        nombre,
        telefono: this.nuevoCliente.telefono.trim() || null,
        nombre_comercial: this.nuevoCliente.nombre_comercial.trim() || null,
      })
      .subscribe({
        next: (c) => {
          this.guardandoCliente.set(false);
          this.creandoCliente.set(false);
          this.qCliente = '';
          // Queda elegido para la venta que se está cobrando. Sin crédito, así
          // que el bloque de fiar no va a aparecer: es lo correcto para alguien
          // de quien todavía no se sabe si paga.
          this.clienteSel.set({
            id: c.id,
            codigo: c.codigo ?? null,
            nombre: c.nombre,
            nombre_comercial: c.nombre_comercial ?? null,
            telefono: c.telefono ?? null,
            tipo_cliente_id: c.tipo_cliente_id ?? null,
            tipo_cliente: c.tipo_cliente ?? null,
            limite_credito: 0,
            saldo: 0,
            credito_disponible: 0,
          });
          this.mensaje.set(
            `${c.nombre_comercial || c.nombre} quedó registrado. Todavía sin crédito: ` +
              'el cobro es completo hasta que un administrador le autorice un límite.'
          );
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.guardandoCliente.set(false);
        },
      });
  }

  quitarCliente(): void {
    this.clienteSel.set(null);
    this.aCredito = null;
    this.fiando.set(false);
  }

  /** Cuánto se le puede fiar ahora mismo. */
  readonly creditoDisponible = computed(() => Number(this.clienteSel()?.credito_disponible ?? 0));

  /** Abre la captura del crédito, ya con el total propuesto. */
  abrirCredito(): void {
    if (!this.clienteSel()) return;
    this.apartando.set(false);
    this.anticipo = null;
    this.aCredito = Math.min(this.total(), this.creditoDisponible());
    this.fiando.set(true);
  }

  /**
   * Abre la captura del apartado. Sin propuesta de anticipo: lo que deje es
   * decisión del cliente, y poner una cifra por omisión invitaría a cobrarle
   * eso sin preguntarle.
   */
  abrirApartado(): void {
    if (!this.clienteSel()) return;
    this.cerrarCredito();
    this.anticipo = null;
    this.apartando.set(true);
  }

  cerrarApartado(): void {
    this.apartando.set(false);
    this.anticipo = null;
  }

  /** Lo que le falta por pagar del apartado, para mostrarlo al capturar. */
  readonly pendienteApartado = computed(() => {
    const a = Number(this.anticipo ?? 0);
    return Math.max(0, Math.round((this.total() - a) * 100) / 100);
  });

  cerrarCredito(): void {
    this.fiando.set(false);
    this.aCredito = null;
  }

  /** Lo que el cliente tiene que poner hoy: el total menos lo que se le fía. */
  readonly aPagarHoy = computed(() => {
    const fiado = this.fiando() ? Number(this.aCredito ?? 0) : 0;
    return Math.max(0, Math.round((this.total() - fiado) * 100) / 100);
  });

  cobrar(): void {
    const s = this.sesion();
    if (!s || this.carrito().length === 0) {
      this.error.set('Agrega productos para poder cobrar.');
      return;
    }
    // --- Apartado: se guarda la mercancía y solo entra el anticipo ---
    if (this.apartando()) {
      if (!this.clienteSel()) {
        this.error.set('Para apartar hay que decir a quién se le guarda: busca al cliente arriba.');
        return;
      }
      const anticipo = Number(this.anticipo ?? 0);
      if (anticipo > this.total() + 0.001) {
        this.error.set(
          `El anticipo (${this.dinero(anticipo)}) es mayor que el apartado (${this.dinero(this.total())}).`
        );
        return;
      }
      if (anticipo > 0 && !this.metodoSel) {
        this.error.set('Elige con qué está dejando el anticipo.');
        return;
      }
      this.error.set(null);
      this.apartar(s, anticipo);
      return;
    }

    const fiado = this.fiando() ? Number(this.aCredito ?? 0) : 0;
    if (fiado > 0 && !this.clienteSel()) {
      this.error.set('Para fiar hay que decir a quién: busca al cliente arriba.');
      return;
    }
    if (fiado > this.creditoDisponible() + 0.001) {
      this.error.set(
        `Solo le quedan $${this.creditoDisponible().toFixed(2)} de crédito.`
      );
      return;
    }
    // Con la venta completa a crédito no hace falta método de pago: no entra
    // dinero. Si paga algo hoy, sí.
    if (this.aPagarHoy() > 0 && !this.metodoSel) {
      this.error.set('Elige con qué está pagando lo de hoy.');
      return;
    }
    this.error.set(null);
    const monto = this.montoPago ?? 0;

    this.ventas
      .crearPedido({
        canal: 'punto_venta',
        sesion_caja_id: s.id,
        tipo_cliente_id: this.tipoClienteSel ? Number(this.tipoClienteSel) : undefined,
        // Si se identificó al cliente, la venta queda en su historial.
        cliente_id: this.clienteSel()?.id,
        a_credito: fiado > 0 ? fiado : undefined,
        items: this.carrito().map((i) => ({
          variante_id: i.variante_id,
          cantidad: i.cantidad,
          // Va el rastro de los bultos escaneados, si hubo.
          bultos: i.bultos?.length ? i.bultos : undefined,
        })),
        // Sin nada que pagar hoy (todo a crédito) no se manda pago alguno.
        pagos:
          this.aPagarHoy() > 0
            ? [{ metodo_pago_id: Number(this.metodoSel), monto }]
            : undefined,
      })
      .subscribe({
        next: (pedido) => {
          const cambio = Math.max(0, monto - Number(pedido.total));
          this.ticket.set({ pedido, cambio });
          this.carrito.set([]);
          this.montoPago = null;
          this.qVar = '';
          this.cerrarApartado();
          this.quitarCliente();
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

  /**
   * Crea el apartado. Va aparte de `cobrar()` porque no es un cobro: la
   * mercancía no sale del inventario, el anticipo puede ser cero, y el ticket
   * dice otra cosa.
   *
   * Tampoco manda los bultos escaneados: el bulto se consume cuando la
   * mercancía SALE, y aquí todavía no sale. Marcarlo ahora lo dejaría como
   * vendido estando en la bodega.
   */
  private apartar(s: SesionCaja, anticipo: number): void {
    this.ventas
      .crearPedido({
        canal: 'punto_venta',
        sesion_caja_id: s.id,
        cliente_id: this.clienteSel()!.id,
        tipo_cliente_id: this.tipoClienteSel ? Number(this.tipoClienteSel) : undefined,
        apartado: true,
        items: this.carrito().map((i) => ({
          variante_id: i.variante_id,
          cantidad: i.cantidad,
        })),
        // Sin anticipo no se manda pago: hay clientes que apartan y vuelven a
        // pagar, y un pago de cero no significa nada.
        pagos:
          anticipo > 0
            ? [{ metodo_pago_id: Number(this.metodoSel), monto: anticipo }]
            : undefined,
      })
      .subscribe({
        next: (pedido) => {
          // El "cambio" de un apartado es cero: el anticipo se queda tal cual.
          this.ticket.set({ pedido, cambio: 0 });
          this.carrito.set([]);
          this.montoPago = null;
          this.qVar = '';
          this.cerrarApartado();
          this.quitarCliente();
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
