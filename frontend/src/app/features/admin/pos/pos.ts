import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { VentasService } from '../../../core/services/ventas.service';
import { CodigoResuelto, InventarioService } from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { TipoCliente } from '../../../core/models/catalogo.models';
import { Caja, ItemCarrito, MetodoPago, Pedido, SesionCaja } from '../../../core/models/ventas.models';
import { ClientesService } from '../../../core/services/clientes.service';
import { ClienteParaVenta } from '../../../core/models/clientes.models';
import { TiendaService } from '../../../core/services/tienda.service';
import { Cotizacion } from '../../../core/models/tienda.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

/**
 * La caja con que se cobra. La MISMA clave la usa la pantalla Caja, para que
 * las dos abran la misma: el cajero abre el turno allá y cobra aquí sin volver
 * a elegir.
 */
const CLAVE_CAJA = 'caja_sel';

function leerCajaGuardada(): number | null {
  try {
    const v = Number(localStorage.getItem(CLAVE_CAJA));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function guardarCaja(id: number): void {
  try {
    localStorage.setItem(CLAVE_CAJA, String(id));
  } catch {
    /* sin almacenamiento local solo se pierde el recordatorio */
  }
}

/**
 * Cómo se lleva la mercancía. Son excluyentes: fiar es ENTREGAR sin cobrar,
 * apartar es COBRAR sin entregar, y cobrar es las dos cosas a la vez.
 */
export type ModoVenta = 'cobrar' | 'fiar' | 'apartar';

/**
 * PUNTO DE VENTA (rediseño 2026-10): aquí solo se COBRA. El turno, el efectivo
 * y el corte se mudaron a la pantalla Caja (`/admin/caja`): antes vivían abajo
 * del cobro y el corte quedaba escondido debajo del carrito. La administración
 * de cajas también se fue para allá.
 */
@Component({
  selector: 'app-pos',
  host: { '(document:keydown.escape)': 'alEscape()' },
  imports: [FormsModule, RouterLink, DineroPipe, CantidadPipe],
  templateUrl: './pos.html',
  styleUrls: ['./pos.scss', './pos-bultos.scss'],
})
export class Pos {
  private readonly ventas = inject(VentasService);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly inv = inject(InventarioService);
  private readonly auth = inject(AuthService);
  private readonly catalogo = inject(CatalogoService);
  private readonly clientesSvc = inject(ClientesService);
  private readonly tienda = inject(TiendaService);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);

  // ---- Permisos del puesto ----
  // Esconder es solo para no ofrecer lo que va a fallar: el servidor también
  // rechaza (403) lo que el puesto no tiene.
  readonly veCaja = computed(() => this.auth.puede('ver:caja'));
  readonly veClientes = computed(() => this.auth.puede('ver:clientes'));
  readonly veApartados = computed(() => this.auth.puede('ver:apartados'));
  readonly puedeFiar = computed(() => this.auth.puede('hacer:fiar'));

  /** Listas de precio. Se cobra la elegida; por omisión, la del público. */
  readonly tiposCliente = signal<TipoCliente[]>([]);
  /**
   * La lista con que se cobra. Es SEÑAL, no una propiedad con ngModel: el total
   * real se recalcula en un `effect`, y un `effect` solo se entera de que algo
   * cambió si lo que lee es una señal. Como propiedad, cambiar de lista dejaba
   * en pantalla el total de la anterior.
   */
  readonly tipoClienteSel = signal<number | ''>('');
  /** La lista del público: a la que se regresa al quitar al cliente o cobrar. */
  private publicoId: number | '' = '';

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
   * Lo que el cliente tiene apartado sin liquidar. Se avisa junto a su deuda:
   * si viene a comprar, es el momento de recordarle lo que tiene guardado.
   */
  readonly apartadoCliente = signal<{ num: number; pendiente: number } | null>(null);
  /**
   * Alta rápida del cliente DESDE LA CAJA. Solo nombre y teléfono: al cajero
   * con gente esperando no se le puede pedir RFC ni dirección, y el expediente
   * completo se llena después en Clientes.
   *
   * Nace SIN crédito (límite en cero), así que el cobro es completo: todavía no
   * se sabe si paga. El administrador recibe el aviso en la campana para
   * decidir si le autoriza.
   */
  readonly creandoCliente = signal(false);
  readonly guardandoCliente = signal(false);
  nuevoCliente = { nombre: '', telefono: '', nombre_comercial: '' };

  /**
   * Cobrar, fiar o apartar. Es una sola señal y no dos banderas sueltas: así no
   * hay forma de quedar fiando y apartando a la vez.
   */
  readonly modo = signal<ModoVenta>('cobrar');
  readonly fiando = computed(() => this.modo() === 'fiar');
  /**
   * APARTAR: el cliente deja un anticipo y la mercancía se le guarda sin
   * descontarse del inventario. Es lo contrario de fiar —fiar es entregar sin
   * cobrar, apartar es cobrar sin entregar— así que los dos no pueden estar
   * activos a la vez.
   */
  readonly apartando = computed(() => this.modo() === 'apartar');
  /**
   * Cuánto de esta venta se va a crédito. Vacío = todo lo que le alcance del
   * crédito: se puede elegir Fiar antes de escanear, y una cifra fija se
   * quedaba vieja en cuanto crecía el carrito.
   */
  aCredito: number | null = null;
  anticipo: number | null = null;

  readonly cajas = signal<Caja[]>([]);
  readonly cargandoCajas = signal(true);
  readonly cargandoSesion = signal(false);
  readonly metodos = signal<MetodoPago[]>([]);
  readonly sesion = signal<SesionCaja | null>(null);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly ticket = signal<{
    pedido: Pedido;
    cambio: number;
    /** Lo que pagó hoy y lo que se le fió: una venta mixta lleva las dos cosas. */
    pagadoHoy: number;
    fiado: number;
  } | null>(null);

  cajaSel: number | '' = '';

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
  /** La cotización completa: subtotal, IVA y el precio de cada línea según la lista. */
  readonly cotizacion = signal<Cotizacion | null>(null);
  readonly cotizando = signal(false);
  /**
   * Por qué no se pudo cotizar, cuando es algo que el cajero tiene que saber
   * ANTES de cobrar: "ROJO 2/30 está agotado", "quedan 80 para vender". Antes
   * la caja seguía con el estimado y el error salía hasta darle a Cobrar.
   */
  readonly avisoCotizacion = signal<string | null>(null);

  /** El total que se usa para todo: el del servidor, o el estimado mientras llega. */
  readonly total = computed(() => this.totalReal() ?? this.subtotalEstimado());

  // Cobro
  metodoSel: number | '' = '';
  montoPago: number | null = null;

  // ---- Abono a la cuenta del cliente, sin salir de la venta ----
  readonly abonando = signal(false);
  readonly registrandoAbono = signal(false);
  readonly errorAbono = signal<string | null>(null);
  montoAbono: number | null = null;
  metodoAbono: number | '' = '';
  referenciaAbono = '';

  constructor() {
    // Cada vez que cambia el carrito (o la lista de precios) se pide el total
    // real. Va en un `effect` y no en cada punto donde se toca el carrito:
    // son cinco sitios distintos y era cuestión de tiempo que alguno se
    // olvidara.
    effect(() => {
      const items = this.carrito();
      const tipo = this.tipoClienteSel();
      const s = this.sesion();
      if (items.length === 0 || !s) {
        this.totalReal.set(null);
        this.cotizacion.set(null);
        this.avisoCotizacion.set(null);
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
            this.cotizacion.set(c);
            this.avisoCotizacion.set(null);
            this.cotizando.set(false);
          },
          // Si la cotización falla se sigue con el estimado: no vale la pena
          // frenar la caja por no poder mostrar el IVA. Pero si el servidor dijo
          // POR QUÉ —casi siempre, existencias— se avisa ya.
          error: (e) => {
            this.totalReal.set(null);
            this.cotizacion.set(null);
            const api = (e as { error?: { error?: ApiError } })?.error?.error;
            this.avisoCotizacion.set(api?.code === 'STOCK_INSUFICIENTE' ? api.message : null);
            this.cotizando.set(false);
          },
        });
    });

    // La sesión puede venir vacía al recargar directo en /admin/pos.
    if (!this.auth.sesion()) {
      this.auth.cargarPerfil().subscribe({ next: () => {}, error: () => {} });
    }
    this.cargarCajas();
    this.catalogo.tiposCliente().subscribe({
      next: (ts) => {
        const activos = ts.filter((x) => x.activo);
        this.tiposCliente.set(activos);
        // Arranca en el público: es el precio de mostrador. Si ya se eligió un
        // cliente (llegó con ?cliente= desde su expediente), manda su lista.
        this.publicoId = (activos.find((x) => x.es_publico) ?? activos[0])?.id ?? '';
        this.tipoClienteSel.set(this.clienteSel()?.tipo_cliente_id ?? this.publicoId);
      },
      error: () => {},
    });
    this.clienteDeLaRuta();
    this.ventas.metodosPago().subscribe({
      next: (m) => {
        this.metodos.set(m);
        const efectivo = m.find((x) => x.nombre.toLowerCase().includes('efectivo'));
        this.metodoSel = efectivo?.id ?? m[0]?.id ?? '';
      },
      error: () => {},
    });
  }

  // ------------------------------------------------------------------ la caja

  /**
   * Las cajas de la tienda, con su turno abierto si tienen. Se entra a la que
   * se usó la última vez (aquí o en Caja); si ya no existe, a la primera con
   * turno abierto; si ninguna lo tiene, a la primera activa.
   */
  private cargarCajas(): void {
    this.ventas.cajas().subscribe({
      next: (cs) => {
        // Una caja dada de baja no vende, salvo que se haya quedado con un turno
        // abierto: ese turno todavía tiene que poder cobrar y cerrarse.
        const usables = cs.filter((c) => c.activo || c.turno_id);
        this.cajas.set(usables);
        this.cargandoCajas.set(false);
        const guardada = leerCajaGuardada();
        const elegida =
          usables.find((c) => c.id === guardada) ??
          usables.find((c) => c.turno_id) ??
          usables[0];
        if (elegida) {
          this.cajaSel = elegida.id;
          this.verificarSesion();
        }
      },
      error: (e) => {
        this.cargandoCajas.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  verificarSesion(): void {
    if (!this.cajaSel) return;
    this.error.set(null);
    // Mientras llega, la pantalla espera: sin esto parpadeaba "el turno está
    // cerrado" en una caja que sí lo tiene abierto.
    this.cargandoSesion.set(true);
    this.ventas.sesionAbierta(Number(this.cajaSel)).subscribe({
      next: (s) => {
        this.sesion.set(s && s.estado === 'abierta' ? s : null);
        this.cargandoSesion.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargandoSesion.set(false);
      },
    });
  }

  /**
   * Pasar a otra caja. Se puede aunque esta tenga turno abierto: con varias
   * cajas, antes solo se elegía caja cuando no había ninguno, y si la primera
   * lo tenía las demás quedaban fuera de alcance.
   */
  cambiarCaja(): void {
    if (!this.cajaSel) return;
    guardarCaja(Number(this.cajaSel));
    this.sesion.set(null);
    this.mensaje.set(null);
    this.verificarSesion();
  }

  /** La caja elegida. Método: `cajaSel` es una propiedad con ngModel. */
  cajaActual(): Caja | null {
    return this.cajas().find((c) => c.id === Number(this.cajaSel)) ?? null;
  }

  /** "Caja Cuautepec · turno de Lupita R., abierto a las 9:02". */
  subtitulo(): string {
    const s = this.sesion();
    const caja = s?.caja ?? this.cajaActual()?.nombre;
    if (!caja) return this.cargandoCajas() ? '' : 'Sin caja para cobrar';
    if (!s) return this.cargandoSesion() ? caja : `${caja} · sin turno abierto`;
    return `${caja} · turno de ${s.usuario ?? 'alguien'}, abierto ${this.cuando(s.fecha_apertura)}`;
  }

  /** "a las 9:02" si fue hoy; "el 01/10 a las 9:02" si viene de otro día. */
  private cuando(fecha: string): string {
    const [dia, hora] = String(fecha ?? '').replace('T', ' ').split(' ');
    const hhmm = (hora ?? '').slice(0, 5).replace(/^0/, '');
    const hoy = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const hoyTxt = `${hoy.getFullYear()}-${p(hoy.getMonth() + 1)}-${p(hoy.getDate())}`;
    if (!dia || dia === hoyTxt) return `a las ${hhmm}`;
    const [, m, d] = dia.split('-');
    return `el ${d}/${m} a las ${hhmm}`;
  }

  // ------------------------------------------------------------- el carrito

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

    if (this.sinPrecio(this.nombreHilo(v), Number(v.precio_oferta ?? v.precio))) {
      this.qVar = '';
      return;
    }

    const peso = r.bulto?.peso_kg != null ? Number(r.bulto.peso_kg) : null;

    // Código de la presentación (no de un bulto): se agrega como siempre.
    if (!r.bulto || !peso || peso <= 0) {
      this.agregar({
        id: v.id,
        sku: v.sku,
        producto: this.nombreHilo(v),
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
            producto: this.nombreHilo(v),
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

  /**
   * Un hilo en $0 entró con la lista del proveedor y todavía no tiene precio:
   * no se vende (el servidor también lo rechaza). Se avisa al escanearlo o al
   * agregarlo, no hasta cobrar.
   */
  private sinPrecio(nombre: string, precio: number): boolean {
    if (precio > 0) return false;
    this.error.set(`«${nombre}» todavía no tiene precio, así que no se puede vender. Se le pone en Productos.`);
    return true;
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
            producto: this.nombreHilo(v),
            presentacion: v.presentacion,
            precio: Number(v.precio_oferta ?? v.precio),
            unidad: v.unidad,
          }))
        ),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  /**
   * El hilo con su calibre: ROJO 1/30 y ROJO 2/30 son dos productos, y con el
   * color solo el carrito y el ticket no dicen cuál se está vendiendo.
   */
  private nombreHilo(v: { producto?: string | null; calibre?: string | null }): string {
    return `${v.producto ?? ''}${v.calibre ? ' ' + v.calibre : ''}`;
  }

  agregar(r: {
    id: number;
    sku: string;
    producto: string;
    presentacion?: string | null;
    precio: number;
    unidad?: string;
  }): void {
    if (this.sinPrecio(r.producto, r.precio)) return;
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

  /**
   * Quita UN bulto escaneado de la línea (el cliente se llevó 2 de 3): baja sus
   * kilos y deja de ir en la venta. Es la única forma de cobrar menos en una
   * línea con bultos: si se bajaran los kilos a mano, el bulto que no se lleva
   * quedaría "vendido" estando en la bodega (2026-10-06). Sin bultos, la línea
   * se va.
   */
  quitarBulto(item: ItemCarrito, codigo: string): void {
    const quedan = (item.bultos ?? []).filter((b) => b.codigo !== codigo);
    const quitado = (item.bultos ?? []).find((b) => b.codigo === codigo);
    if (!quitado) return;
    if (!quedan.length && this.round3(item.cantidad - Number(quitado.peso_kg)) <= 0) return this.quitar(item);
    this.carrito.update((arr) =>
      arr.map((i) =>
        i.variante_id === item.variante_id
          ? { ...i, bultos: quedan, cantidad: this.round3(i.cantidad - Number(quitado.peso_kg)) }
          : i
      )
    );
    this.mensaje.set(`Se quitó el bulto ${codigo} del ticket.`);
  }

  /** La venta es por peso: la cantidad admite decimales (2.5 kg). */
  cambiarCantidad(item: ItemCarrito, cantidad: number): void {
    // Con bultos escaneados los kilos son los de los bultos: se cambian quitando
    // un bulto (ver quitarBulto). La caja ni deja teclearlos.
    if (item.bultos?.length) return;
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

  async vaciar(): Promise<void> {
    if (this.carrito().length > 1) {
      const si = await this.confirmacion.pedir({
        titulo: '¿Vaciar el carrito?',
        mensaje: `Se quitan los ${this.carrito().length} hilos de esta venta.`,
        aceptar: 'Vaciar',
        peligro: true,
      });
      if (!si) return;
    }
    this.carrito.set([]);
  }

  /**
   * El precio por kilo con que de verdad se cobra la línea: el de la lista de
   * precios, según la cotización. Sin ella, el de la presentación.
   */
  precioDe(i: ItemCarrito): number {
    const l = this.cotizacion()?.lineas.find((x) => x.variante_id === i.variante_id);
    return l ? Number(l.precio_unitario) : i.precio;
  }

  /** El importe de la línea, sin IVA. */
  importeDe(i: ItemCarrito): number {
    const l = this.cotizacion()?.lineas.find((x) => x.variante_id === i.variante_id);
    return l ? Number(l.subtotal) : i.precio * i.cantidad;
  }

  /** `Number()` no existe en las plantillas y los DECIMAL llegan como string. */
  num(v: unknown): number {
    return Number(v ?? 0);
  }

  dinero(v: unknown): string {
    return this.num(v).toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
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
    // Sin lista propia se cobra al público, aunque antes se hubiera elegido otra.
    this.tipoClienteSel.set(c.tipo_cliente_id ?? this.publicoId);
    this.error.set(null);
    this.cargarApartadoCliente(c.id);
  }

  /**
   * "Venderle" en el expediente del cliente abre la caja con `?cliente=<id>`:
   * llega ya elegido, con su lista de precios y su crédito a la vista, en vez de
   * obligar al cajero a buscarlo otra vez.
   */
  private clienteDeLaRuta(): void {
    const id = Number(this.ruta.snapshot.queryParamMap.get('cliente'));
    if (!Number.isInteger(id) || id <= 0) return;
    this.clientesSvc.expediente(id).subscribe({
      next: (c) => {
        if (!c.activo) return; // uno dado de baja no se elige por un enlace viejo
        this.elegirCliente({
          id: c.id,
          codigo: c.codigo ?? null,
          nombre: c.nombre,
          nombre_comercial: c.nombre_comercial ?? null,
          telefono: c.telefono ?? null,
          tipo_cliente_id: c.tipo_cliente_id ?? null,
          tipo_cliente: c.tipo_cliente ?? null,
          limite_credito: c.limite_credito,
          saldo: c.saldo ?? 0,
          credito_disponible: c.credito_disponible ?? 0,
        });
      },
      error: () => {},
    });
  }

  /** Lo que tiene apartado sin liquidar, para el aviso de su tarjeta. */
  private cargarApartadoCliente(clienteId: number): void {
    this.apartadoCliente.set(null);
    this.ventas.apartados({ cliente_id: clienteId }).subscribe({
      next: (d) => {
        // Puede que ya se haya elegido a otro mientras llegaba la respuesta.
        if (this.clienteSel()?.id !== clienteId) return;
        const pendiente = d.items.reduce((s, a) => s + Number(a.pendiente), 0);
        this.apartadoCliente.set(
          d.items.length ? { num: d.items.length, pendiente: Math.round(pendiente * 100) / 100 } : null
        );
      },
      error: () => this.apartadoCliente.set(null),
    });
  }

  /** Iniciales para el círculo del cliente ("Tejidos Doña Chela" → "TD"). */
  iniciales(c: ClienteParaVenta): string {
    const partes = (c.nombre_comercial || c.nombre || '').trim().split(/\s+/).filter(Boolean);
    return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || '?';
  }

  /** Abre el alta rápida, con lo que ya se hubiera tecleado en el buscador. */
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
          // que Fiar queda deshabilitado: es lo correcto para alguien de quien
          // todavía no se sabe si paga.
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
          this.apartadoCliente.set(null);
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

  /**
   * Quita al cliente y REGRESA al precio público. Si la lista se quedara, el
   * siguiente que pasa —que casi siempre es un cliente de mostrador— pagaría
   * con los precios de mayoreo del anterior.
   */
  quitarCliente(): void {
    this.clienteSel.set(null);
    this.apartadoCliente.set(null);
    // Sin cliente no se fía ni se aparta: se regresa a cobrar.
    this.elegirModo('cobrar');
    this.tipoClienteSel.set(this.publicoId);
  }

  /** Cuánto se le puede fiar ahora mismo. */
  readonly creditoDisponible = computed(() => Number(this.clienteSel()?.credito_disponible ?? 0));

  // ---------------------------------------------------- cobrar, fiar, apartar

  /**
   * Por qué no se le puede fiar, o `null` si sí. Va escrito junto al botón:
   * un botón apagado sin explicación hace que el cajero crea que la caja falla.
   */
  motivoSinFiar(): string | null {
    const c = this.clienteSel();
    if (!c) return 'Para fiar, primero elige al cliente.';
    if (Number(c.limite_credito) <= 0) return `${c.nombre_comercial || c.nombre} no tiene crédito autorizado.`;
    if (this.creditoDisponible() <= 0) {
      return `Ya llegó a su límite de crédito (${this.dinero(c.limite_credito)}). Tiene que abonar antes de que se le pueda fiar más.`;
    }
    return null;
  }

  /** Apartar exige saber a quién se le guarda. */
  motivoSinApartar(): string | null {
    return this.clienteSel() ? null : 'Para apartar, primero elige al cliente.';
  }

  elegirModo(m: ModoVenta): void {
    if (m === 'fiar' && (!this.puedeFiar() || this.motivoSinFiar())) return;
    if (m === 'apartar' && this.motivoSinApartar()) return;
    this.modo.set(m);
    this.aCredito = null;
    // Sin propuesta de anticipo: lo que deje es decisión del cliente, y poner
    // una cifra por omisión invitaría a cobrarle eso sin preguntarle.
    this.anticipo = null;
  }

  // Los nombres de antes, para que se lea igual que la pantalla.
  abrirCredito(): void { this.elegirModo('fiar'); }
  cerrarCredito(): void { if (this.fiando()) this.elegirModo('cobrar'); }
  abrirApartado(): void { this.elegirModo('apartar'); }
  cerrarApartado(): void { if (this.apartando()) this.elegirModo('cobrar'); }

  /** Lo que se le propone fiar si no teclea nada: todo lo que le alcance. */
  propuestaCredito(): number {
    return Math.max(0, Math.min(this.total(), this.creditoDisponible()));
  }

  /**
   * Lo que se va a fiar de verdad. Es MÉTODO, no `computed`: lee `aCredito`,
   * que es un campo con ngModel, y un `computed` no se entera cuando cambia —
   * el "paga hoy" se quedaba pegado mientras el cajero tecleaba.
   */
  fiadoActual(): number {
    if (!this.fiando()) return 0;
    return this.aCredito == null || (this.aCredito as unknown) === ''
      ? this.propuestaCredito()
      : Number(this.aCredito);
  }

  /** Lo que el cliente tiene que poner hoy: el total menos lo que se le fía. Método: lee ngModel. */
  aPagarHoy(): number {
    return Math.max(0, Math.round((this.total() - this.fiadoActual()) * 100) / 100);
  }

  /** Lo que le falta por pagar del apartado, para mostrarlo al capturar. Método: lee ngModel. */
  pendienteApartado(): number {
    const a = Number(this.anticipo ?? 0);
    return Math.max(0, Math.round((this.total() - a) * 100) / 100);
  }

  /** El texto del botón grande: dice exactamente lo que va a pasar. */
  textoBoton(): string {
    if (this.apartando()) {
      const a = Number(this.anticipo ?? 0);
      return a > 0 ? `Apartar · deja ${this.dinero(a)}` : 'Apartar sin anticipo';
    }
    if (this.fiando()) {
      return this.aPagarHoy() > 0
        ? `Cobrar ${this.dinero(this.aPagarHoy())} y fiar el resto`
        : 'Entregar a crédito';
    }
    return `Cobrar ${this.dinero(this.total())}`;
  }

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

    const fiado = this.fiadoActual();
    if (fiado > 0 && !this.clienteSel()) {
      this.error.set('Para fiar hay que decir a quién: busca al cliente arriba.');
      return;
    }
    if (fiado > this.creditoDisponible() + 0.001) {
      this.error.set(`Solo le quedan ${this.dinero(this.creditoDisponible())} de crédito.`);
      return;
    }
    // Con la venta completa a crédito no hace falta método de pago: no entra
    // dinero. Si paga algo hoy, sí.
    if (this.aPagarHoy() > 0 && !this.metodoSel) {
      this.error.set('Elige con qué está pagando lo de hoy.');
      return;
    }
    const aPagar = this.aPagarHoy();
    // Con tarjeta o transferencia se cobra justo. En efectivo, lo que el cliente
    // entrega; vacío quiere decir que pagó con el importe exacto.
    const recibido = this.esEfectivoSel() ? Number(this.montoPago ?? aPagar) : aPagar;
    if (aPagar > 0 && recibido + 0.001 < aPagar) {
      this.error.set(
        `Faltan ${this.dinero(aPagar - recibido)}: recibió ${this.dinero(recibido)} y son ${this.dinero(aPagar)}.`
      );
      return;
    }
    this.error.set(null);

    this.ventas
      .crearPedido({
        canal: 'punto_venta',
        sesion_caja_id: s.id,
        tipo_cliente_id: this.tipoClienteSel() ? Number(this.tipoClienteSel()) : undefined,
        // Si se identificó al cliente, la venta queda en su historial.
        cliente_id: this.clienteSel()?.id,
        a_credito: fiado > 0 ? fiado : undefined,
        items: this.carrito().map((i) => ({
          variante_id: i.variante_id,
          cantidad: i.cantidad,
          // Va el rastro de los bultos escaneados, si hubo.
          bultos: i.bultos?.length ? i.bultos : undefined,
        })),
        // Sin nada que pagar hoy (todo a crédito) no se manda pago alguno. Se
        // manda lo RECIBIDO: el servidor asienta lo cobrado y devuelve el cambio.
        pagos: aPagar > 0 ? [{ metodo_pago_id: Number(this.metodoSel), monto: recibido }] : undefined,
      })
      .subscribe({
        next: (pedido) => {
          // El cambio lo calcula el servidor contra el total con que de verdad
          // se cobró; el de la pantalla pudo ser el estimado.
          const cambio = Number(pedido.cambio ?? Math.max(0, recibido - (Number(pedido.total) - fiado)));
          this.ticket.set({
            pedido,
            cambio,
            pagadoHoy: Math.round((Number(pedido.total) - fiado) * 100) / 100,
            fiado,
          });
          this.limpiarVenta();
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  /** Deja la caja lista para el siguiente cliente. */
  private limpiarVenta(): void {
    this.carrito.set([]);
    this.montoPago = null;
    this.qVar = '';
    this.resultados.set([]);
    this.mensaje.set(null);
    this.quitarCliente();
  }

  /** ¿El método elegido es efectivo? Solo el efectivo da cambio. */
  esEfectivoSel(): boolean {
    const m = this.metodos().find((x) => x.id === Number(this.metodoSel));
    return !!m && m.nombre.toLowerCase().includes('efectivo');
  }

  /** El cambio que se va a dar, mientras se teclea. Método: lee ngModel. */
  cambioPrevio(): number {
    if (!this.esEfectivoSel() || this.montoPago == null) return 0;
    return Math.max(0, Math.round((Number(this.montoPago) - this.aPagarHoy()) * 100) / 100);
  }

  /** Lo que falta si lo recibido no alcanza. Método: lee ngModel. */
  faltaPrevio(): number {
    if (!this.esEfectivoSel() || this.montoPago == null) return 0;
    return Math.max(0, Math.round((this.aPagarHoy() - Number(this.montoPago)) * 100) / 100);
  }

  nuevaVenta(): void {
    this.ticket.set(null);
  }

  /** Nombre del tipo elegido, para rotular el carrito. */
  nombreTipoCliente(): string {
    return this.tiposCliente().find((t) => t.id === Number(this.tipoClienteSel()))?.nombre ?? '';
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
        tipo_cliente_id: this.tipoClienteSel() ? Number(this.tipoClienteSel()) : undefined,
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
          this.ticket.set({ pedido, cambio: 0, pagadoHoy: anticipo, fiado: 0 });
          this.limpiarVenta();
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  // ------------------------------------------------ abono a la cuenta (deuda)

  /**
   * Cobrarle lo que debe sin salir de la venta: si viene a comprar y debe, es
   * el mejor momento. Se propone el saldo completo; puede abonar menos.
   */
  abrirAbono(): void {
    const c = this.clienteSel();
    if (!c) return;
    this.montoAbono = Number(c.saldo) > 0 ? Number(c.saldo) : null;
    const efectivo = this.metodos().find((m) => m.nombre.toLowerCase().includes('efectivo'));
    this.metodoAbono = efectivo?.id ?? '';
    this.referenciaAbono = '';
    this.errorAbono.set(null);
    this.abonando.set(true);
  }

  cerrarAbono(): void {
    this.abonando.set(false);
  }

  /** ¿El abono es en efectivo? Entonces entra al turno de esta caja. */
  abonoEnEfectivo(): boolean {
    const m = this.metodos().find((x) => x.id === Number(this.metodoAbono));
    return !!m && m.nombre.toLowerCase().includes('efectivo');
  }

  registrarAbono(): void {
    const c = this.clienteSel();
    const s = this.sesion();
    if (!c) return;
    const monto = Number(this.montoAbono ?? 0);
    if (!(monto > 0)) {
      this.errorAbono.set('Pon cuánto está abonando.');
      return;
    }
    if (!this.metodoAbono) {
      this.errorAbono.set('Elige con qué está pagando.');
      return;
    }
    this.registrandoAbono.set(true);
    this.errorAbono.set(null);
    this.clientesSvc
      .abonar(c.id, {
        monto,
        metodo_pago_id: Number(this.metodoAbono),
        // En efectivo el dinero entra al turno de ESTA caja: si no, el corte
        // esperaría menos de lo que hay en el cajón.
        sesion_caja_id: this.abonoEnEfectivo() ? s?.id : undefined,
        referencia: this.referenciaAbono.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.registrandoAbono.set(false);
          this.abonando.set(false);
          const saldo = Number(r.saldo_nuevo);
          const limite = Number(c.limite_credito);
          this.clienteSel.set({
            ...c,
            saldo,
            credito_disponible: Math.max(0, Math.round((limite - saldo) * 100) / 100),
          });
          this.mensaje.set(
            saldo > 0
              ? `Abono de ${this.dinero(monto)} registrado. Todavía debe ${this.dinero(saldo)}.`
              : `Abono de ${this.dinero(monto)} registrado. Ya no debe nada.`
          );
        },
        error: (e) => {
          this.registrandoAbono.set(false);
          this.errorAbono.set(this.msg(e));
        },
      });
  }

  /**
   * El carrito vive en esta pantalla: salir a Caja a media venta lo perdería.
   * Se pregunta antes, en vez de perderlo sin avisar.
   */
  async irACaja(): Promise<void> {
    if (this.carrito().length > 0) {
      const si = await this.confirmacion.pedir({
        titulo: '¿Salir a Caja?',
        mensaje: 'Hay una venta a medias en el carrito y se va a perder.',
        aceptar: 'Salir a Caja',
        cancelar: 'Seguir vendiendo',
        peligro: true,
      });
      if (!si) return;
    }
    this.router.navigateByUrl('/admin/caja');
  }

  /** Escape cierra el modal que esté abierto, nunca la venta. */
  alEscape(): void {
    if (this.abonando()) this.cerrarAbono();
    else if (this.creandoCliente()) this.cerrarAltaCliente();
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
