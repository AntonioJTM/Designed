import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
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
import { TicketService } from '../../../core/services/ticket.service';
import { TicketDelAviso } from '../../../shared/ticket/ticket-del-aviso';
import { Observable } from 'rxjs';
import { Cotizacion } from '../../../core/models/tienda.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { HiloAPesar, PesarModal } from './pesar-modal';
import { paqueteFueraDeAqui } from '../../../shared/paquete-aqui';
import { AnticipoModal } from '../clientes/anticipo-modal';

/** Un hilo de la búsqueda con sus presentaciones (paquete y cono) juntas. */
interface HiloEncontrado {
  producto_id: number;
  nombre: string;
  filas: HiloAPesar[];
  /** Tiene paquete pero todavía no tiene conos: se bajan en Inventario. */
  sinConos: boolean;
}

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

/** Campos donde se está escribiendo: ahí el cursor no se le quita a nadie. */
const TIPOS_DE_TEXTO = new Set(['text', 'search', 'number', 'tel', 'email', 'password', 'url', 'date', 'time', 'datetime-local', 'month', 'week']);

function esCampoDeTexto(e: Element | null): boolean {
  if (e instanceof HTMLTextAreaElement) return !e.disabled && !e.readOnly;
  if (e instanceof HTMLInputElement) return TIPOS_DE_TEXTO.has(e.type) && !e.disabled && !e.readOnly;
  return e instanceof HTMLElement && e.isContentEditable;
}

/**
 * Cómo se lleva la mercancía. Son excluyentes: fiar es ENTREGAR sin cobrar,
 * apartar es COBRAR sin entregar, y cobrar es las dos cosas a la vez.
 */
// "Total a cobrar" (2026-10-13, usuario): cobrar, a crédito, nota en espera
// (no sale ticket y se modifica) y nota pendiente de pago (sale el ticket y el
// pago se registra después). Se quitaron apartar, fiar (ahora "a crédito") y el
// chofer del pedido.
export type ModoVenta = 'cobrar' | 'credito' | 'espera' | 'pendiente';

/**
 * PUNTO DE VENTA (rediseño 2026-10): aquí solo se COBRA. El turno, el efectivo
 * y el corte se mudaron a la pantalla Caja (`/admin/caja`): antes vivían abajo
 * del cobro y el corte quedaba escondido debajo del carrito. La administración
 * de cajas también se fue para allá.
 */
@Component({
  selector: 'app-pos',
  host: { '(document:keydown.escape)': 'alEscape()', '(document:keydown)': 'alTeclear($event)' },
  imports: [FormsModule, RouterLink, DineroPipe, CantidadPipe, PesarModal, AnticipoModal],
  styleUrls: ['./pos.scss', './pos-bultos.scss', './pos-busqueda.scss'],
  templateUrl: './pos.html',
})
export class Pos {
  private readonly ventas = inject(VentasService);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly inv = inject(InventarioService);
  private readonly auth = inject(AuthService);
  private readonly catalogo = inject(CatalogoService);
  private readonly clientesSvc = inject(ClientesService);
  private readonly tienda = inject(TiendaService);
  private readonly tickets = inject(TicketService);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  private readonly injector = inject(Injector);

  // ---- Permisos del puesto ----
  // Esconder es solo para no ofrecer lo que va a fallar: el servidor también
  // rechaza (403) lo que el puesto no tiene.
  readonly veCaja = computed(() => this.auth.puede('ver:caja'));
  readonly veClientes = computed(() => this.auth.puede('ver:clientes'));
  readonly veNotas = computed(() => this.auth.puede('ver:notas_pendientes'));
  readonly veEncargos = computed(() => this.auth.puede('ver:encargos'));
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
  /** El alta rápida: nombre y teléfono (sin apodo desde el 2026-10-14; el número lo da el sistema). */
  nuevoCliente = { nombre: '', telefono: '' };

  /**
   * Cómo se lleva la mercancía: cobrar, a crédito, nota en espera o nota
   * pendiente de pago. Es una sola señal y no banderas sueltas: así no hay forma
   * de quedar en dos a la vez.
   */
  readonly modo = signal<ModoVenta>('cobrar');
  /** A CRÉDITO (antes "Fiar"): se lo lleva y lo debe en su cuenta, con su límite. */
  readonly fiando = computed(() => this.modo() === 'credito');
  /**
   * NOTA EN ESPERA (antes "Pedido", sin chofer desde el 2026-10-13): no sale
   * ticket; la mercancía se aparta, se modifica las veces que haga falta y se
   * cobra al entregarla, en la pantalla Notas en espera.
   */
  readonly pidiendo = computed(() => this.modo() === 'espera');
  /**
   * NOTA PENDIENTE DE PAGO (2026-10-13): se lleva la mercancía y sale el ticket,
   * pero cómo pagó se registra después, en Notas pendientes de pago (o se pasa a
   * crédito). No usa su límite de crédito.
   */
  readonly notaPendiente = computed(() => this.modo() === 'pendiente');
  paraCuando = '';
  notasPedido = '';
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
  /**
   * El aviso del LECTOR, debajo del campo donde se escanea (2026-10-14: "cuando
   * escaneo un código que no existe… no quiero que me deje eso así, ya que
   * retrasa el escaneo"). Arriba de la pantalla no se veía mientras se escanea.
   */
  readonly avisoLector = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  /** El botón de ticket del aviso: un abono o un anticipo recién registrado (2026-10-15). */
  readonly ticketAviso = new TicketDelAviso(this.mensaje);
  readonly ticket = signal<{
    pedido: Pedido;
    cambio: number;
    /** Lo que pagó hoy y lo que se le fió: una venta mixta lleva las dos cosas. */
    pagadoHoy: number;
    fiado: number;
    /** Lo que pagó con su saldo a favor (2026-10-13). */
    saldoUsado?: number;
  } | null>(null);

