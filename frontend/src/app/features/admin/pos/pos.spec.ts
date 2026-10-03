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

  let pedidoEnviado: { pagos?: { metodo_pago_id: number; monto: number }[]; a_credito?: number } | null = null;
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
      pedidoEnviado = body;
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
});
