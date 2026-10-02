import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CartService } from '../../core/services/cart.service';
import { VentasService } from '../../core/services/ventas.service';
import { TiendaService } from '../../core/services/tienda.service';
import { TokenService } from '../../core/services/token.service';
import { AuthService } from '../../core/services/auth.service';
import { MetodoPago, Pedido } from '../../core/models/ventas.models';
import {
  ConfiguracionTienda,
  Cotizacion,
  Direccion,
  DireccionInput,
  MetodoEntrega,
} from '../../core/models/tienda.models';
import { ApiError } from '../../core/models/auth.models';
import { CantidadPipe } from '../../shared/cantidad.pipe';
import { DineroPipe } from '../../shared/dinero.pipe';

/** Campos vacíos de una dirección nueva. */
function direccionVacia(): DireccionInput {
  return {
    tipo: 'envio',
    nombre_receptor: '',
    calle: '',
    numero_ext: '',
    numero_int: '',
    colonia: '',
    ciudad: '',
    estado: '',
    codigo_postal: '',
    pais: 'México',
    telefono: '',
    referencias: '',
  };
}

/**
 * Checkout de la tienda en línea.
 *
 * Tres decisiones y un resumen: cómo se entrega, cómo se paga y qué cupón lleva.
 * El total NUNCA se calcula aquí: cada vez que cambia algo que lo mueve se le
 * pide al backend con `POST /pedidos/cotizacion`, que usa la misma lógica que la
 * venta. Así lo que el cliente ve es lo que se le cobra.
 *
 * No se cobra en línea: el pedido queda 'pendiente' y el cliente paga por
 * transferencia o en efectivo al recoger. Lo confirma un administrador.
 */
@Component({
  selector: 'app-checkout',
  imports: [RouterLink, FormsModule, CantidadPipe, DineroPipe],
  templateUrl: './checkout.html',
})
export class Checkout implements OnInit {
  readonly cart = inject(CartService);
  private readonly ventas = inject(VentasService);
  private readonly tienda = inject(TiendaService);
  private readonly tokens = inject(TokenService);
  private readonly auth = inject(AuthService);

  readonly esCliente = computed(() => this.tokens.tipo() === 'cliente');
  readonly sesion = this.auth.sesion;

  readonly cargando = signal(true);
  readonly procesando = signal(false);
  readonly error = signal<string | null>(null);
  readonly pedido = signal<Pedido | null>(null);

  readonly config = signal<ConfiguracionTienda>({});
  readonly metodosPago = signal<MetodoPago[]>([]);
  readonly direcciones = signal<Direccion[]>([]);

  // --- Lo que elige el cliente ---
  readonly entrega = signal<MetodoEntrega>('recoger');
  readonly direccionId = signal<number | null>(null);
  readonly metodoPagoId = signal<number | null>(null);
  /** El cupón se aplica al cotizar, no al teclear: cada intento sería una llamada. */
  cuponTecleado = '';
  readonly cuponAplicado = signal<string | null>(null);

  // --- Lo que responde el backend ---
  readonly cotizacion = signal<Cotizacion | null>(null);
  readonly errorCupon = signal<string | null>(null);

  // --- Formulario de dirección nueva ---
  readonly capturandoDireccion = signal(false);
  readonly guardandoDireccion = signal(false);
  readonly errorDireccion = signal<string | null>(null);
  nueva: DireccionInput = direccionVacia();

  /**
   * Los métodos con los que de verdad se puede pagar en línea: transferencia y
   * efectivo en tienda. La tabla `metodos_pago` trae también tarjeta y las
   * pasarelas, que no están integradas — ofrecerlas sería prometer algo que no
   * existe.
   */
  readonly metodosOfrecidos = computed(() =>
    this.metodosPago().filter((m) => {
      const n = m.nombre.toLowerCase();
      return n.includes('efectivo') || n.includes('transferencia');
    })
  );