  cajaSel: number | '' = '';

  // Búsqueda de variantes
  qVar = '';
  /** El campo del lector: la pistola escribe el código ahí y manda Enter. */
  private readonly lector = viewChild<ElementRef<HTMLInputElement>>('lector');
  resultados = signal<(HiloAPesar & { producto_id: number })[]>([]);

  /**
   * La búsqueda agrupada por HILO: el paquete y el cono del mismo hilo juntos,
   * cada uno con lo que hay en el almacén de esta caja. Así se ve de un golpe si
   * hay conos que vender o si primero hay que bajarlos a mostrador.
   */
  readonly hilosEncontrados = computed<HiloEncontrado[]>(() => {
    const porHilo = new Map<number, HiloEncontrado>();
    for (const r of this.resultados()) {
      const h = porHilo.get(r.producto_id) ?? { producto_id: r.producto_id, nombre: r.producto, filas: [], sinConos: false };
      h.filas.push(r);
      porHilo.set(r.producto_id, h);
    }
    const orden = (t?: string | null) => (t === 'paquete' ? 0 : t === 'cono' ? 1 : 2);
    for (const h of porHilo.values()) {
      h.filas.sort((a, b) => orden(a.tipo) - orden(b.tipo));
      h.sinConos = h.filas.some((f) => f.tipo === 'paquete') && !h.filas.some((f) => f.tipo === 'cono');
    }
    return [...porHilo.values()];
  });

  /** La presentación que se está pesando (abre la ventana de la báscula). */
  readonly pesando = signal<HiloAPesar | null>(null);

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
  /** El método de pago; 'mixto' = parte por transferencia y el resto en efectivo (2026-10-14). */
  metodoSel: number | '' | 'mixto' = '';
  montoPago: number | null = null;
  /** Con 'mixto': lo que paga por transferencia. */
  montoTransferencia: number | null = null;

  // ---- Abono a la cuenta del cliente, sin salir de la venta ----
  readonly abonando = signal(false);
  /** "Recibir anticipo": el cliente deja dinero a cuenta, sin nota (2026-10-14). */
  readonly recibiendoAnticipo = signal(false);
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
      const pedido = this.modo() === 'espera';
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
          ...(pedido ? { encargo: true, metodo_entrega: 'recoger' as const } : {}),
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

