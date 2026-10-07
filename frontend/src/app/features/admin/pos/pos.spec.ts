import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Pos } from './pos';
import { VentasService } from '../../../core/services/ventas.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { ClientesService } from '../../../core/services/clientes.service';
import { TiendaService } from '../../../core/services/tienda.service';
import { ClienteParaVenta } from '../../../core/models/clientes.models';
import { SesionCaja } from '../../../core/models/ventas.models';

/**
 * El punto de venta mueve dinero. Lo que se prueba aquí son los errores que ya
 * pasaron: guardar el billete y no lo cobrado, que la lista de precio del
 * cliente anterior se quedara puesta, que no se pudiera pasar a otra caja, y
 * que el "paga hoy" de una venta fiada se quedara pegado al teclear.
 *
 * El corte y la apertura del turno ya no viven aquí: se mudaron a Caja.
 */
describe('Pos', () => {
  const sesion: SesionCaja = {
    id: 9,
    caja_id: 1,
    caja: 'Caja 1',
    usuario: 'Cajero',
    usuario_id: 3,
    monto_inicial: '500.00',
    estado: 'abierta',
    fecha_apertura: '2026-10-02 09:00:00',
    esperado_actual: 500,
    movimientos: [],
  };

  const mayoreo: ClienteParaVenta = {
    id: 20,
    nombre: 'Tejidos JC',
    tipo_cliente_id: 2,
    tipo_cliente: 'Mayoreo',
    limite_credito: '5000',
    saldo: '0',
    credito_disponible: '5000',
  };

  let pedidoEnviado: {
    pagos?: { metodo_pago_id: number; monto: number }[];
    a_credito?: number;
    items?: { variante_id: number; cantidad: number; piezas?: number }[];
    encargo?: boolean;
    metodo_entrega?: string;
    entrega_direccion?: string;
    costo_envio?: number;
    entrega_para?: string;
    cliente_id?: number;
  } | null = null;
  let cajaPedida: number | null = null;
  let permisos: Set<string>;

  const ventasFalso = {
    cajas: () =>
      of([
        { id: 1, almacen_id: 1, almacen: 'Matriz', nombre: 'Caja 1', activo: 1, turno_id: 9 },
        { id: 2, almacen_id: 2, almacen: 'Sucursal', nombre: 'Caja 2', activo: 1, turno_id: null },
      ]),
    sesionAbierta: (cajaId: number) => {
      cajaPedida = cajaId;
      return of(cajaId === 1 ? sesion : null);
    },
    metodosPago: () =>
      of([
        { id: 1, nombre: 'Efectivo' },
        { id: 2, nombre: 'Tarjeta' },
      ]),
    apartados: () => of({ items: [], num_apartados: 0, total_apartado: 0, total_abonado: 0 }),
    crearPedido: (body: { pagos?: { metodo_pago_id: number; monto: number }[] }) => {
      pedidoEnviado = body as typeof pedidoEnviado;
      return of({ id: 1, numero_pedido: 'POS-1', estado: 'pagado', total: '432.00', cambio: 68 });
    },
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [Pos],
      providers: [
        provideRouter([]),
        { provide: VentasService, useValue: ventasFalso },
        { provide: InventarioService, useValue: {} },
        {
          provide: AuthService,
          useValue: {
            sesion: signal({ rol: 'cajero' }),
            cargarPerfil: () => of(null),
            puede: (k: string) => permisos.has(k),
          },
        },
        {
          provide: CatalogoService,
          useValue: {
            tiposCliente: () =>
              of([
                { id: 1, nombre: 'Público', es_publico: 1, orden: 1, activo: 1 },
                { id: 2, nombre: 'Mayoreo', es_publico: 0, orden: 2, activo: 1 },
              ]),
          },
        },
        { provide: ClientesService, useValue: { buscar: () => of([]) } },
        { provide: TiendaService, useValue: { cotizar: () => of({ total: 432, subtotal: 372.41, impuestos: 59.59, lineas: [] }) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Pos);
    fixture.detectChanges();
    return { c: fixture.componentInstance, fixture };
  }

  function llenarCarrito(c: Pos): void {
    c.carrito.set([
      { variante_id: 5, sku: 'ROJO', producto: 'ROJO 2/30', precio: 200, unidad: 'kg', cantidad: 1.862 },
    ]);
    c.totalReal.set(432);
  }

  beforeEach(() => {
    pedidoEnviado = null;
    cajaPedida = null;
    permisos = new Set(['ver:caja', 'hacer:fiar']);
    try { localStorage.removeItem('caja_sel'); } catch { /* sin almacenamiento */ }
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    try { localStorage.removeItem('caja_sel'); } catch { /* sin almacenamiento */ }
  });

  it('al quitar al cliente la lista de precio regresa al PÚBLICO', async () => {
    const { c } = await montar();
    expect(c.tipoClienteSel()).toBe(1);
    c.elegirCliente(mayoreo);
    expect(c.tipoClienteSel()).toBe(2);
    c.quitarCliente();
    expect(c.tipoClienteSel()).toBe(1);
  });

  it('un cliente sin lista propia se cobra al público aunque antes se eligiera otra', async () => {
    const { c } = await montar();
    c.tipoClienteSel.set(2);
    c.elegirCliente({ ...mayoreo, id: 21, tipo_cliente_id: null });
    expect(c.tipoClienteSel()).toBe(1);
  });

  it('en efectivo calcula el cambio y avisa si falta', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.metodoSel = 1;
    c.montoPago = 500;
    expect(c.cambioPrevio()).toBe(68);
    c.montoPago = 400;
    expect(c.faltaPrevio()).toBe(32);
  });

  it('con tarjeta no hay cambio: se cobra el importe justo', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.metodoSel = 2;
    c.montoPago = 500;
    expect(c.esEfectivoSel()).toBe(false);
    c.cobrar();
    expect(pedidoEnviado!.pagos).toEqual([{ metodo_pago_id: 2, monto: 432 }]);
  });

  it('el ticket muestra el cambio que calculó el servidor', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.metodoSel = 1;
    c.montoPago = 500;
    c.cobrar();
    expect(pedidoEnviado!.pagos).toEqual([{ metodo_pago_id: 1, monto: 500 }]);
    expect(c.ticket()!.cambio).toBe(68);
  });

  it('no cobra si el efectivo recibido no alcanza', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.metodoSel = 1;
    c.montoPago = 400;
    c.cobrar();
    expect(pedidoEnviado).toBeNull();
    expect(c.error()).toContain('Faltan');
  });

  // ---- La caja ----

  it('sin caja recordada entra a la primera con turno abierto', async () => {
    const { c } = await montar();
    expect(cajaPedida).toBe(1);
    expect(c.sesion()?.id).toBe(9);
    expect(c.subtitulo()).toContain('turno de Cajero');
  });

  it('con un turno abierto se puede pasar a otra caja, y la elección se recuerda', async () => {
    const { c } = await montar();
    expect(c.sesion()?.id).toBe(9);
    c.cajaSel = 2;
    c.cambiarCaja();
    expect(cajaPedida).toBe(2);
    expect(c.sesion()).toBeNull();
    // La misma clave que usa la pantalla Caja: las dos abren la misma caja.
    expect(localStorage.getItem('caja_sel')).toBe('2');
  });

  it('abre la caja que se usó la última vez, aquí o en Caja', async () => {
    localStorage.setItem('caja_sel', '2');
    const { c } = await montar();
    expect(cajaPedida).toBe(2);
    expect(c.sesion()).toBeNull();
    expect(c.subtitulo()).toContain('sin turno abierto');
  });

  // ---- Cobrar / Fiar / Apartar ----

  it('fiar y apartar exigen elegir al cliente', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.elegirModo('fiar');
    expect(c.modo()).toBe('cobrar');
    c.elegirModo('apartar');
    expect(c.modo()).toBe('cobrar');
    expect(c.motivoSinFiar()).toContain('elige al cliente');
  });

  it('a un cliente sin crédito no se le puede fiar, y dice por qué', async () => {
    const { c } = await montar();
    c.elegirCliente({ ...mayoreo, limite_credito: '0', credito_disponible: '0' });
    c.elegirModo('fiar');
    expect(c.modo()).toBe('cobrar');
    expect(c.motivoSinFiar()).toContain('no tiene crédito');
  });

  it('sin el permiso del puesto no se puede fiar', async () => {
    permisos = new Set(['ver:caja']);
    const { c } = await montar();
    c.elegirCliente(mayoreo);
    c.elegirModo('fiar');
    expect(c.modo()).toBe('cobrar');
  });

  it('al fiar, vacío es todo lo que alcance, y el "paga hoy" sigue lo que se teclea', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.elegirCliente(mayoreo);
    c.elegirModo('fiar');
    expect(c.fiando()).toBe(true);
    expect(c.aPagarHoy()).toBe(0);
    // Era un computed sobre un campo con ngModel: se quedaba pegado al teclear.
    c.aCredito = 100;
    expect(c.aPagarHoy()).toBe(332);
    c.metodoSel = 2;
    c.cobrar();
    expect(pedidoEnviado!.a_credito).toBe(100);
    expect(pedidoEnviado!.pagos).toEqual([{ metodo_pago_id: 2, monto: 332 }]);
  });

  it('quitar al cliente regresa a cobrar', async () => {
    const { c } = await montar();
    c.elegirCliente(mayoreo);
    c.elegirModo('apartar');
    expect(c.apartando()).toBe(true);
    c.quitarCliente();
    expect(c.modo()).toBe('cobrar');
  });

  it('con bultos escaneados, para cobrar menos se quita un bulto (no se teclean los kilos)', async () => {
    const { c } = await montar();
    c.carrito.set([
      { variante_id: 5, sku: 'ROJO', producto: 'ROJO 2/30', precio: 200, unidad: 'kg', cantidad: 56.5,
        bultos: [
          { codigo: 'B1', peso_kg: 18.65, lote: null },
          { codigo: 'B2', peso_kg: 19.2, lote: null },
          { codigo: 'B3', peso_kg: 18.65, lote: null },
        ] },
    ]);
    // Teclear menos kilos no hace nada: el tercer bulto quedaría "vendido" en la bodega.
    c.cambiarCantidad(c.carrito()[0], 37.85);
    expect(c.carrito()[0].cantidad).toBe(56.5);
    // Se quita el que no se lleva: bajan sus kilos y deja de ir en la venta.
    c.quitarBulto(c.carrito()[0], 'B3');
    expect(c.carrito()[0].cantidad).toBe(37.85);
    expect(c.carrito()[0].bultos!.map((b) => b.codigo)).toEqual(['B1', 'B2']);
    // Sin bultos, la línea se va.
    c.quitarBulto(c.carrito()[0], 'B1');
    c.quitarBulto(c.carrito()[0], 'B2');
    expect(c.carrito().length).toBe(0);
  });

  // ---- Pesar: conos y venta por kilo (2026-10-06: "vengo por 6 conos") ----

  const conoRojo = { id: 7, sku: 'ROJO-2-30-CONO', producto: 'ROJO 2/30', tipo: 'cono', precio: 200, unidad: 'kg' };

  it('"Agregar" ya no mete 1 kg: abre la báscula', async () => {
    const { c } = await montar();
    c.agregar(conoRojo);
    expect(c.pesando()).toEqual(conoRojo);
    expect(c.carrito().length).toBe(0);
  });

  it('lo que pesaron entra al carrito con sus conos, y otra pesada se suma', async () => {
    const { c } = await montar();
    c.alPesar(conoRojo, { kg: 9.35, piezas: 6 });
    expect(c.pesando()).toBeNull();
    expect(c.carrito()[0]).toEqual(jasmine.objectContaining({ variante_id: 7, cantidad: 9.35, piezas: 6, tipo: 'cono' }));
    expect(c.comoSeVende(c.carrito()[0])).toBe('6 conos · pesados');
    c.alPesar(conoRojo, { kg: 1.552, piezas: 1 });
    expect(c.carrito()[0]).toEqual(jasmine.objectContaining({ cantidad: 10.902, piezas: 7 }));
  });

  it('la venta manda los conos junto con los kilos', async () => {
    const { c } = await montar();
    c.alPesar(conoRojo, { kg: 9.35, piezas: 6 });
    c.totalReal.set(1870);
    c.metodoSel = 2;
    c.cobrar();
    expect(pedidoEnviado!.items).toEqual([jasmine.objectContaining({ variante_id: 7, cantidad: 9.35, piezas: 6 })]);
  });

  it('la búsqueda junta paquete y conos del mismo hilo, y avisa si no tiene conos', async () => {
    const { c } = await montar();
    c.resultados.set([
      { ...conoRojo, producto_id: 1, aqui: { cantidad: 12.5, paquetes: null } },
      { id: 6, producto_id: 1, sku: 'ROJO-2-30', producto: 'ROJO 2/30', tipo: 'paquete', precio: 200, aqui: { cantidad: 390, paquetes: 20 } },
      { id: 9, producto_id: 2, sku: 'NEGRO-1-30', producto: 'NEGRO 1/30', tipo: 'paquete', precio: 180, aqui: { cantidad: 0, paquetes: 0 } },
    ]);
    const [rojo, negro] = c.hilosEncontrados();
    expect(rojo.filas.map((f) => f.tipo)).toEqual(['paquete', 'cono']);
    expect(rojo.sinConos).toBe(false);
    expect(negro.sinConos).toBe(true);
    expect(c.hayAqui(rojo.filas[0])).toBe('20 paquetes · 390 kg');
    expect(c.hayAqui(rojo.filas[1])).toBe('12.5 kg enconados');
    expect(c.hayAqui(negro.filas[0])).toBe('no hay aquí');
  });

  // ---- Pedido: se entrega después (2026-10-06) ----

  it('el pedido pide al cliente, y propone su dirección si lo lleva el chofer', async () => {
    const { c } = await montar();
    c.elegirModo('pedido');
    expect(c.modo()).toBe('cobrar');
    c.elegirCliente({ ...mayoreo, direccion: 'Calle Hidalgo 5' });
    c.elegirModo('pedido');
    expect(c.pidiendo()).toBe(true);
    expect(c.direccionPedido).toBe('Calle Hidalgo 5');
    expect(c.textoBoton()).toBe('Tomar el pedido');
  });

  it('tomar el pedido manda la entrega, lo que deja y no cobra el resto', async () => {
    const { c } = await montar();
    c.elegirCliente(mayoreo);
    llenarCarrito(c);
    c.elegirModo('pedido');
    c.entregaPedido.set('envio');
    c.direccionPedido = '';
    c.cobrar();
    expect(c.error()).toContain('a dónde');
    c.direccionPedido = 'Calle Hidalgo 5';
    c.costoEnvio.set(50);
    c.paraCuando = '2030-01-15';
    c.anticipo = 100;
    c.metodoSel = 1;
    c.cobrar();
    expect(pedidoEnviado).toEqual(jasmine.objectContaining({
      encargo: true, metodo_entrega: 'envio', entrega_direccion: 'Calle Hidalgo 5', costo_envio: 50,
      entrega_para: '2030-01-15', cliente_id: 20, pagos: [{ metodo_pago_id: 1, monto: 100 }],
    }));
  });
});