  readonly metodoElegido = computed(() =>
    this.metodosPago().find((m) => m.id === this.metodoPagoId()) ?? null
  );

  readonly pagaPorTransferencia = computed(() =>
    (this.metodoElegido()?.nombre ?? '').toLowerCase().includes('transferencia')
  );

  /** Falta algo por decidir antes de poder confirmar. */
  readonly falta = computed(() => {
    if (this.cart.items().length === 0) return 'No hay nada en tu carrito.';
    if (this.entrega() === 'envio' && !this.direccionId()) {
      return 'Elige a qué dirección lo enviamos.';
    }
    if (!this.metodoPagoId()) return 'Elige cómo vas a pagar.';
    if (!this.cotizacion()) return 'Estamos calculando tu total…';
    return null;
  });

  ngOnInit(): void {
    if (!this.esCliente()) {
      this.cargando.set(false);
      return;
    }
    // La configuración y los métodos de pago no dependen de nada; las
    // direcciones deciden con qué opción abre la pantalla.
    this.tienda.configuracion().subscribe({
      next: (c) => this.config.set(c),
      error: () => this.config.set({}),
    });
    this.ventas.metodosPago().subscribe({
      next: (m) => {
        this.metodosPago.set(m);
        // Con una sola forma de pago no hay nada que elegir: se deja puesta.
        const ofrecidos = this.metodosOfrecidos();
        if (ofrecidos.length === 1) this.metodoPagoId.set(ofrecidos[0].id);
      },
      error: () => this.metodosPago.set([]),
    });
    this.tienda.direcciones().subscribe({
      next: (ds) => {
        this.direcciones.set(ds);
        const pred = ds.find((d) => d.es_predeterminada) ?? ds[0];
        if (pred) this.direccionId.set(pred.id);
        this.cargando.set(false);
        this.recotizar();
      },
      error: () => {
        this.direcciones.set([]);
        this.cargando.set(false);
        this.recotizar();
      },
    });
  }

  // ------------------------------------------------------------ decisiones

  elegirEntrega(m: MetodoEntrega): void {
    if (this.entrega() === m) return;
    this.entrega.set(m);
    // Elegir envío sin ninguna dirección capturada abre el formulario solo:
    // es lo único que el cliente puede hacer a continuación.
    if (m === 'envio' && this.direcciones().length === 0) this.capturandoDireccion.set(true);
    this.recotizar();
  }

  elegirDireccion(id: number): void {
    this.direccionId.set(id);
    this.recotizar();
  }

  aplicarCupon(): void {
    const codigo = this.cuponTecleado.trim();
    if (!codigo) return;
    // El aviso del intento anterior se limpia AQUÍ y no al cotizar: si se
    // limpiara con cada cotización buena, el "ese cupón expiró" se borraría
    // solo en el mismo instante en que se recalcula el total sin él, y el
    // cliente no alcanzaría a leer por qué no se le aplicó.
    this.errorCupon.set(null);
    this.cuponAplicado.set(codigo);
    this.recotizar();
  }

  quitarCupon(): void {
    this.cuponAplicado.set(null);
    this.cuponTecleado = '';
    this.errorCupon.set(null);
    this.recotizar();
  }

