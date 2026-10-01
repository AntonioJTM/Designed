import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Checkout } from './checkout';
import { CartService } from '../../core/services/cart.service';
import { VentasService, CrearPedidoInput } from '../../core/services/ventas.service';
import { TiendaService } from '../../core/services/tienda.service';
import { TokenService } from '../../core/services/token.service';
import { AuthService } from '../../core/services/auth.service';
import { Cotizacion, Direccion } from '../../core/models/tienda.models';
import { Pedido } from '../../core/models/ventas.models';

/**
 * Lo que importa del checkout:
 *   · el total SIEMPRE viene del backend, nunca se calcula aquí;
 *   · no deja confirmar mientras falte una decisión;
 *   · elegir envío sin ninguna dirección capturada abre el formulario solo;
 *   · un cupón inválido no deja la pantalla sin total;
 *   · solo se ofrecen las formas de pago que de verdad existen.
 */
describe('Checkout', () => {
  const direcciones: Direccion[] = [
    {
      id: 7, cliente_id: 3, tipo: 'envio', calle: 'Av. Hidalgo', numero_ext: '212',
      colonia: 'Centro', ciudad: 'Moroleón', estado: 'Guanajuato', codigo_postal: '38800',
      pais: 'México', telefono: '4451112233', es_predeterminada: 1,
    } as Direccion,
  ];

  function cotizacionDe(costoEnvio: number, descuento = 0): Cotizacion {
    return {
      metodo_entrega: costoEnvio > 0 ? 'envio' : 'recoger',
      direccion_envio_id: costoEnvio > 0 ? 7 : null,
      almacen_id: 1, tipo_cliente_id: 1, lineas: [],
      subtotal: 300, descuento, impuestos: 48, costo_envio: costoEnvio,
      total: 300 - descuento + 48 + costoEnvio, cupon: null,
    };
  }

  let cotizaciones: Omit<CrearPedidoInput, 'pagos'>[] = [];
  let creado: CrearPedidoInput | null = null;
  let direccionesDisponibles: Direccion[] = [];
  /** Códigos de cupón que el backend rechaza. */
  let cuponesMalos: string[] = [];

  const tiendaFalsa = {
    configuracion: () => of({ envio_costo_fijo: '85.50', tienda_direccion: 'Centro 1' }),
    direcciones: () => of(direccionesDisponibles),
    crearDireccion: (d: unknown) =>
      of({ ...(d as object), id: 99, cliente_id: 3, es_predeterminada: 1 } as Direccion),
    cotizar: (body: Omit<CrearPedidoInput, 'pagos'>) => {
      cotizaciones.push(body);
      if (body.cupon_codigo && cuponesMalos.includes(body.cupon_codigo)) {
        return throwError(() => ({
          error: { error: { code: 'CUPON_EXPIRADO', message: 'El cupón ya expiró' } },
        }));
      }
      return of(cotizacionDe(body.metodo_entrega === 'envio' ? 85.5 : 0, body.cupon_codigo ? 30 : 0));
    },
  };

  const ventasFalsas = {
    metodosPago: () =>
      of([
        { id: 1, nombre: 'Efectivo' },
        { id: 2, nombre: 'Tarjeta débito/crédito' },
        { id: 3, nombre: 'Transferencia' },
        { id: 4, nombre: 'PayPal' },
      ]),
    crearPedido: (body: CrearPedidoInput) => {
      creado = body;
      return of({ id: 1, numero_pedido: 'WEB-1', total: '433.50' } as unknown as Pedido);
    },
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [Checkout],
      providers: [
        { provide: TiendaService, useValue: tiendaFalsa },
        { provide: VentasService, useValue: ventasFalsas },
        { provide: TokenService, useValue: { tipo: () => 'cliente' } },
        { provide: AuthService, useValue: { sesion: () => ({ nombre: 'Ana' }) } },
      ],
    }).compileComponents();

    const cart = TestBed.inject(CartService);
    cart.items.set([
      { variante_id: 5, producto: 'NEGRO', sku: 'NEGRO', precio: 100, cantidad: 3, unidad: 'kg' },
    ]);

    const fixture = TestBed.createComponent(Checkout);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    cotizaciones = [];
    creado = null;
    cuponesMalos = [];
    direccionesDisponibles = [...direcciones];
  });
  afterEach(() => TestBed.resetTestingModule());

  it('abre en "recoger", con la dirección predeterminada ya puesta', async () => {
    const c = (await montar()).componentInstance;

    expect(c.entrega()).toBe('recoger');
    expect(c.direccionId()).toBe(7);
    // Cotiza al abrir: el total no se muestra en blanco esperando un clic.
    expect(cotizaciones.length).toBe(1);
    expect(c.cotizacion()?.costo_envio).toBe(0);
  });

  it('el total viene del backend, no de sumar el carrito', async () => {
    const c = (await montar()).componentInstance;

    // El carrito son 3 × 100 = 300, pero el total lleva IVA que solo el
    // servidor conoce.
    expect(c.cart.subtotal()).toBe(300);
    expect(c.cotizacion()?.total).toBe(348);

    c.elegirEntrega('envio');
    expect(c.cotizacion()?.costo_envio).toBe(85.5);
    expect(c.cotizacion()?.total).toBe(433.5);
  });

  it('solo ofrece transferencia y efectivo, no las pasarelas sin integrar', async () => {
    const c = (await montar()).componentInstance;

    const nombres = c.metodosOfrecidos().map((m) => m.nombre);
    expect(nombres).toEqual(['Efectivo', 'Transferencia']);
    expect(nombres).not.toContain('PayPal');
  });

  it('no deja confirmar mientras falte elegir cómo se paga', async () => {
    const c = (await montar()).componentInstance;

    expect(c.falta()).toBe('Elige cómo vas a pagar.');
    c.confirmar();
    expect(creado).toBeNull();

    c.metodoPagoId.set(3);
    expect(c.falta()).toBeNull();
  });

  it('enviar sin dirección elegida bloquea y no cotiza en falso', async () => {
    direccionesDisponibles = [];
    const c = (await montar()).componentInstance;

    const antes = cotizaciones.length;
    c.elegirEntrega('envio');

    // No hay a dónde enviar: no se pregunta al servidor y se abre la captura,
    // que es lo único que el cliente puede hacer a continuación.
    expect(cotizaciones.length).toBe(antes);
    expect(c.capturandoDireccion()).toBe(true);
    expect(c.cotizacion()).toBeNull();
    expect(c.falta()).toBe('Elige a qué dirección lo enviamos.');
  });

  it('al guardar una dirección la deja elegida y vuelve a cotizar', async () => {
    direccionesDisponibles = [];
    const c = (await montar()).componentInstance;

    c.elegirEntrega('envio');
    c.nueva = {
      ...c.nueva, calle: 'Morelos', ciudad: 'Uriangato',
      estado: 'Guanajuato', codigo_postal: '38980',
    };
    c.guardarDireccion();

    expect(c.direccionId()).toBe(99);
    expect(c.capturandoDireccion()).toBe(false);
    expect(c.cotizacion()?.costo_envio).toBe(85.5);
  });

  it('avisa de los campos que faltan sin gastar un viaje al servidor', async () => {
    direccionesDisponibles = [];
    const c = (await montar()).componentInstance;

    c.elegirEntrega('envio');
    c.nueva = { ...c.nueva, calle: 'Morelos' }; // sin ciudad, estado ni CP
    c.guardarDireccion();

    expect(c.errorDireccion()).toContain('Faltan');
    expect(c.direccionId()).toBeNull();
  });

  it('un cupón inválido avisa y deja el total sin él, no en blanco', async () => {
    cuponesMalos = ['VIEJO'];
    const c = (await montar()).componentInstance;

    c.cuponTecleado = 'VIEJO';
    c.aplicarCupon();

    expect(c.errorCupon()).toBe('El cupón ya expiró');
    expect(c.cuponAplicado()).toBeNull();
    // La pantalla sigue mostrando un total: el de siempre, sin descuento.
    expect(c.cotizacion()?.total).toBe(348);
  });

  it('un cupón bueno se aplica y se puede quitar', async () => {
    const c = (await montar()).componentInstance;

    c.cuponTecleado = 'BIENVENIDA';
    c.aplicarCupon();
    expect(c.cotizacion()?.descuento).toBe(30);

    c.quitarCupon();
    expect(c.cuponAplicado()).toBeNull();
    expect(c.cotizacion()?.descuento).toBe(0);
  });

  it('al confirmar manda lo elegido y NO manda pagos ni costo de envío', async () => {
    const c = (await montar()).componentInstance;

    c.elegirEntrega('envio');
    c.metodoPagoId.set(3);
    c.confirmar();

    expect(creado).toEqual(
      jasmine.objectContaining({
        canal: 'tienda_linea',
        metodo_entrega: 'envio',
        direccion_envio_id: 7,
        metodo_pago_id: 3,
      })
    );
    // El dinero lo pone el backend: mandarlo desde aquí sería regalarle al
    // navegador la decisión de cuánto se cobra.
    expect(creado!.pagos).toBeUndefined();
    expect(creado!.costo_envio).toBeUndefined();
  });

  it('recoger en tienda no manda dirección aunque haya una elegida', async () => {
    const c = (await montar()).componentInstance;

    c.metodoPagoId.set(1);
    c.confirmar();

    expect(c.direccionId()).toBe(7); // sigue elegida por si cambia de idea…
    expect(creado!.direccion_envio_id).toBeUndefined(); // …pero no viaja.
  });

  it('al confirmar vacía el carrito y muestra el pedido', async () => {
    const c = (await montar()).componentInstance;

    c.metodoPagoId.set(3);
    c.confirmar();

    expect(c.pedido()?.numero_pedido).toBe('WEB-1');
    expect(c.cart.items().length).toBe(0);
  });
});
