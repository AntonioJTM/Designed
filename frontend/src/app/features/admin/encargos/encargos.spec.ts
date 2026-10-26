import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { EncargosPantalla } from './encargos';
import { EntregarPedidoModal } from './entregar-modal';
import { ModificarPedidoModal } from './modificar-modal';
import { InventarioService } from '../../../core/services/inventario.service';
import { VentasService } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { TicketService } from '../../../core/services/ticket.service';
import { Encargo, Encargos, ModificarPedidoInput, Pedido } from '../../../core/models/ventas.models';
import { hoyLocal } from '../../../shared/fecha.pipe';
import { TransferenciasService } from '../../../core/services/transferencias.service';
import { transferenciasFalso } from '../../../core/services/transferencias.falso';

/**
 * PEDIDOS de clientes (2026-10-06), EN ESPERA desde el 2026-10-07 ("mejor que
 * sean notas en espera, porque el cliente quiere modificar su pedido"):
 *   · la lista dice "En espera" y ofrece Modificar y Entregar; se filtra por
 *     para hoy, atrasados y los que lleva el chofer;
 *   · modificar quita o agrega hilos, escanea paquetes y cambia la entrega;
 *   · entregar cobra lo que falta (en efectivo con cambio y a un turno), o fía
 *     el resto; ya pagado, solo entrega.
 */
const base = {
  numero_pedido: 'POS-1-AAAA', metodo_entrega: 'recoger', entrega_direccion: null, entrega_para: null,
  total: 2000, costo_envio: '0.00', notas: null, creado_en: '2026-10-06 10:00:00', almacen_id: 1, almacen: 'Tienda',
  cliente_id: 5, cliente: 'Mercería La Esperanza', nombre_comercial: 'Doña Chela', telefono: '4450000000',
  vendedor: 'Lupita', pagado: 500, falta: 1500, kg: 20,
  hilos: [{ hilo: 'ROJO 2/30', tipo_presentacion: 'paquete', kg: 20, piezas: null, paquetes: 1 }],
};
const porPreparar = { ...base, id: 1, estado: 'en_preparacion' } as Encargo;
const conChofer = { ...base, id: 2, estado: 'en_preparacion', metodo_entrega: 'envio', entrega_direccion: 'Calle 1', entrega_para: '2020-01-01' } as Encargo;
const paraHoy = { ...base, id: 3, estado: 'en_preparacion', entrega_para: hoyLocal() } as Encargo;