  /**
   * Le pide al backend el desglose con lo elegido hasta ahora. Se llama cada vez
   * que cambia algo que mueve el total: la entrega, la dirección o el cupón.
   */
  private recotizar(): void {
    if (this.cart.items().length === 0) {
      this.cotizacion.set(null);
      return;
    }
    // Enviar sin dirección da 422 en el backend; aquí todavía no es un error,
    // solo falta decidirlo.
    if (this.entrega() === 'envio' && !this.direccionId()) {
      this.cotizacion.set(null);
      return;
    }

    this.tienda
      .cotizar({
        canal: 'tienda_linea',
        metodo_entrega: this.entrega(),
        direccion_envio_id: this.entrega() === 'envio' ? this.direccionId()! : undefined,
        cupon_codigo: this.cuponAplicado() ?? undefined,
        items: this.cart.items().map((i) => ({ variante_id: i.variante_id, cantidad: i.cantidad })),
      })
      .subscribe({
        next: (c) => {
          this.cotizacion.set(c);
          this.error.set(null);
        },
        error: (e) => {
          const err = (e as { error?: { error?: ApiError } })?.error?.error;
          // Un cupón malo no debe dejar la pantalla sin total: se quita y se
          // vuelve a cotizar sin él, avisando por qué.
          if (err?.code?.startsWith('CUPON_')) {
            this.errorCupon.set(err.message);
            this.cuponAplicado.set(null);
            this.recotizar();
            return;
          }
          this.cotizacion.set(null);
          this.error.set(err?.message ?? 'No pudimos calcular tu total.');
        },
      });
  }

  // ------------------------------------------------------------ direcciones

  abrirCaptura(): void {
    this.nueva = direccionVacia();
    this.errorDireccion.set(null);
    this.capturandoDireccion.set(true);
  }

  cancelarCaptura(): void {
    this.capturandoDireccion.set(false);
    this.errorDireccion.set(null);
  }

  guardarDireccion(): void {
    // El backend exige calle, ciudad, estado y CP; se avisa aquí para no gastar
    // un viaje al servidor en un campo vacío.
    const d = this.nueva;
    if (!d.calle?.trim() || !d.ciudad?.trim() || !d.estado?.trim() || !d.codigo_postal?.trim()) {
      this.errorDireccion.set('Faltan la calle, la ciudad, el estado o el código postal.');
      return;
    }
    this.guardandoDireccion.set(true);
    this.errorDireccion.set(null);
    this.tienda.crearDireccion(d).subscribe({
      next: (creada) => {
        this.direcciones.update((ds) => [creada, ...ds.map((x) => ({ ...x, es_predeterminada: 0 }))]);
        this.direccionId.set(creada.id);
        this.capturandoDireccion.set(false);
        this.guardandoDireccion.set(false);
        this.recotizar();
      },
      error: (e) => {
        const err = (e as { error?: { error?: ApiError } })?.error?.error;
        this.errorDireccion.set(err?.message ?? 'No se pudo guardar la dirección.');
        this.guardandoDireccion.set(false);
      },
    });
  }

  /** Una línea legible con la dirección, para el selector y el resumen. */
  resumirDireccion(d: Direccion): string {
    const numero = [d.numero_ext, d.numero_int && `int. ${d.numero_int}`].filter(Boolean).join(' ');
    return [
      [d.calle, numero].filter(Boolean).join(' '),
      d.colonia,
      d.ciudad,
      d.estado,
      `C.P. ${d.codigo_postal}`,
    ]
      .filter(Boolean)
      .join(', ');
  }

  // ------------------------------------------------------------ confirmar

  confirmar(): void {
    if (this.falta() || this.procesando()) return;
    this.procesando.set(true);
    this.error.set(null);

    this.ventas
      .crearPedido({
        canal: 'tienda_linea',
        metodo_entrega: this.entrega(),
        direccion_envio_id: this.entrega() === 'envio' ? this.direccionId()! : undefined,
        metodo_pago_id: this.metodoPagoId()!,
        cupon_codigo: this.cuponAplicado() ?? undefined,
        items: this.cart.items().map((i) => ({ variante_id: i.variante_id, cantidad: i.cantidad })),
      })
      .subscribe({
        next: (p) => {
          this.pedido.set(p);
          this.cart.vaciar();
          this.procesando.set(false);
        },
        error: (e) => {
          const err = (e as { error?: { error?: ApiError } })?.error?.error;
          this.error.set(err?.message ?? 'No se pudo crear el pedido');
          this.procesando.set(false);
          // El stock pudo cambiar mientras decidía: el total se vuelve a pedir
          // para que la pantalla no siga mostrando uno que ya no aplica.
          this.recotizar();
        },
      });
  }
}
