import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { Pos, pareceCodigo } from './pos';
import { VentasService } from '../../../core/services/ventas.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { ClientesService } from '../../../core/services/clientes.service';
import { TiendaService } from '../../../core/services/tienda.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { ClienteParaVenta, ColorComprado } from '../../../core/models/clientes.models';
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
    saldo_favor?: number;
    pendiente_pago?: boolean;
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
  let invFalso: Record<string, unknown> = {};
  /** Lo que siempre lleva el cliente elegido (2026-10-16). */
  let hilosCliente: ColorComprado[] = [];
  /** Lo que contesta la cajera cuando la caja pregunta (y si preguntó). */
  let respuesta = true;
  let preguntado: string | null = null;

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
        { id: 3, nombre: 'Transferencia' },
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
        { provide: InventarioService, useValue: invFalso },
        {
          provide: AuthService,
          useValue: {
            sesion: signal({ rol: 'cajero' }),
            cargarPerfil: () => of(null),
            puede: (k: string) => permisos.has(k),
            puedeOPide: (k: string) => permisos.has(k) || permisos.has(k.replace(/^hacer:/, 'pedir:')),
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
        { provide: ClientesService, useValue: { buscar: () => of([]), loQueLleva: () => of(hilosCliente) } },
        { provide: TiendaService, useValue: { cotizar: () => of({ total: 432, subtotal: 372.41, impuestos: 59.59, lineas: [] }) } },
        {
          provide: ConfirmacionService,
          useValue: { pedir: (o: { titulo: string }) => { preguntado = o.titulo; return Promise.resolve(respuesta); } },
        },
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
    permisos = new Set(['ver:caja', 'hacer:fiar', 'pedir:fiar_atrasado']);
    invFalso = {};
    hilosCliente = [];
    respuesta = true;
    preguntado = null;
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

  // ---- Cobrar / A crédito / Nota en espera / Pendiente de pago (2026-10-13) ----

  it('a crédito, nota en espera y pendiente de pago exigen elegir al cliente', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    for (const m of ['credito', 'espera', 'pendiente'] as const) {
      c.elegirModo(m);
      expect(c.modo()).withContext(m).toBe('cobrar');
    }
    expect(c.motivoSinFiar()).toContain('elige al cliente');
    expect(c.motivoSinPendiente()).toContain('elige al cliente');
  });

  it('la nota pendiente de pago se lleva sin pagar: no manda pago ni crédito', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.elegirCliente(mayoreo);
    c.elegirModo('pendiente');
    expect(c.notaPendiente()).toBe(true);
    expect(c.textoBoton()).toBe('Dar nota pendiente de pago · $432.00');
    c.cobrar();
    expect(pedidoEnviado).toEqual(jasmine.objectContaining({ pendiente_pago: true, cliente_id: 20 }));
    expect(pedidoEnviado!.pagos).toBeUndefined();
    expect(pedidoEnviado!.a_credito).toBeUndefined();
    expect(c.ticket()).not.toBeNull();
  });

  it('a un cliente sin crédito no se le puede fiar, y dice por qué', async () => {
    const { c } = await montar();
    c.elegirCliente({ ...mayoreo, limite_credito: '0', credito_disponible: '0' });
    c.elegirModo('credito');
    expect(c.modo()).toBe('cobrar');
    expect(c.motivoSinFiar()).toContain('no tiene crédito');
  });

  it('sin el permiso del puesto no se puede fiar', async () => {
    permisos = new Set(['ver:caja']);
    const { c } = await montar();
    c.elegirCliente(mayoreo);
    c.elegirModo('credito');
    expect(c.modo()).toBe('cobrar');
  });

  it('al fiar, vacío es todo lo que alcance, y el "paga hoy" sigue lo que se teclea', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.elegirCliente(mayoreo);
    c.elegirModo('credito');
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

  /*
   * CUENTA ATRASADA (2026-10-16): debe y pasó el plazo sin abonar. Se avisa en
   * rojo, y antes de fiarle se pregunta; el servidor sabe que se confirmó.
   */
  it('con la cuenta atrasada pregunta antes de fiarle y, si no, no vende', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.elegirCliente({ ...mayoreo, saldo: '800', atrasado: true, dias_sin_abonar: 22 });
    c.elegirModo('credito');
    respuesta = false;
    await c.cobrar();
    expect(preguntado).toBe('¿Darle a crédito con la cuenta atrasada?');
    expect(pedidoEnviado).toBeNull();
  });

  it('con la cuenta atrasada y la cajera dice que sí: vende y lo avisa al servidor', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.elegirCliente({ ...mayoreo, saldo: '800', atrasado: true, dias_sin_abonar: 22 });
    c.elegirModo('credito');
    await c.cobrar();
    expect(pedidoEnviado!.a_credito).toBe(432);
    expect((pedidoEnviado as unknown as { fiar_con_atraso?: boolean }).fiar_con_atraso).toBe(true);
  });

  it('con la cuenta atrasada y sin poder darle así ni pedirlo: no pregunta y dice por qué', async () => {
    permisos.delete('pedir:fiar_atrasado');
    const { c } = await montar();
    llenarCarrito(c);
    c.elegirCliente({ ...mayoreo, saldo: '800', atrasado: true, dias_sin_abonar: 22 });
    c.elegirModo('credito');
    await c.cobrar();
    expect(preguntado).toBeNull();
    expect(pedidoEnviado).toBeNull();
    expect(c.error()).toContain('22 días sin abonar');
  });

  it('al corriente, fía sin preguntar', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.elegirCliente({ ...mayoreo, saldo: '800', atrasado: false, dias_sin_abonar: 3 });
    c.elegirModo('credito');
    await c.cobrar();
    expect(preguntado).toBeNull();
    expect((pedidoEnviado as unknown as { fiar_con_atraso?: boolean }).fiar_con_atraso).toBeUndefined();
  });

  it('el aviso del cliente dice los días y va en rojo cuando está atrasado', async () => {
    const { c, fixture } = await montar();
    c.elegirCliente({ ...mayoreo, saldo: '800', atrasado: true, dias_sin_abonar: 22 });
    fixture.detectChanges();
    const aviso = (fixture.nativeElement as HTMLElement).querySelector('.aviso-cliente');
    expect(aviso?.classList.contains('atrasado')).toBe(true);
    expect(aviso?.textContent).toContain('22 días sin abonar');
  });

  /*
   * EL CINTILLO DEL MODO (2026-10-16): una línea que dice qué pasa con la
   * mercancía y con el dinero, con el color de su estado.
   */
  it('el cintillo dice qué pasa en cada modo, con su color', async () => {
    const { c, fixture } = await montar();
    llenarCarrito(c);
    c.elegirCliente(mayoreo);
    let ci = c.cintillo();
    expect(ci.tono).toBe('cobrar');
    expect(ci.texto).toBe('La mercancía sale hoy y se cobran $432.00.');

    c.elegirModo('espera');
    expect(c.cintillo().tono).toBe('espera');
    expect(c.cintillo().texto).toContain('no sale del inventario');
    c.anticipo = 100;
    expect(c.cintillo().texto).toContain('Deja $100.00 hoy');

    c.elegirModo('pendiente');
    expect(c.cintillo().tono).toBe('pendiente');
    expect(c.cintillo().texto).toContain('no entra dinero ni usa su crédito');

    fixture.detectChanges();
    const p = (fixture.nativeElement as HTMLElement).querySelector('.cintillo');
    expect(p?.getAttribute('data-tono')).toBe('pendiente');
  });

  it('a crédito dice cuánto crédito libre le quedará, y sigue lo que se teclea', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.elegirCliente(mayoreo);
    c.elegirModo('credito');
    const libre = Number(mayoreo.credito_disponible);
    expect(c.cintillo().texto).toContain(`Le quedarán ${c.dinero(libre - 432)} de crédito libre`);
    c.aCredito = 100;
    expect(c.cintillo().texto).toBe(
      `Se lleva la mercancía hoy y $100.00 van a su cuenta; paga $332.00 hoy. Le quedarán ${c.dinero(libre - 100)} de crédito libre.`);
  });

  it('a crédito con la cuenta atrasada el cintillo va en rojo y dice los días', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.elegirCliente({ ...mayoreo, saldo: '800', atrasado: true, dias_sin_abonar: 22 });
    c.elegirModo('credito');
    expect(c.cintillo().tono).toBe('atrasado');
    expect(c.cintillo().texto).toContain('lleva 22 días sin abonar');
  });

  it('con saldo a favor: se usa solo si lo pide, y paga hoy lo que falte (2026-10-13)', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.elegirCliente({ ...mayoreo, saldo_favor: '300' });
    expect(c.ofreceSaldo()).toBe(true);
    // No se usa sin que lo pida: puede guardarlo para otra compra.
    expect(c.saldoActual()).toBe(0);
    expect(c.aPagarHoy()).toBe(432);
    c.usarSaldo = true;
    expect(c.saldoActual()).toBe(300);
    expect(c.aPagarHoy()).toBe(132);
    expect(c.textoBoton()).toBe('Cobrar $132.00 y $300.00 de su saldo a favor');
    c.saldoAUsar = 100;
    expect(c.aPagarHoy()).toBe(332);
    c.metodoSel = 2;
    c.cobrar();
    expect(pedidoEnviado!.saldo_favor).toBe(100);
    expect(pedidoEnviado!.pagos).toEqual([{ metodo_pago_id: 2, monto: 332 }]);
  });

  it('el saldo a favor que cubre todo no manda pago, y no se usa más del que tiene', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.elegirCliente({ ...mayoreo, saldo_favor: '1000' });
    c.usarSaldo = true;
    expect(c.saldoActual()).toBe(432);
    expect(c.textoBoton()).toBe('Pagar con su saldo a favor · $432.00');
    c.saldoAUsar = 2000;
    c.cobrar();
    expect(pedidoEnviado).toBeNull();
    expect(c.error()).toContain('Solo tiene');
    c.saldoAUsar = null;
    c.cobrar();
    expect(pedidoEnviado!.saldo_favor).toBe(432);
    expect(pedidoEnviado!.pagos).toBeUndefined();
  });

  it('el saldo a favor no se ofrece en una nota en espera ni pendiente de pago', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.elegirCliente({ ...mayoreo, saldo_favor: '300' });
    c.usarSaldo = true;
    c.elegirModo('pendiente');
    expect(c.ofreceSaldo()).toBe(false);
    expect(c.saldoActual()).toBe(0);
    c.elegirModo('espera');
    expect(c.ofreceSaldo()).toBe(false);
  });

  it('parte y parte: la transferencia y el resto en efectivo, con su cambio (2026-10-14)', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    expect(c.permiteMixto()).toBe(true);
    c.metodoSel = 'mixto';
    c.cobrar();
    expect(pedidoEnviado).toBeNull();
    expect(c.error()).toContain('por transferencia');
    c.montoTransferencia = 132;
    expect(c.aCobrarEnEfectivo()).toBe(300);
    c.montoPago = 500;
    expect(c.cambioPrevio()).toBe(200);
    c.cobrar();
    expect(pedidoEnviado!.pagos).toEqual([
      { metodo_pago_id: 3, monto: 132 },
      { metodo_pago_id: 1, monto: 500 },
    ]);
  });

  it('dos clics en Cobrar mandan UNA venta, con su llave de un solo uso (2026-10-19)', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.metodoSel = 1;
    const respuestaServidor = new Subject<unknown>();
    const enviados: { clave_cobro?: string }[] = [];
    spyOn(ventasFalso, 'crearPedido').and.callFake(((body: { clave_cobro?: string }) => {
      enviados.push(body);
      return respuestaServidor;
    }) as never);
    c.cobrar();
    c.cobrar();
    expect(enviados.length).toBe(1);
    expect(c.cobrando()).toBe(true);
    const primera = enviados[0].clave_cobro;
    expect(primera).toMatch(/^[0-9a-f-]{36}$/);
    respuestaServidor.next({ id: 1, numero_pedido: 'POS-1', estado: 'pagado', total: '432.00', cambio: 68 });
    respuestaServidor.complete();
    expect(c.cobrando()).toBe(false);
    // La siguiente venta lleva OTRA llave.
    llenarCarrito(c);
    c.cobrar();
    expect(enviados.length).toBe(2);
    expect(enviados[1].clave_cobro).not.toBe(primera);
  });

  it('si el servidor rechaza la venta se suelta Cobrar y se conserva la llave', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.metodoSel = 1;
    const claves: (string | undefined)[] = [];
    spyOn(ventasFalso, 'crearPedido').and.callFake(((body: { clave_cobro?: string }) => {
      claves.push(body.clave_cobro);
      return throwError(() => ({ error: { error: { message: 'No hay existencias' } } }));
    }) as never);
    c.cobrar();
    expect(c.cobrando()).toBe(false);
    expect(c.error()).toContain('No hay existencias');
    c.cobrar();
    expect(claves.length).toBe(2);
    expect(claves[1]).toBe(claves[0]);
  });

  it('parte y parte: la transferencia no puede pasar del total (no da cambio)', async () => {
    const { c } = await montar();
    llenarCarrito(c);
    c.metodoSel = 'mixto';
    c.montoTransferencia = 500;
    c.cobrar();
    expect(pedidoEnviado).toBeNull();
    expect(c.error()).toContain('no da cambio');
  });

  it('quitar al cliente regresa a cobrar', async () => {
    const { c } = await montar();
    c.elegirCliente(mayoreo);
    c.elegirModo('pendiente');
    expect(c.notaPendiente()).toBe(true);
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

  it('un código que no existe se avisa junto al lector y el campo queda vacío; un texto se busca', async () => {
    // 2026-10-14: "escaneé uno que no existe y me deja eso así; retrasa el escaneo".
    const buscados: string[] = [];
    invFalso['resolverCodigo'] = () => throwError(() => ({ status: 404 }));
    invFalso['buscarVariantes'] = (q: string) => { buscados.push(q); return of([]); };
    const { c } = await montar();
    c.qVar = '1234567812345678';
    c.escanearOBuscar();
    expect(c.avisoLector()).toBe('El código 1234567812345678 no está registrado. Revisa la etiqueta o escanea otro.');
    expect(c.qVar).toBe('');
    expect(buscados).toEqual([]);
    expect(c.carrito().length).toBe(0);
    // Un color con su calibre no es un código: se busca, y si no hay nada se dice.
    c.qVar = 'rojo 2/30';
    c.escanearOBuscar();
    expect(buscados).toEqual(['rojo 2/30']);
    expect(c.avisoLector()).toContain('No encontré ningún hilo con «rojo 2/30»');
    expect(c.qVar).toBe('rojo 2/30');
    // Si el servidor no contesta, no dice que no existe.
    invFalso['resolverCodigo'] = () => throwError(() => ({ status: 0 }));
    c.qVar = '00621999';
    c.escanearOBuscar();
    expect(c.avisoLector()).toBe('No se pudo revisar el código 00621999. Vuelve a escanearlo.');
    expect(c.qVar).toBe('');
  });

  it('distingue un código de barras de un color escrito', () => {
    expect(pareceCodigo('00621999')).toBe(true);
    expect(pareceCodigo('1234567812345678')).toBe(true);
    expect(pareceCodigo('TMPVV-PAQ-1234')).toBe(true);
    expect(pareceCodigo('rojo')).toBe(false);
    expect(pareceCodigo('rojo 2/30')).toBe(false);
    expect(pareceCodigo('MARINO-2-30')).toBe(false);
    expect(pareceCodigo('1234')).toBe(false);
  });

  it('solo vende paquetes de SU tienda: el de la bodega o el que viene en camino se rechazan', async () => {
    // 2026-10-07: "si está en Tienda Principal solo se venden los paquetes que están ahí".
    const rojo = { id: 5, sku: 'ROJO', producto: 'ROJO', calibre: '2/30', precio: '200', unidad: 'kg', tipo_presentacion: 'paquete' };
    const resueltos: Record<string, unknown> = {
      B1: { variante: rojo, bulto: { id: 1, variante_id: 5, codigo: 'B1', peso_kg: '19.95', estado: 'disponible', almacen_id: 2, almacen: 'Almacén General' } },
      C1: { variante: rojo, bulto: { id: 2, variante_id: 5, codigo: 'C1', peso_kg: '19.2', estado: 'disponible', almacen_id: 1, almacen: 'Matriz', en_camino_folio: 'TRA-9' } },
      T1: { variante: rojo, bulto: { id: 3, variante_id: 5, codigo: 'T1', peso_kg: '19.5', estado: 'disponible', almacen_id: 1, almacen: 'Matriz' } },
      M1: { variante: rojo, bulto: { id: 4, variante_id: 5, codigo: 'M1', peso_kg: '18.6', estado: 'disponible', almacen_id: null } },
    };
    invFalso['resolverCodigo'] = (q: string) => of(resueltos[q]);
    const { c } = await montar();
    // La Caja 1 es de «Matriz».
    c.qVar = 'B1';
    c.escanearOBuscar();
    // El aviso va junto al lector, y el campo queda vacío para el siguiente.
    expect(c.avisoLector()).toBe('El paquete B1 sí existe, pero está en «Almacén General», no en «Matriz»: toma uno que esté en esta tienda.');
    expect(c.qVar).toBe('');
    expect(c.carrito().length).toBe(0);
    c.qVar = 'C1';
    c.escanearOBuscar();
    expect(c.avisoLector()).toContain('viene en camino (TRA-9)');
    expect(c.carrito().length).toBe(0);
    // El de aquí sí; y el capturado a mano sin almacén también.
    c.qVar = 'T1';
    c.escanearOBuscar();
    c.qVar = 'M1';
    c.escanearOBuscar();
    expect(c.carrito()[0].bultos!.map((b) => b.codigo)).toEqual(['T1', 'M1']);
    expect(c.carrito()[0].cantidad).toBe(38.1);
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

  // ---- Nota en espera: se entrega después, sin chofer (2026-10-13) ----

  it('la nota en espera pide al cliente', async () => {
    const { c } = await montar();
    c.elegirModo('espera');
    expect(c.modo()).toBe('cobrar');
    c.elegirCliente(mayoreo);
    c.elegirModo('espera');
    expect(c.pidiendo()).toBe(true);
    expect(c.textoBoton()).toBe('Guardar nota en espera');
  });

  it('guardar la nota en espera manda para cuándo y lo que deja, sin chofer', async () => {
    const { c } = await montar();
    c.elegirCliente(mayoreo);
    llenarCarrito(c);
    c.elegirModo('espera');
    c.paraCuando = '2030-01-15';
    c.anticipo = 100;
    c.metodoSel = 1;
    c.cobrar();
    expect(pedidoEnviado).toEqual(jasmine.objectContaining({
      encargo: true, metodo_entrega: 'recoger', entrega_para: '2030-01-15', cliente_id: 20,
      pagos: [{ metodo_pago_id: 1, monto: 100 }],
    }));
    expect(pedidoEnviado!.entrega_direccion).toBeUndefined();
  });

  // ---- El cursor en el lector (auditoría 2026-10-13) ----
  //
  // La pistola escribe donde esté el cursor. Al abrir la caja no estaba en
  // ningún campo y después de cobrar o de pesar se quedaba en un botón: el
  // código se perdía y el Enter apretaba ese botón.

  const esperar = () => new Promise((r) => setTimeout(r, 0));
  const lectorDe = (f: { nativeElement: HTMLElement }) =>
    f.nativeElement.querySelector('input[name="qvar"]') as HTMLInputElement;
  const tecla = (en: Element, key: string) =>
    en.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  it('al abrir la caja con turno, el cursor queda en el lector', async () => {
    const { fixture } = await montar();
    fixture.detectChanges();
    await esperar();
    expect(document.activeElement).toBe(lectorDe(fixture));
  });

  it('si el cursor quedó en un botón, la primera tecla de la pistola lo lleva al lector', async () => {
    const { fixture } = await montar();
    await esperar();
    const boton = fixture.nativeElement.querySelector('.btn-cobrar') as HTMLButtonElement;
    boton.removeAttribute('disabled');
    boton.focus();
    tecla(boton, '0');
    expect(document.activeElement).toBe(lectorDe(fixture));
  });

  it('la barra espaciadora y los atajos no mueven el cursor', async () => {
    const { fixture } = await montar();
    await esperar();
    const boton = fixture.nativeElement.querySelector('.btn-cobrar') as HTMLButtonElement;
    boton.removeAttribute('disabled');
    boton.focus();
    tecla(boton, ' ');
    boton.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    expect(document.activeElement).toBe(boton);
  });

  it('no le quita el cursor a otro campo donde se está escribiendo', async () => {
    permisos.add('ver:clientes');
    const { fixture } = await montar();
    await esperar();
    const cliente = fixture.nativeElement.querySelector('input[name="qcli"]') as HTMLInputElement;
    cliente.focus();
    tecla(cliente, 'r');
    fixture.componentInstance.enfocarLector();
    fixture.detectChanges();
    await esperar();
    expect(document.activeElement).toBe(cliente);
  });

  it('con la báscula abierta no se mete: la ventana es la que manda', async () => {
    const { c, fixture } = await montar();
    c.agregar(conoRojo);
    fixture.detectChanges();
    await esperar();
    const enVentana = fixture.nativeElement.querySelector('[aria-modal="true"] button') as HTMLButtonElement;
    enVentana.focus();
    tecla(enVentana, '7');
    expect(document.activeElement).toBe(enVentana);
  });

  it('al pesar, el lector queda listo y se quita el ticket de la venta anterior', async () => {
    const { c, fixture } = await montar();
    c.ticket.set({ pedido: { id: 1, numero_pedido: 'POS-1', estado: 'pagado', total: '432.00' } as never, cambio: 68, pagadoHoy: 432, fiado: 0 });
    c.agregar(conoRojo);
    fixture.detectChanges();
    c.alPesar(conoRojo, { kg: 2.5 });
    fixture.detectChanges();
    await esperar();
    expect(c.ticket()).toBeNull();
    expect(document.activeElement).toBe(lectorDe(fixture));
  });

  it('al cerrar la báscula sin pesar, el cursor regresa al lector', async () => {
    const { c, fixture } = await montar();
    c.agregar(conoRojo);
    fixture.detectChanges();
    await esperar();
    c.cerrarBascula();
    fixture.detectChanges();
    await esperar();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    expect(document.activeElement).toBe(lectorDe(fixture));
  });

  it('después de cobrar, el lector queda listo para el siguiente cliente', async () => {
    const { c, fixture } = await montar();
    llenarCarrito(c);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.btn-cobrar') as HTMLButtonElement).focus();
    c.cobrar();
    fixture.detectChanges();
    await esperar();
    expect(c.ticket()).not.toBeNull();
    expect(document.activeElement).toBe(lectorDe(fixture));
  });

  /*
   * LO QUE SIEMPRE LLEVA (2026-10-16): al elegir al cliente, sus hilos de
   * siempre como botones; el nombre busca el hilo y "Conos" abre la báscula.
   */
  describe('lo que siempre lleva', () => {
    const doñaMari = {
      id: 7, nombre: 'María', nombre_comercial: 'Doña Mari', limite_credito: 0, saldo: 0, credito_disponible: 0,
    } as unknown as ClienteParaVenta;
    const rojo = { producto_id: 40, color: 'ROJO', calibre: '2/30', kilos: '368.4', importe: '0', veces: 12 } as ColorComprado;
    const variante = (tipo: string, kg: number) => ({
      id: tipo === 'cono' ? 41 : 40, producto_id: 40, sku: tipo === 'cono' ? 'ROJO-CONO' : 'ROJO', producto: 'ROJO',
      calibre: '2/30', presentacion: tipo, tipo_presentacion: tipo, precio: '200', unidad: 'kg', activo: 1,
      aqui: { cantidad: kg, paquetes: null },
    });

    it('al elegirlo salen sus hilos; al quitarlo se van', async () => {
      hilosCliente = [rojo];
      const { c } = await montar();
      c.elegirCliente(doñaMari);
      expect(c.loQueLleva().map((h) => c.nombreHiloCliente(h))).toEqual(['ROJO 2/30']);
      expect(c.detalleHiloCliente(rojo)).toBe('Se ha llevado 368.4 kg en 12 compras');
      c.quitarCliente();
      expect(c.loQueLleva()).toEqual([]);
    });

    it('el nombre busca ese hilo con lo que hay en esta caja', async () => {
      const buscados: string[] = [];
      invFalso['buscarVariantes'] = (q: string) => { buscados.push(q); return of([]); };
      hilosCliente = [rojo];
      const { c } = await montar();
      c.elegirCliente(doñaMari);
      c.buscarHiloCliente(rojo);
      expect(buscados).toContain('ROJO 2/30');
    });

    it('"Conos" abre directo la báscula de sus conos si hay aquí', async () => {
      invFalso['buscarVariantes'] = () => of([variante('paquete', 120), variante('cono', 12.5)]);
      hilosCliente = [rojo];
      const { c } = await montar();
      c.elegirCliente(doñaMari);
      c.conosHiloCliente(rojo);
      expect(c.pesando()?.id).toBe(41);
      expect(c.pesando()?.tipo).toBe('cono');
    });

    it('sin conos aquí no abre la báscula: enseña el hilo y dice por qué', async () => {
      invFalso['buscarVariantes'] = () => of([variante('paquete', 120), variante('cono', 0)]);
      hilosCliente = [rojo];
      const { c } = await montar();
      c.elegirCliente(doñaMari);
      c.conosHiloCliente(rojo);
      expect(c.pesando()).toBeNull();
      expect(c.avisoLector()).toContain('No hay conos de ROJO 2/30 en esta tienda');
    });
  });
});