describe('EncargosPantalla', () => {
  async function montar() {
    const datos: Encargos = { items: [porPreparar, conChofer, paraHoy], conteo: { en_preparacion: 3, listo: 0, enviado: 0 }, por_cobrar: 4500 };
    await TestBed.configureTestingModule({
      imports: [EncargosPantalla],
      providers: [{ provide: TransferenciasService, useValue: transferenciasFalso() }, 
        provideRouter([]),
        { provide: VentasService, useValue: { encargos: () => of(datos) } },
        { provide: AuthService, useValue: { puede: () => true, puedeOPide: () => true } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(EncargosPantalla);
    f.detectChanges();
    return f;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('todos están en espera, con Modificar y Entregar', async () => {
    const f = await montar();
    const c = f.componentInstance;
    expect(c.queLleva(porPreparar.hilos[0])).toBe('ROJO 2/30 · 20 kg (≈ 1 paquete)');
    // Ya escaneados: son los que van, sin "≈".
    expect(c.queLleva({ ...porPreparar.hilos[0], escaneados: 2, paquetes: 2 })).toBe('ROJO 2/30 · 20 kg · 2 paquetes');
    const fila = (f.nativeElement as HTMLElement).querySelector('tbody tr') as HTMLElement;
    expect(fila.textContent).toContain('En espera');
    expect(fila.textContent).toContain('Modificar');
    expect(fila.textContent).toContain('Entregar y cobrar');
    expect(fila.textContent).not.toContain('Preparar');
    expect((f.nativeElement as HTMLElement).textContent).toContain('Doña Chela');
  });

  it('al entregarla ofrece su ticket: imprimirlo o mandarlo por WhatsApp, con el cambio (2026-10-17)', async () => {
    const f = await montar();
    const c = f.componentInstance;
    const tickets = TestBed.inject(TicketService);
    const imprimir = spyOn(tickets, 'imprimir').and.returnValue(of(undefined));
    const whatsapp = spyOn(tickets, 'whatsapp');
    c.alEntregar({ id: 1, numero_pedido: 'POS-1-AAAA', estado: 'pagado', cambio: 50 } as unknown as Pedido);
    f.detectChanges();
    const aviso = (f.nativeElement as HTMLElement).querySelector('.ok-msg') as HTMLElement;
    expect(aviso.textContent).toContain('POS-1-AAAA entregada. Su cambio: $50.00.');
    expect(aviso.textContent).toContain('Imprimir ticket');
    c.ticketAviso.actual()!.imprimir();
    c.ticketAviso.actual()!.whatsapp!();
    expect(imprimir).toHaveBeenCalledWith(1, { cambio: 50 });
    expect(whatsapp).toHaveBeenCalledWith(1, { cambio: 50 });
  });

  it('se filtran por para hoy y atrasados (ya no hay chofer, 2026-10-13)', async () => {
    const f = await montar();
    const c = f.componentInstance;
    expect(c.cuantos()).toEqual({ todos: 3, hoy: 1, atrasados: 1 });
    c.filtro.set('hoy');
    expect(c.items().map((e) => e.id)).toEqual([3]);
    c.filtro.set('atrasados');
    expect(c.items().map((e) => e.id)).toEqual([2]);
  });

  it('para cuándo: hoy, y atrasado si ya pasó', async () => {
    const f = await montar();
    const c = f.componentInstance;
    expect(c.paraCuando({ ...porPreparar, entrega_para: hoyLocal() })).toBe('para hoy');
    expect(c.atrasado({ ...porPreparar, entrega_para: '2020-01-01' })).toBe(true);
  });
});

describe('EntregarPedidoModal', () => {
  let enviado: Record<string, unknown> | null = null;

  async function montar(pedido: Encargo, permisos = ['hacer:fiar']) {
    enviado = null;
    await TestBed.configureTestingModule({
      imports: [EntregarPedidoModal],
      providers: [{ provide: TransferenciasService, useValue: transferenciasFalso() }, 
        {
          provide: VentasService,
          useValue: {
            metodosPago: () => of([{ id: 1, nombre: 'Efectivo' }, { id: 2, nombre: 'Transferencia' }]),
            cajas: () => of([{ id: 7, almacen_id: 1, nombre: 'Caja 1', activo: 1 }]),
            sesionAbierta: () => of({ id: 70, caja_id: 7, caja: 'Caja 1' }),
            entregarPedido: (_id: number, b: Record<string, unknown>) => {
              enviado = b;
              return of({ id: pedido.id, numero_pedido: pedido.numero_pedido, estado: 'entregado', cambio: 0 });
            },
          },
        },
        { provide: AuthService, useValue: { puede: (p: string) => permisos.includes(p), puedeOPide: (p: string) => permisos.includes(p) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(EntregarPedidoModal);
    f.componentRef.setInput('pedido', pedido);
    f.detectChanges();
    await f.whenStable();
    return f.componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  // SU SALDO A FAVOR ES UNA FORMA MÁS (2026-10-23, usuario: "que igual se pueda pagar con
  // saldo a favor si es que tiene el cliente"). Faltan $1,500.00.
  it('saldo a favor y efectivo: usa todo su saldo y el resto se cobra en efectivo', async () => {
    const c = await montar({ ...porPreparar, saldo_favor: 300 });
    expect(c.saldoCubreTodo()).toBe(false);
    expect(c.favor()).toBe(0);
    c.cambiarForma('saldo_efectivo');
    expect(c.favor()).toBe(300);
    expect(c.falta()).toBe(1200);
    expect(c.enEfectivo()).toBe(1200);
    expect(c.resumenSaldo()).toBe('Usa $300.00 de su saldo a favor (le quedan $0.00); el resto, $1,200.00, en efectivo.');
    c.entregar();
    expect(enviado).toEqual({ pagos: [{ metodo_pago_id: 1, monto: 1200 }], sesion_caja_id: 70, a_credito: undefined, saldo_favor: 300 });
  });

  it('saldo a favor y crédito: lo que no cubre su saldo va a crédito con sus días', async () => {
    const c = await montar({ ...porPreparar, saldo_favor: 300 });
    c.cambiarForma('saldo_credito');
    expect(c.aCredito()).toBe(1200);
    expect(c.aCobrar()).toBe(0);
    expect(c.resumenSaldo()).toContain('el resto, $1,200.00, va a su cuenta de crédito.');
    c.entregar();
    expect(enviado).toEqual({ pagos: undefined, sesion_caja_id: undefined, a_credito: 1200, dias_credito: 15, saldo_favor: 300 });
  });

  it('si su saldo alcanza, se paga todo con él; si no, "Todo con su saldo" no deja entregar', async () => {
    const c = await montar({ ...porPreparar, saldo_favor: 2000 });
    expect(c.saldoCubreTodo()).toBe(true);
    c.cambiarForma('saldo');
    expect(c.favor()).toBe(1500);
    expect(c.falta()).toBe(0);
    expect(c.motivo()).toBeNull();
    expect(c.resumenSaldo()).toBe('Usa $1,500.00 de su saldo a favor (le quedan $500.00) y con eso queda pagada.');
    c.entregar();
    expect(enviado).toEqual({ pagos: undefined, sesion_caja_id: undefined, a_credito: undefined, saldo_favor: 1500 });

    TestBed.resetTestingModule();
    const poco = await montar({ ...porPreparar, saldo_favor: 300 });
    poco.cambiarForma('saldo');
    expect(poco.motivo()).toContain('Su saldo a favor no alcanza');
  });

  it('la lista ofrece su saldo a favor solo si tiene, con lo que le alcanza', async () => {
    const opciones = async (saldo: number) => {
      TestBed.resetTestingModule();
      await montar({ ...porPreparar, saldo_favor: saldo });
      const f = TestBed.createComponent(EntregarPedidoModal);
      f.componentRef.setInput('pedido', { ...porPreparar, saldo_favor: saldo });
      f.detectChanges();
      await f.whenStable();
      f.detectChanges();
      const grupo = (f.nativeElement as HTMLElement).querySelector('optgroup[label^="Con su saldo"]');
      return grupo ? [grupo.getAttribute('label'), ...[...grupo.querySelectorAll('option')].map((o) => o.textContent?.trim())] : null;
    };
    expect(await opciones(0)).toBeNull();
    expect(await opciones(300)).toEqual([
      'Con su saldo a favor · tiene $300.00', 'Saldo a favor y efectivo', 'Saldo a favor y transferencia', 'Saldo a favor y crédito',
    ]);
    expect(await opciones(2000)).toEqual(['Con su saldo a favor · tiene $2,000.00', 'Todo con su saldo a favor']);
  });

  it('como pendiente de pago, su saldo a favor sigue siendo la casilla (2026-10-20)', async () => {
    const c = await montar({ ...porPreparar, saldo_favor: 300 });
    c.comoNota = true;
    expect(c.favor()).toBe(0);
    c.usarFavor = true;
    expect(c.favor()).toBe(300);
    c.entregar();
    expect(enviado).toEqual({ pendiente_pago: true, saldo_favor: 300 });
  });

  it('cobra lo que falta en efectivo, con cambio, al turno abierto', async () => {
    const c = await montar(porPreparar);
    expect(c.metodoId).toBe(1);
    expect(c.turnoId).toBe(70);
    c.recibido = 2000;
    expect(c.cambio()).toBe(500);
    c.entregar();
    expect(enviado).toEqual({ pagos: [{ metodo_pago_id: 1, monto: 2000 }], sesion_caja_id: 70, a_credito: undefined });
  });

  // HASTA DOS FORMAS DE PAGO (2026-10-23, usuario: "que se puedan seleccionar hasta 2
  // métodos de pago"): efectivo, transferencia o a crédito, solos o de dos en dos.
  it('transferencia y crédito: paga una parte hoy y el resto va a crédito con sus días', async () => {
    const c = await montar(porPreparar);
    // Faltan $1,500.00.
    c.cambiarForma('transferencia_credito');
    expect(c.motivo()).toBe('Pon cuánto paga hoy por transferencia.');
    c.parte = 500;
    expect(c.aCredito()).toBe(1000);
    expect(c.aCobrar()).toBe(500);
    expect(c.llevaTransferencia()).toBe(true);
    expect(c.llevaEfectivo()).toBe(false);
    expect(c.ayudaParte()).toBe('El resto, $1,000.00, va a crédito.');
    expect(c.resumenCredito()).toBe('Hoy paga $500.00 por transferencia y $1,000.00 van a su cuenta de crédito.');
    expect(c.motivo()).toBeNull();
    c.entregar();
    // Lo que se fía va con sus días: se proponen 15 (2026-10-20).
    expect(enviado).toEqual({ pagos: [{ metodo_pago_id: 2, monto: 500 }], sesion_caja_id: undefined, a_credito: 1000, dias_credito: 15 });
    c.diasCredito = 0;
    expect(c.motivo()).toContain('a cuántos días');
  });

  it('efectivo y crédito: el efectivo con su cambio entra al turno y el resto va a crédito', async () => {
    const c = await montar(porPreparar);
    c.cambiarForma('efectivo_credito');
    expect(c.motivo()).toBe('Pon cuánto paga hoy en efectivo.');
    c.parte = 1500;
    expect(c.motivo()).toContain('elige solo Efectivo');
    c.parte = 600;
    expect(c.enEfectivo()).toBe(600);
    expect(c.aCredito()).toBe(900);
    c.recibido = 500;
    expect(c.motivo()).toBe('Recibió menos de lo que va en efectivo ($600.00).');
    c.recibido = 1000;
    expect(c.cambio()).toBe(400);
    c.diasCredito = 30;
    expect(c.motivo()).toBeNull();
    c.entregar();
    expect(enviado).toEqual({
      pagos: [{ metodo_pago_id: 1, monto: 1000 }], sesion_caja_id: 70, a_credito: 900, dias_credito: 30,
    });
  });

  it('todo a crédito: no se cobra nada hoy', async () => {
    const c = await montar(porPreparar);
    c.cambiarForma('credito');
    expect(c.aCredito()).toBe(1500);
    expect(c.aCobrar()).toBe(0);
    expect(c.resumenCredito()).toBe('Los $1,500.00 van a su cuenta de crédito.');
    c.entregar();
    expect(enviado).toEqual({ pagos: undefined, sesion_caja_id: undefined, a_credito: 1500, dias_credito: 15 });
  });

  it('cambiar de forma borra la parte que se tecleó para la otra', async () => {
    const c = await montar(porPreparar);
    c.cambiarForma('mixto');
    c.parte = 700;
    c.cambiarForma('efectivo_credito');
    expect(c.parte).toBeNull();
  });

  it('cobra parte y parte: transferencia y el resto en efectivo, con cambio (2026-10-21)', async () => {
    const c = await montar(porPreparar);
    // Faltan $1,500.00.
    expect(c.permiteMixto()).toBe(true);
    c.cambiarForma('mixto');
    expect(c.motivo()).toBe('Pon cuánto paga por transferencia.');
    c.parte = 2000;
    expect(c.motivo()).toContain('a lo más $1,500.00');
    c.parte = 600;
    expect(c.enEfectivo()).toBe(900);
    expect(c.llevaTransferencia()).toBe(true);
    expect(c.llevaEfectivo()).toBe(true);
    c.recibido = 500;
    expect(c.motivo()).toBe('Recibió menos de lo que va en efectivo ($900.00).');
    c.recibido = 1000;
    expect(c.cambio()).toBe(100);
    expect(c.motivo()).toBeNull();
    c.entregar();
    expect(enviado).toEqual({
      pagos: [{ metodo_pago_id: 2, monto: 600 }, { metodo_pago_id: 1, monto: 1000 }],
      sesion_caja_id: 70, a_credito: undefined,
    });
  });

  it('a cuántos días: solo se escribe el número, sin botones (2026-10-21)', async () => {
    const c = await montar(porPreparar);
    // Para mirar la ventana hace falta su fixture: se crea otra igual.
    const f = TestBed.createComponent(EntregarPedidoModal);
    f.componentRef.setInput('pedido', porPreparar);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.cambiarForma('credito');
    f.detectChanges();
    const plazo = (f.nativeElement as HTMLElement).querySelector('app-plazo-credito')!;
    expect(plazo.querySelectorAll('button').length).toBe(0);
    expect(plazo.textContent).not.toContain('30 días');
    const campo = plazo.querySelector<HTMLInputElement>('input[type=number]')!;
    expect(campo).not.toBeNull();
    expect(plazo.querySelector('label')!.getAttribute('for')).toBe(campo.id);
    expect(c.diasCredito).toBe(15);
  });

  it('la lista ofrece una forma o dos, y sin permiso de vender a crédito no ofrece el crédito', async () => {
    const opciones = (f: { nativeElement: HTMLElement }) =>
      [...f.nativeElement.querySelectorAll('select[name="metodo"] option')].map((o) => o.textContent?.trim());
    await montar(porPreparar);
    let f = TestBed.createComponent(EntregarPedidoModal);
    f.componentRef.setInput('pedido', porPreparar);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(opciones(f)).toEqual([
      'Efectivo', 'Transferencia', 'A crédito', 'Efectivo y transferencia', 'Efectivo y crédito', 'Transferencia y crédito',
    ]);
    TestBed.resetTestingModule();

    const c = await montar(porPreparar, []);
    expect(c.puedeFiar()).toBe(false);
    f = TestBed.createComponent(EntregarPedidoModal);
    f.componentRef.setInput('pedido', porPreparar);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(opciones(f)).toEqual(['Efectivo', 'Transferencia', 'Efectivo y transferencia']);
    // Aunque llegara a elegirse, no deja entregar.
    c.cambiarForma('credito');
    expect(c.motivo()).toContain('Vender a crédito');
  });

  it('se entrega como nota pendiente de pago: no cobra nada ahora (2026-10-13)', async () => {
    const c = await montar(porPreparar);
    c.comoNota = true;
    expect(c.motivo()).toBeNull();
    c.entregar();
    expect(enviado).toEqual({ pendiente_pago: true });
  });

  it('pesó menos de lo que pagó: se le devuelve del turno', async () => {
    const c = await montar({ ...porPreparar, pagado: 2000, falta: 0, a_favor: 64 });
    expect(c.aFavor()).toBe(64);
    expect(c.motivo()).toBeNull();
    c.entregar();
    expect(enviado).toEqual({ sesion_caja_id: 70 });
  });

  it('ya pagado: solo se entrega', async () => {
    const c = await montar({ ...porPreparar, pagado: 2000, falta: 0 });
    expect(c.aCobrar()).toBe(0);
    c.entregar();
    expect(enviado).toEqual({ pagos: undefined, sesion_caja_id: undefined, a_credito: undefined });
  });
});

describe('ModificarPedidoModal', () => {
  let enviado: ModificarPedidoInput | null = null;
  const pedido = {
    id: 1, numero_pedido: 'POS-1-AAAA', canal: 'punto_venta', metodo_entrega: 'recoger', estado: 'en_preparacion',
    subtotal: '4700.00', descuento: '0.00', impuestos: '0.00', costo_envio: '0.00', total: '4700.00', creado_en: '2026-10-06 10:00:00',
    detalle: [
      {
        id: 10, variante_id: 5, sku: 'ROJO', descripcion: 'ROJO · Paquete', producto: 'ROJO', calibre: '2/30',
        tipo_presentacion: 'paquete', peso_kg: '19.000', cantidad: '38.000', precio_unitario: '100.00',
        descuento: '0.00', impuesto: '0.00', subtotal: '3800.00', bultos: [],
      },
      {
        id: 11, variante_id: 6, sku: 'ROJO-CONO', descripcion: 'ROJO · Cono', producto: 'ROJO', calibre: '2/30',
        tipo_presentacion: 'cono', cantidad: '9.000', piezas: 6, precio_unitario: '100.00',
        descuento: '0.00', impuesto: '0.00', subtotal: '900.00', bultos: [],
      },
    ],
  } as unknown as Pedido;
  const rojo = { id: 5, producto: 'ROJO', calibre: '2/30', tipo_presentacion: 'paquete', precio: '100' };
  const azul = { id: 7, producto: 'AZUL', calibre: '2/30', tipo_presentacion: 'paquete', precio: '120', aqui: { cantidad: 40, paquetes: 2 } };
  const resueltos: Record<string, unknown> = {
    A1: { variante: rojo, bulto: { id: 1, variante_id: 5, codigo: 'A1', peso_kg: '19.200', estado: 'disponible' } },
    AZ1: { variante: azul, bulto: { id: 3, variante_id: 7, codigo: 'AZ1', peso_kg: '20', estado: 'disponible' } },
    AP: { variante: rojo, bulto: { id: 4, variante_id: 5, codigo: 'AP', peso_kg: '19', estado: 'apartado', consumido_folio: 'POS-9-ZZZZ' } },
    BG: { variante: rojo, bulto: { id: 5, variante_id: 5, codigo: 'BG', peso_kg: '19.95', estado: 'disponible', almacen_id: 2, almacen: 'Almacén General' } },
  };

  async function montar() {
    enviado = null;
    await TestBed.configureTestingModule({
      imports: [ModificarPedidoModal],
      providers: [{ provide: TransferenciasService, useValue: transferenciasFalso() }, 
        {
          provide: VentasService,
          useValue: {
            obtenerPedido: () => of(pedido),
            modificarPedido: (_id: number, body: ModificarPedidoInput) => {
              enviado = body;
              return of({ ...pedido, cambios: [] });
            },
          },
        },
        {
          provide: InventarioService,
          useValue: { resolverCodigo: (c: string) => of(resueltos[c]), buscarVariantes: () => of([azul]) },
        },
        { provide: ConfirmacionService, useValue: { pedir: () => Promise.resolve(true) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(ModificarPedidoModal);
    f.componentRef.setInput('pedido', { ...porPreparar, id: 1, numero_pedido: 'POS-1-AAAA', total: 4700, pagado: 500 });
    f.detectChanges();
    await f.whenStable();
    return f.componentInstance;
  }

  function escanear(c: ModificarPedidoModal, ...codigos: string[]) {
    for (const cod of codigos) {
      c.codigo = cod;
      c.leer();
    }
  }

  afterEach(() => TestBed.resetTestingModule());

  it('abre con lo que lleva, y se le quita un hilo', async () => {
    const c = await montar();
    expect(c.lineas().length).toBe(2);
    expect(c.total()).toBe(4700);
    c.quitarLinea(c.lineas()[1]);
    expect(c.total()).toBe(3800);
    c.guardar();
    expect(enviado!.lineas).toEqual([{ detalle_id: 10, codigos: [], cantidad: 38 }]);
  });

  it('se le agrega un hilo buscándolo, y se escanean paquetes', async () => {
    const c = await montar();
    c.q = 'azul';
    c.buscar();
    c.agregar(c.resultados()[0] as never);
    expect(c.lineas().length).toBe(3);
    expect(c.motivo()).toContain('AZUL 2/30');
    escanear(c, 'AZ1', 'A1');
    // El azul con su paquete; el rojo deja los kilos tecleados y toma los de su paquete.
    expect(c.kgDe(c.lineas()[2])).toBe(20);
    expect(c.kgDe(c.lineas()[0])).toBe(19.2);
    escanear(c, 'AP');
    expect(c.error()).toContain('apartado para otro pedido');
    c.guardar();
    expect(enviado!.lineas).toEqual([
      { detalle_id: 10, codigos: ['A1'], cantidad: 19.2 },
      { detalle_id: 11, codigos: [], cantidad: 9, piezas: 6 },
      { variante_id: 7, codigos: ['AZ1'], cantidad: 20 },
    ]);
  });

  it('un paquete que está en otro almacén no entra: se pide uno de la tienda del pedido', async () => {
    const c = await montar();
    escanear(c, 'BG');
    expect(c.error()).toBe('El paquete BG sí existe, pero está en «Almacén General», no en «Tienda»: toma uno que esté en esta tienda.');
    expect(c.lineas()[0].paquetes.length).toBe(0);
  });

  it('cambia la entrega: con el chofer pide a dónde', async () => {
    const c = await montar();
    c.entrega = 'envio';
    expect(c.motivo()).toContain('di a dónde');
    c.direccion = 'Av. Hidalgo 120';
    c.costoEnvio = 50;
    expect(c.total()).toBe(4750);
    c.guardar();
    expect(enviado).toEqual(jasmine.objectContaining({ metodo_entrega: 'envio', entrega_direccion: 'Av. Hidalgo 120', costo_envio: 50 }));
  });
});
