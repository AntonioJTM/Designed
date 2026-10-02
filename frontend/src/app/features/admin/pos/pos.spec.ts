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
 * cliente anterior se quedara puesta, y que el corte desapareciera al cerrar.
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

  let pedidoEnviado: { pagos?: { metodo_pago_id: number; monto: number }[] } | null = null;
  let cajaPedida: number | null = null;

  const ventasFalso = {
    cajas: () =>
      of([
        { id: 1, almacen_id: 1, almacen: 'Matriz', nombre: 'Caja 1', activo: 1 },
        { id: 2, almacen_id: 2, almacen: 'Sucursal', nombre: 'Caja 2', activo: 1 },
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
    obtenerSesion: () => of(sesion),
    crearPedido: (body: { pagos?: { metodo_pago_id: number; monto: number }[] }) => {
      pedidoEnviado = body;
      return of({ id: 1, numero_pedido: 'POS-1', estado: 'pagado', total: '432.00', cambio: 68 });
    },
    cerrarSesion: () =>
      of({ ...sesion, estado: 'cerrada', monto_esperado: '500.00', monto_final: '490.00', diferencia: '-10.00' }),
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [Pos],
      providers: [
        provideRouter([]),
        { provide: VentasService, useValue: ventasFalso },
        { provide: InventarioService, useValue: { almacenes: () => of([]) } },
        { provide: AuthService, useValue: { sesion: signal({ rol: 'cajero' }), cargarPerfil: () => of(null) } },
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
        { provide: TiendaService, useValue: { cotizar: () => of({ total: 432 }) } },
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
  });
  afterEach(() => TestBed.resetTestingModule());

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

  it('con un turno abierto se puede pasar a otra caja', async () => {
    const { c } = await montar();
    expect(c.sesion()?.id).toBe(9);
    c.cajaSel = 2;
    c.cambiarCaja();
    expect(cajaPedida).toBe(2);
    expect(c.sesion()).toBeNull();
  });

  it('al cerrar la caja, la diferencia del corte queda a la vista', async () => {
    const { c } = await montar();
    spyOn(window, 'confirm').and.returnValue(true);
    c.montoFinal = 490;
    c.cerrarCaja();
    expect(c.ultimoCorte()).not.toBeNull();
    expect(c.diferenciaCorte(c.ultimoCorte()!)).toBe(-10);
  });
});