    // En cuanto hay turno abierto (al entrar o al cambiar de caja), el lector
    // queda listo para escanear.
    effect(() => {
      if (this.sesion()) this.enfocarLector();
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
    this.avisoLector.set(null);
    this.inv.resolverCodigo(q).subscribe({
      next: (r) => this.agregarPorCodigo(r),
      // 404 = no es un código registrado. Si lo que llegó tiene forma de código
      // de barras, es una etiqueta que no está en el sistema: se avisa y el campo
      // se vacía para el siguiente (antes se buscaba como texto, no salía nada y
      // el número se quedaba ahí: el siguiente escaneo se pegaba a él). Si es
      // texto ("rojo 2/30"), se busca.
      error: (e) => {
        if (!pareceCodigo(q)) {
          this.buscar();
          return;
        }
        const noExiste = (e as { status?: number })?.status === 404;
        this.avisarLector(
          noExiste
            ? `El código ${q} no está registrado. Revisa la etiqueta o escanea otro.`
            : `No se pudo revisar el código ${q}. Vuelve a escanearlo.`
        );
      },
    });
  }

  /**
   * Avisa debajo del lector y lo deja vacío y con el cursor, listo para el
   * siguiente escaneo: un código que no sirvió no se queda pegado al siguiente.
   */
  private avisarLector(texto: string): void {
    this.avisoLector.set(texto);
    this.qVar = '';
    this.resultados.set([]);
    this.enfocarLector();
  }

  /** Mete al carrito lo que resolvió el lector. */
  private agregarPorCodigo(r: CodigoResuelto): void {
    const v = r.variante;

    // Un bulto ya vendido o desarmado no existe físicamente: no se vuelve a
    // vender. El backend también lo rechaza; esto es para avisar antes de que
    // el cajero cierre el ticket.
    if (r.bulto && r.bulto.estado && r.bulto.estado !== 'disponible') {
      // Apartado = es de un pedido o un apartado de otro cliente, o va en un
      // envío a sucursal que se está surtiendo: sigue aquí, pero ya tiene dueño.
      const folio = r.bulto.consumido_folio;
      const deQue = folio?.startsWith('TRA') ? 'va en un envío a sucursal' : 'es de un pedido';
      this.avisarLector(
        r.bulto.estado === 'apartado'
          ? `El paquete ${r.bulto.codigo} está apartado${folio ? ' para ' + folio : ''}: ${deQue}. Escanea otro.`
          : `El bulto ${r.bulto.codigo} ya está ${r.bulto.estado}${folio ? ' en ' + folio : ''}. Escanea otro.`
      );
      return;
    }

    // Solo se venden los paquetes de ESTA tienda (2026-10-07): si el sistema lo
    // tiene en otro almacén o viene en camino, se pide otro.
    const caja = this.cajaActual();
    const fuera = r.bulto ? paqueteFueraDeAqui(r.bulto, caja?.almacen_id, caja?.almacen) : null;
    if (fuera) {
      this.avisarLector(fuera);
      return;
    }

    const peso = r.bulto?.peso_kg != null ? Number(r.bulto.peso_kg) : null;

    // El código de una PRESENTACIÓN no es un paquete físico: se enseña el hilo
    // con sus opciones (por kilo, conos) en vez de meter algo a ciegas. Pasa al
    // escribir el color: "rojo" es también el código del paquete ROJO, y antes
    // eso metía 1 kg sin preguntar (2026-10-06).
    if (!r.bulto || !peso || peso <= 0) {
      this.buscar();
      return;
    }

    if (Number(v.precio_oferta ?? v.precio) <= 0) {
      this.avisarLector(this.textoSinPrecio(this.nombreHilo(v)));
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
            tipo: v.tipo_presentacion,
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
      this.avisarLector(`El bulto ${bulto.codigo} ya está en el ticket; no se cobra dos veces.`);
      return;
    } else {
      // Empezó otra venta: el ticket de la anterior ya no aplica.
      this.ticket.set(null);
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
    this.error.set(this.textoSinPrecio(nombre));
    return true;
  }

  private textoSinPrecio(nombre: string): string {
    return `«${nombre}» todavía no tiene precio, así que no se puede vender. Se le pone en Productos.`;
  }

  private round3(n: number): number {
    return Math.round((n + Number.EPSILON) * 1000) / 1000;
  }

  buscar(): void {
    const q = this.qVar.trim();
    if (!q) return;
    // Con el almacén de la caja: cada presentación dice cuánto hay AQUÍ.
    this.inv.buscarVariantes(q, this.cajaActual()?.almacen_id).subscribe({
      next: (vs) => {
        const encontrados = vs
            .filter((v) => v.activo !== false && (v.activo as unknown) !== 0)
            .map((v) => ({
              id: v.id,
              producto_id: v.producto_id,
              sku: v.sku,
              producto: this.nombreHilo(v),
              presentacion: v.presentacion,
              tipo: v.tipo_presentacion,
              precio: Number(v.precio_oferta ?? v.precio),
              unidad: v.unidad,
              aqui: v.aqui,
            }));
        this.resultados.set(encontrados);
        // Sin nada que enseñar, se dice; lo escrito se queda seleccionado para
        // corregirlo o para que el siguiente escaneo lo reemplace.
        if (encontrados.length === 0) {
          this.avisoLector.set(`No encontré ningún hilo con «${q}». Revisa cómo se escribió o escanea el paquete.`);
          this.enfocarLector();
        }
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  /** Cómo se lee lo que hay en esta tienda de una presentación de la búsqueda. */
  hayAqui(r: HiloAPesar): string {
    const a = r.aqui;
    if (!a) return '';
    const kg = Number(a.cantidad);
    if (kg <= 0) return 'no hay aquí';
    const kilos = `${kg.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`;
    if (r.tipo === 'cono') return `${kilos} enconados`;
    if (a.paquetes) return `${a.paquetes.toLocaleString('es-MX')} ${a.paquetes === 1 ? 'paquete' : 'paquetes'} · ${kilos}`;
    return kilos;
  }

  /**
   * El hilo con su calibre: ROJO 1/30 y ROJO 2/30 son dos productos, y con el
   * color solo el carrito y el ticket no dicen cuál se está vendiendo.
   */
  private nombreHilo(v: { producto?: string | null; calibre?: string | null }): string {
    return `${v.producto ?? ''}${v.calibre ? ' ' + v.calibre : ''}`;
  }

  /**
   * Agregar sin escanear un paquete = PESAR. Abre la báscula: se teclea lo que
   * marcó y, si son conos, cuántos eran (2026-10-06: "vengo por 6 conos"). Antes
   * metía 1 kg y había que corregirlo en el carrito.
   */
  agregar(r: HiloAPesar): void {
    if (this.sinPrecio(r.producto, r.precio)) return;
    this.pesando.set(r);
  }

  /** La báscula se cerró sin pesar: el lector queda listo otra vez. */
  cerrarBascula(): void {
    this.pesando.set(null);
    this.enfocarLector();
  }

  /** La báscula dio su peso: la línea se agrega, o se le suman los kilos y los conos. */
  alPesar(r: HiloAPesar, e: { kg: number; piezas?: number }): void {
    this.pesando.set(null);
    this.ticket.set(null);
    this.enfocarLector();
    this.carrito.update((arr) => {
      const existe = arr.find((i) => i.variante_id === r.id);
      if (existe) {
        return arr.map((i) =>
          i.variante_id === r.id
            ? {
                ...i,
                cantidad: this.round3(i.cantidad + e.kg),
                piezas: e.piezas || i.piezas ? (i.piezas ?? 0) + (e.piezas ?? 0) : undefined,
              }
            : i
        );
      }
      return [
        ...arr,
        {
          variante_id: r.id,
          sku: r.sku,
          producto: r.producto,
          presentacion: r.presentacion,
          tipo: r.tipo,
          precio: r.precio,
          unidad: r.unidad,
          cantidad: e.kg,
          piezas: e.piezas,
        },
      ];
    });
    const conos = e.piezas ? ` (${e.piezas} ${e.piezas === 1 ? 'cono' : 'conos'})` : '';
    this.mensaje.set(`${r.producto}: ${e.kg.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg${conos} al carrito.`);
  }

  /** Cómo se lee la línea del carrito que no lleva paquetes escaneados. */
  comoSeVende(i: ItemCarrito): string {
    if (i.tipo === 'cono') {
      return i.piezas ? `${i.piezas} ${i.piezas === 1 ? 'cono' : 'conos'} · pesados` : 'conos, por kilo';
    }
    return 'por kilo';
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
    this.enfocarLector();
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
    this.enfocarLector();
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
    this.enfocarLector();
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
    this.usarSaldo = false;
    this.saldoAUsar = null;
    this.resultadosCliente.set([]);
    this.qCliente = '';
    // Sin lista propia se cobra al público, aunque antes se hubiera elegido otra.
    this.tipoClienteSel.set(c.tipo_cliente_id ?? this.publicoId);
    this.error.set(null);
    this.cargarApartadoCliente(c.id);
    this.enfocarLector();
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
          saldo_favor: c.saldo_favor ?? 0,
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
    };
    this.resultadosCliente.set([]);
    this.error.set(null);
    this.creandoCliente.set(true);
  }

  cerrarAltaCliente(): void {
    this.creandoCliente.set(false);
    this.enfocarLector();
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
          this.enfocarLector();
          this.mensaje.set(
            `${c.nombre}${c.codigo ? ' (' + c.codigo + ')' : ''} quedó registrado. Todavía sin crédito: ` +
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
    this.usarSaldo = false;
    this.saldoAUsar = null;
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
    if (!c) return 'Para vender a crédito, primero elige al cliente.';
    if (Number(c.limite_credito) <= 0) return `${c.nombre_comercial || c.nombre} no tiene crédito autorizado.`;
    if (this.creditoDisponible() <= 0) {
      return `Ya llegó a su límite de crédito (${this.dinero(c.limite_credito)}). Tiene que abonar antes de que se le pueda dar más a crédito.`;
    }
    return null;
  }

  /** Una nota en espera exige saber de quién es (y a quién llamarle). */
  motivoSinEspera(): string | null {
    return this.clienteSel() ? null : 'Para guardar una nota en espera, primero elige al cliente.';
  }

  /** Una nota pendiente de pago también: hay que saber a quién cobrarle después. */
  motivoSinPendiente(): string | null {
    return this.clienteSel() ? null : 'Para dar una nota pendiente de pago, primero elige al cliente.';
  }

  elegirModo(m: ModoVenta): void {
    if (m === 'credito' && (!this.puedeFiar() || this.motivoSinFiar())) return;
    if (m === 'espera' && this.motivoSinEspera()) return;
    if (m === 'pendiente' && this.motivoSinPendiente()) return;
    if (m === 'espera' && this.modo() !== 'espera') {
      this.paraCuando = '';
      this.notasPedido = '';
    }
    // Lo que deja una nota en espera va con un solo método.
    if (m === 'espera' && this.metodoSel === 'mixto') this.metodoSel = this.idEfectivo() ?? '';
    this.modo.set(m);
    this.aCredito = null;
    // Sin propuesta de anticipo: lo que deje es decisión del cliente, y poner
    // una cifra por omisión invitaría a cobrarle eso sin preguntarle.
    this.anticipo = null;
  }

  // Los nombres de antes, para que se lea igual que la pantalla.
  abrirCredito(): void { this.elegirModo('credito'); }
  cerrarCredito(): void { if (this.fiando()) this.elegirModo('cobrar'); }

  /** Lo que se le propone fiar si no teclea nada: todo lo que le alcance (después de su saldo a favor). */
  propuestaCredito(): number {
    return Math.max(0, Math.min(this.total() - this.saldoActual(), this.creditoDisponible()));
  }

  // ---- SALDO A FAVOR (2026-10-13): lo que le quedó de una devolución ----
  //
  // "A veces el cliente pide que su saldo a favor se utilice para otras compras
  // y dejar su crédito como está" (usuario). Se ofrece al cobrar o a crédito,
  // con un cliente que tenga; el servidor lo valida y lo descuenta de su libro.

  /** ¿Usa su saldo a favor en esta compra? (casilla) */
  usarSaldo = false;
  /** Cuánto de su saldo; vacío = todo lo que alcance. */
  saldoAUsar: number | null = null;

  saldoFavorCliente(): number {
    return Math.max(0, Number(this.clienteSel()?.saldo_favor ?? 0));
  }

  /** Se ofrece al cobrar o a crédito, si el cliente tiene saldo a favor. */
  ofreceSaldo(): boolean {
    return (this.modo() === 'cobrar' || this.modo() === 'credito') && this.saldoFavorCliente() > 0.004;
  }

  /** Lo que se le propone usar: todo lo que alcance, sin pasar del total. */
  propuestaSaldo(): number {
    return Math.round(Math.min(this.saldoFavorCliente(), this.total()) * 100) / 100;
  }

  /** Lo que se va a usar de su saldo. Método: lee ngModel. */
  saldoActual(): number {
    if (!this.usarSaldo || !this.ofreceSaldo()) return 0;
    const v = this.saldoAUsar == null || (this.saldoAUsar as unknown) === ''
      ? this.propuestaSaldo()
      : Number(this.saldoAUsar);
    return Math.max(0, Math.round(v * 100) / 100);
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

  /** Lo que el cliente tiene que poner hoy: el total menos lo que se le fía y su saldo a favor. Método: lee ngModel. */
  aPagarHoy(): number {
    return Math.max(0, Math.round((this.total() - this.fiadoActual() - this.saldoActual()) * 100) / 100);
  }

  /** El texto del botón grande: dice exactamente lo que va a pasar. */
  textoBoton(): string {
    if (this.pidiendo()) {
      const a = Number(this.anticipo ?? 0);
      return a > 0 ? `Guardar nota en espera · deja ${this.dinero(a)}` : 'Guardar nota en espera';
    }
    if (this.notaPendiente()) {
      return `Dar nota pendiente de pago · ${this.dinero(this.total())}`;
    }
    if (this.fiando()) {
      return this.aPagarHoy() > 0
        ? `Cobrar ${this.dinero(this.aPagarHoy())} y el resto a crédito`
        : 'Dar a crédito';
    }
    const saldo = this.saldoActual();
    if (saldo > 0) {
      return this.aPagarHoy() > 0
        ? `Cobrar ${this.dinero(this.aPagarHoy())} y ${this.dinero(saldo)} de su saldo a favor`
        : `Pagar con su saldo a favor · ${this.dinero(saldo)}`;
    }
    return `Cobrar ${this.dinero(this.total())}`;
  }

  cobrar(): void {
    const s = this.sesion();
    if (!s || this.carrito().length === 0) {
      this.error.set('Agrega productos para poder cobrar.');
      return;
    }
    // --- Nota en espera: se aparta la mercancía; lo que falte se cobra al entregar ---
    if (this.pidiendo()) {
      if (!this.clienteSel()) {
        this.error.set('Para guardar una nota en espera hay que decir de quién es: busca al cliente arriba.');
        return;
      }
      const deja = Number(this.anticipo ?? 0);
      if (deja > this.total() + 0.001) {
        this.error.set(`Lo que deja (${this.dinero(deja)}) es más que la nota (${this.dinero(this.total())}).`);
        return;
      }
      if (deja > 0 && !this.metodoSel) {
        this.error.set('Elige con qué deja el pago.');
        return;
      }
      this.error.set(null);
      this.tomarPedido(s, deja);
      return;
    }

    // --- Nota pendiente de pago: se lleva la mercancía; el pago, después ---
    if (this.notaPendiente()) {
      if (!this.clienteSel()) {
        this.error.set('Para dar una nota pendiente de pago hay que decir de quién es: busca al cliente arriba.');
        return;
      }
      this.error.set(null);
      this.darNotaPendiente(s);
      return;
    }

    const fiado = this.fiadoActual();
    if (fiado > 0 && !this.clienteSel()) {
      this.error.set('Para vender a crédito hay que decir a quién: busca al cliente arriba.');
      return;
    }
    if (fiado > this.creditoDisponible() + 0.001) {
      this.error.set(`Solo le quedan ${this.dinero(this.creditoDisponible())} de crédito.`);
      return;
    }
    const saldo = this.saldoActual();
    if (saldo > this.saldoFavorCliente() + 0.001) {
      this.error.set(`Solo tiene ${this.dinero(this.saldoFavorCliente())} a favor.`);
      return;
    }
    if (saldo + fiado > this.total() + 0.001) {
      this.error.set(`Su saldo a favor${fiado > 0 ? ' más lo que va a crédito' : ''} pasa del total (${this.dinero(this.total())}).`);
      return;
    }
    // Con la venta completa a crédito no hace falta método de pago: no entra
    // dinero. Si paga algo hoy, sí.
    if (this.aPagarHoy() > 0 && !this.metodoSel) {
      this.error.set('Elige con qué está pagando lo de hoy.');
      return;
    }
    const aPagar = this.aPagarHoy();
    // Con transferencia se cobra justo. En efectivo, lo que el cliente entrega;
    // vacío quiere decir que pagó con el importe exacto. Con 'mixto', la
    // transferencia y el resto en efectivo (solo el efectivo da cambio).
    const transf = this.parteTransferencia();
    if (this.esMixto() && aPagar > 0) {
      if (!(transf > 0)) {
        this.error.set('Pon cuánto paga por transferencia.');
        return;
      }
      if (transf > aPagar + 0.001) {
        this.error.set(`Por transferencia son a lo más ${this.dinero(aPagar)}: la transferencia no da cambio.`);
        return;
      }
    }
    const enEfectivo = this.aCobrarEnEfectivo();
    const recibido = this.esEfectivoSel() ? Number(this.montoPago ?? enEfectivo) : enEfectivo;
    if (enEfectivo > 0 && recibido + 0.001 < enEfectivo) {
      this.error.set(
        `Faltan ${this.dinero(enEfectivo - recibido)}: recibió ${this.dinero(recibido)} en efectivo y son ${this.dinero(enEfectivo)}.`
      );
      return;
    }
    this.error.set(null);
    const pagos = aPagar <= 0
      ? undefined
      : this.esMixto()
        ? [
            { metodo_pago_id: Number(this.idTransferencia()), monto: transf },
            ...(recibido > 0 ? [{ metodo_pago_id: Number(this.idEfectivo()), monto: recibido }] : []),
          ]
        : [{ metodo_pago_id: Number(this.metodoSel), monto: recibido }];

    this.ventas
      .crearPedido({
        canal: 'punto_venta',
        sesion_caja_id: s.id,
        tipo_cliente_id: this.tipoClienteSel() ? Number(this.tipoClienteSel()) : undefined,
        // Si se identificó al cliente, la venta queda en su historial.
        cliente_id: this.clienteSel()?.id,
        a_credito: fiado > 0 ? fiado : undefined,
        saldo_favor: saldo > 0 ? saldo : undefined,
        items: this.carrito().map((i) => ({
          variante_id: i.variante_id,
          cantidad: i.cantidad,
          // Va el rastro de los bultos escaneados, si hubo.
          bultos: i.bultos?.length ? i.bultos : undefined,
          // Cuántos conos eran: la venta lo dice ("6 conos"); se cobran los kilos.
          piezas: i.piezas || undefined,
        })),
        // Sin nada que pagar hoy (todo a crédito) no se manda pago alguno. Se
        // manda lo RECIBIDO: el servidor asienta lo cobrado y devuelve el cambio.
        pagos,
      })
      .subscribe({
        next: (pedido) => {
          // El cambio lo calcula el servidor contra el total con que de verdad
          // se cobró; el de la pantalla pudo ser el estimado.
          const cambio = Number(pedido.cambio ?? Math.max(0, recibido - enEfectivo));
          this.ticket.set({
            pedido,
            cambio,
            pagadoHoy: Math.round((Number(pedido.total) - fiado - saldo) * 100) / 100,
            fiado,
            saldoUsado: saldo,
          });
          this.limpiarVenta();
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  /** Deja la caja lista para el siguiente cliente, con el lector esperando. */
  private limpiarVenta(): void {
    this.carrito.set([]);
    this.montoPago = null;
    this.montoTransferencia = null;
    // Parte y parte es de esa venta: la siguiente arranca en efectivo.
    if (this.metodoSel === 'mixto') this.metodoSel = this.idEfectivo() ?? '';
    this.qVar = '';
    this.resultados.set([]);
    this.mensaje.set(null);
    this.quitarCliente();
    this.enfocarLector();
  }

  /** ¿El método elegido lleva efectivo (efectivo, o parte y parte)? Solo el efectivo da cambio. */
  esEfectivoSel(): boolean {
    if (this.esMixto()) return true;
    const m = this.metodos().find((x) => x.id === Number(this.metodoSel));
    return !!m && m.nombre.toLowerCase().includes('efectivo');
  }

  private idDe(palabra: string): number | null {
    return this.metodos().find((x) => x.nombre.toLowerCase().includes(palabra))?.id ?? null;
  }

  idEfectivo(): number | null {
    return this.idDe('efectivo');
  }

  idTransferencia(): number | null {
    return this.idDe('transferencia');
  }

  /** Se ofrece "Efectivo y transferencia" si existen los dos métodos (2026-10-14). */
  permiteMixto(): boolean {
    return !!this.idEfectivo() && !!this.idTransferencia();
  }

  esMixto(): boolean {
    return this.metodoSel === 'mixto';
  }

  /** Con parte y parte, lo que paga por transferencia. Método: lee ngModel. */
  parteTransferencia(): number {
    if (!this.esMixto()) return 0;
    const v = Number(this.montoTransferencia);
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
  }

  /** Lo que se cobra en efectivo hoy: todo, o lo que no cubre la transferencia. */
  aCobrarEnEfectivo(): number {
    return Math.max(0, Math.round((this.aPagarHoy() - this.parteTransferencia()) * 100) / 100);
  }

  /** El cambio que se va a dar, mientras se teclea. Método: lee ngModel. */
  cambioPrevio(): number {
    if (!this.esEfectivoSel() || this.montoPago == null) return 0;
    return Math.max(0, Math.round((Number(this.montoPago) - this.aCobrarEnEfectivo()) * 100) / 100);
  }

  /** Lo que falta si lo recibido no alcanza. Método: lee ngModel. */
  faltaPrevio(): number {
    if (!this.esEfectivoSel() || this.montoPago == null) return 0;
    return Math.max(0, Math.round((this.aCobrarEnEfectivo() - Number(this.montoPago)) * 100) / 100);
  }

  readonly imprimiendo = signal(false);

  /**
   * El ticket de lo que se acaba de cobrar (`shared/ticket/ticket.ts`). Se pide
   * la venta completa —con sus artículos y paquetes— y se le pasa el cambio,
   * que no se guarda.
   */
  imprimirTicket(): void {
    const t = this.ticket();
    if (!t) return;
    this.imprimiendo.set(true);
    this.tickets.imprimir(t.pedido.id, { cambio: t.cambio }).subscribe({
      next: () => {
        this.imprimiendo.set(false);
        this.enfocarLector();
      },
      error: (e) => {
        this.imprimiendo.set(false);
        // Una nota en espera no lleva ticket: el motivo viene en el Error.
        this.error.set(e instanceof Error ? e.message : `No se pudo armar el ticket: ${this.msg(e)}`);
      },
    });
  }

  nuevaVenta(): void {
    this.ticket.set(null);
    this.enfocarLector();
  }

  /** Nombre del tipo elegido, para rotular el carrito. */
  nombreTipoCliente(): string {
    return this.tiposCliente().find((t) => t.id === Number(this.tipoClienteSel()))?.nombre ?? '';
  }

  /**
   * Guarda la NOTA EN ESPERA: la mercancía se aparta (no sale todavía) y entra
   * solo lo que deje pagado. Se sigue en la pantalla Notas en espera, donde se
   * modifica y se entrega cobrando lo que falte. Los paquetes escaneados van
   * ligados a la nota y quedan APARTADOS para ella (pasan a vendidos al
   * entregarla). Ya no hay chofer: el cliente pasa por ella (2026-10-13).
   */
  private tomarPedido(s: SesionCaja, deja: number): void {
    this.ventas
      .crearPedido({
        canal: 'punto_venta',
        sesion_caja_id: s.id,
        cliente_id: this.clienteSel()!.id,
        tipo_cliente_id: this.tipoClienteSel() ? Number(this.tipoClienteSel()) : undefined,
        encargo: true,
        metodo_entrega: 'recoger',
        entrega_para: this.paraCuando || undefined,
        notas: this.notasPedido.trim() || undefined,
        items: this.carrito().map((i) => ({
          variante_id: i.variante_id,
          cantidad: i.cantidad,
          bultos: i.bultos?.length ? i.bultos : undefined,
          piezas: i.piezas || undefined,
        })),
        pagos: deja > 0 ? [{ metodo_pago_id: Number(this.metodoSel), monto: deja }] : undefined,
      })
      .subscribe({
        next: (pedido) => {
          this.ticket.set({ pedido, cambio: 0, pagadoHoy: deja, fiado: 0 });
          this.limpiarVenta();
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  /** "lo recoge en la tienda" o "lo lleva el chofer a …", para el ticket. */
  entregaDe(p: Pedido): string {
    return p.metodo_entrega === 'envio'
      ? `lo lleva el chofer${p.entrega_direccion ? ' a ' + p.entrega_direccion : ''}`
      : 'pasa por él a la tienda';
  }

  /**
   * Da la NOTA PENDIENTE DE PAGO: la mercancía sale (y sus paquetes quedan
   * vendidos), sale el ticket y no se cobra nada; el pago se registra después en
   * Notas pendientes de pago. No entra nada al cajón ni se carga a su crédito.
   */
  private darNotaPendiente(s: SesionCaja): void {
    this.ventas
      .crearPedido({
        canal: 'punto_venta',
        sesion_caja_id: s.id,
        cliente_id: this.clienteSel()!.id,
        tipo_cliente_id: this.tipoClienteSel() ? Number(this.tipoClienteSel()) : undefined,
        pendiente_pago: true,
        items: this.carrito().map((i) => ({
          variante_id: i.variante_id,
          cantidad: i.cantidad,
          bultos: i.bultos?.length ? i.bultos : undefined,
          piezas: i.piezas || undefined,
        })),
      })
      .subscribe({
        next: (pedido) => {
          this.ticket.set({ pedido, cambio: 0, pagadoHoy: 0, fiado: 0 });
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
  cerrarAnticipo(): void {
    this.recibiendoAnticipo.set(false);
    this.enfocarLector();
  }

  /** Dejó dinero a cuenta: su saldo a favor sube y ya lo puede usar en esta venta. */
  anticipoRegistrado(r: { total: number; saldo_favor: number; movimiento_id: number }): void {
    const c = this.clienteSel();
    if (c) this.clienteSel.set({ ...c, saldo_favor: r.saldo_favor });
    const texto = `Anticipo de ${this.dinero(r.total)} registrado. Le quedan ${this.dinero(r.saldo_favor)} a favor.`;
    this.mensaje.set(texto);
    if (c) this.ticketAviso.poner(texto, 'Imprimir ticket del anticipo', () => this.imprimirCuenta(this.tickets.imprimirAnticipo(c.id, r.movimiento_id)));
    this.cerrarAnticipo();
  }

  /** Imprime un ticket de la cuenta del cliente (abono o anticipo); si falla, lo dice. */
  private imprimirCuenta(imprimir: Observable<void>): void {
    imprimir.subscribe({ error: (e) => this.error.set(this.msg(e)) });
  }

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
    this.enfocarLector();
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
          this.enfocarLector();
          const saldo = Number(r.saldo_nuevo);
          const limite = Number(c.limite_credito);
          this.clienteSel.set({
            ...c,
            saldo,
            credito_disponible: Math.max(0, Math.round((limite - saldo) * 100) / 100),
          });
          const texto = saldo > 0
            ? `Abono de ${this.dinero(monto)} registrado. Todavía debe ${this.dinero(saldo)}.`
            : `Abono de ${this.dinero(monto)} registrado. Ya no debe nada.`;
          this.mensaje.set(texto);
          this.ticketAviso.poner(texto, 'Imprimir ticket del abono',
            () => this.imprimirCuenta(this.tickets.imprimirAbonoCuenta(c.id, r.movimiento_id)));
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

  // ------------------------------------------------- el cursor en el lector

  /**
   * EL CURSOR VUELVE AL LECTOR (2026-10-13, auditoría). La pistola escribe donde
   * esté el cursor, y al abrir la caja no estaba en ningún campo; después de
   * cobrar o de pesar se quedaba en un botón: el código escaneado se perdía y el
   * Enter de la pistola apretaba ese botón. Se llama al abrir, al terminar cada
   * venta, al cerrar cada ventana y al quitar algo del carrito.
   *
   * No le quita el cursor a otro campo donde se esté escribiendo (el cliente,
   * lo recibido), salvo con `forzar` (el Enter en los kilos de una línea). En
   * pantalla táctil no lo pone: abriría el teclado encima de la caja. Lo que
   * ya estaba escrito queda seleccionado, para que el siguiente código lo
   * reemplace en vez de pegarse detrás.
   *
   * Espera a que la pantalla se vuelva a dibujar: con `eventCoalescing` la
   * ventana que se cerró sigue ahí un instante, y un `setTimeout` llegaba antes
   * y veía la ventana todavía abierta (pasó con la báscula).
   */
  enfocarLector(forzar = false): void {
    afterNextRender(() => {
      const campo = this.lector()?.nativeElement;
      if (!campo || campo.disabled || document.querySelector('[aria-modal="true"]')) return;
      if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return;
      const activo = document.activeElement;
      if (!forzar && activo !== campo && esCampoDeTexto(activo)) return;
      campo.focus();
      campo.select();
    }, { injector: this.injector });
  }

  /**
   * La red por si el cursor se fue a otro lado: si se teclea una letra o un
   * número con el cursor en un botón, en el menú o en ningún lado, esa primera
   * tecla lleva el cursor al lector y el código entra COMPLETO ahí (las demás
   * teclas ya caen en el campo). Así el Enter de la pistola busca el código en
   * vez de apretar el botón donde se quedó el cursor.
   *
   * No se mete con un campo donde se está escribiendo, con una ventana abierta,
   * con la barra espaciadora (aprieta botones) ni con atajos (Ctrl, Alt). En un
   * selector, solo los números: las letras eligen una opción del selector.
   */
  alTeclear(e: KeyboardEvent): void {
    if (e.key.length !== 1 || e.key === ' ' || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    const campo = this.lector()?.nativeElement;
    const activo = document.activeElement;
    if (!campo || campo.disabled || activo === campo || esCampoDeTexto(activo)) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    if (activo instanceof HTMLSelectElement && !/^[0-9]$/.test(e.key)) return;
    campo.focus();
    campo.select();
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

/**
 * ¿Lo que llegó al lector tiene forma de código de barras? Seis o más letras,
 * números o guiones, sin espacios, con al menos cuatro números ("00621999",
 * "TMPVV-PAQ-12"). Un color o un calibre ("rojo", "rojo 2/30") no la tiene y
 * se busca como texto.
 */
export function pareceCodigo(q: string): boolean {
  return /^[A-Za-z0-9-]{6,}$/.test(q) && (q.match(/\d/g)?.length ?? 0) >= 4;
}
