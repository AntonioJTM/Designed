import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { EncargosPantalla } from './encargos';
import { EntregarPedidoModal } from './entregar-modal';
import { PrepararPedidoModal } from './preparar-modal';
import { InventarioService } from '../../../core/services/inventario.service';
import { VentasService } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { Encargo, Encargos, Pedido } from '../../../core/models/ventas.models';
import { hoyLocal } from '../../../shared/fecha.pipe';

/**
 * PEDIDOS de clientes (2026-10-06):
 *   · la lista dice qué paso lleva cada uno y ofrece el siguiente (salió con el
 *     chofer); el que lo recoge el cliente no "sale con el chofer"; queda listo
 *     al PREPARARLO (escanear paquetes, pesar conos), no con un botón;
 *   · entregar cobra lo que falta (en efectivo con cambio y a un turno), o fía
 *     el resto; ya pagado, solo entrega.
 */
const base = {
  numero_pedido: 'POS-1-AAAA', metodo_entrega: 'recoger', entrega_direccion: null, entrega_para: null,
  total: 2000, costo_envio: '0.00', notas: null, creado_en: '2026-10-06 10:00:00', almacen_id: 1, almacen: 'Tienda',
  cliente_id: 5, cliente: 'Mercería La Esperanza', nombre_comercial: 'Doña Chela', telefono: '4450000000',
  vendedor: 'Yessica', pagado: 500, falta: 1500, kg: 20,
  hilos: [{ hilo: 'ROJO 2/30', tipo_presentacion: 'paquete', kg: 20, piezas: null, paquetes: 1 }],
};
const porPreparar = { ...base, id: 1, estado: 'en_preparacion' } as Encargo;
const listoChofer = { ...base, id: 2, estado: 'listo', metodo_entrega: 'envio', entrega_direccion: 'Calle 1' } as Encargo;
const listoRecoge = { ...base, id: 3, estado: 'listo' } as Encargo;

describe('EncargosPantalla', () => {
  let cambios: { id: number; estado: string }[] = [];

  async function montar() {
    cambios = [];
    const datos: Encargos = { items: [porPreparar, listoChofer, listoRecoge], conteo: { en_preparacion: 1, listo: 2, enviado: 0 }, por_cobrar: 4500 };
    await TestBed.configureTestingModule({
      imports: [EncargosPantalla],
      providers: [
        provideRouter([]),
        {
          provide: VentasService,
          useValue: {
            encargos: () => of(datos),
            cambiarEstado: (id: number, estado: string) => {
              cambios.push({ id, estado });
              return of({});
            },
          },
        },
        { provide: AuthService, useValue: { puede: () => true } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(EncargosPantalla);
    f.detectChanges();
    return f;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('dice el paso de cada uno y ofrece el siguiente', async () => {
    const f = await montar();
    const c = f.componentInstance;
    expect(c.nombrePaso('en_preparacion')).toBe('Por preparar');
    // Por preparar no "avanza": se prepara (ventana aparte).
    expect(c.siguiente(porPreparar)).toBeNull();
    expect(c.siguiente(listoChofer)?.texto).toBe('Salió con el chofer');
    // Lo recoge el cliente: después de listo, solo se entrega.
    expect(c.siguiente(listoRecoge)).toBeNull();
    expect(c.queLleva(porPreparar.hilos[0])).toBe('ROJO 2/30 · 20 kg (≈ 1 paquete)');
    // Ya escaneados: son los que van, sin "≈".
    expect(c.queLleva({ ...porPreparar.hilos[0], escaneados: 2, paquetes: 2 })).toBe('ROJO 2/30 · 20 kg · 2 paquetes');
    // El por preparar ofrece "Preparar" y no "Entregar".
    const fila = (f.nativeElement as HTMLElement).querySelector('tbody tr') as HTMLElement;
    expect(fila.textContent).toContain('Preparar');
    expect(fila.textContent).not.toContain('Entregar');
    expect((f.nativeElement as HTMLElement).textContent).toContain('Doña Chela');
  });

  it('avanzar manda el siguiente paso', async () => {
    const f = await montar();
    f.componentInstance.avanzar(listoChofer, 'enviado');
    expect(cambios).toEqual([{ id: 2, estado: 'enviado' }]);
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
      providers: [
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
        { provide: AuthService, useValue: { puede: (p: string) => permisos.includes(p) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(EntregarPedidoModal);
    f.componentRef.setInput('pedido', pedido);
    f.detectChanges();
    await f.whenStable();
    return f.componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('cobra lo que falta en efectivo, con cambio, al turno abierto', async () => {
    const c = await montar(porPreparar);
    expect(c.metodoId).toBe(1);
    expect(c.turnoId).toBe(70);
    c.recibido = 2000;
    expect(c.cambio()).toBe(500);
    c.entregar();
    expect(enviado).toEqual({ pagos: [{ metodo_pago_id: 1, monto: 2000 }], sesion_caja_id: 70, a_credito: undefined });
  });

  it('si cobra menos, el resto se fía solo si se marca', async () => {
    const c = await montar(porPreparar);
    c.cobra = 500;
    expect(c.motivo()).toContain('Faltan');
    c.fiarResto = true;
    expect(c.motivo()).toBeNull();
    c.metodoId = 2;
    c.entregar();
    expect(enviado).toEqual({ pagos: [{ metodo_pago_id: 2, monto: 500 }], sesion_caja_id: undefined, a_credito: 1000 });
  });

  it('sin permiso de fiar no ofrece fiar', async () => {
    const c = await montar(porPreparar, []);
    c.cobra = 500;
    expect(c.puedeFiar()).toBe(false);
    expect(c.motivo()).toBe('Faltan $1,000.00 por cobrar.');
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

describe('PrepararPedidoModal', () => {
  let enviado: unknown = null;
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
  const rojo = { id: 5, producto: 'ROJO', calibre: '2/30' };
  const resueltos: Record<string, unknown> = {
    A1: { variante: rojo, bulto: { id: 1, variante_id: 5, codigo: 'A1', peso_kg: '19.200', estado: 'disponible' } },
    A2: { variante: rojo, bulto: { id: 2, variante_id: 5, codigo: 'A2', peso_kg: '18.600', estado: 'disponible' } },
    OTRO: { variante: { id: 9, producto: 'NEGRO', calibre: '1/30' }, bulto: { id: 3, variante_id: 9, codigo: 'OTRO', peso_kg: '19', estado: 'disponible' } },
    AP: { variante: rojo, bulto: { id: 4, variante_id: 5, codigo: 'AP', peso_kg: '19', estado: 'apartado', consumido_folio: 'POS-9-ZZZZ' } },
  };

  async function montar() {
    enviado = null;
    await TestBed.configureTestingModule({
      imports: [PrepararPedidoModal],
      providers: [
        {
          provide: VentasService,
          useValue: {
            obtenerPedido: () => of(pedido),
            prepararPedido: (_id: number, lineas: unknown) => {
              enviado = lineas;
              return of({ ...pedido, estado: 'listo' });
            },
          },
        },
        { provide: InventarioService, useValue: { resolverCodigo: (c: string) => of(resueltos[c]) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(PrepararPedidoModal);
    f.componentRef.setInput('pedido', { ...porPreparar, id: 1, numero_pedido: 'POS-1-AAAA', total: 4700, pagado: 500 });
    f.detectChanges();
    await f.whenStable();
    return f.componentInstance;
  }

  function escanear(c: PrepararPedidoModal, ...codigos: string[]) {
    for (const cod of codigos) {
      c.codigo = cod;
      c.leer();
    }
  }

  afterEach(() => TestBed.resetTestingModule());

  it('pide escanear los paquetes y pesar los conos antes de quedar listo', async () => {
    const c = await montar();
    expect(c.lineas().length).toBe(2);
    expect(c.pidio(c.lineas()[0])).toBe('38 kg (≈ 2 paquetes)');
    expect(c.pidio(c.lineas()[1])).toBe('6 conos · ≈ 9 kg');
    expect(c.motivo()).toContain('Escanea los paquetes de ROJO 2/30');
  });

  it('el lector mete cada paquete en su línea y rechaza los que no van', async () => {
    const c = await montar();
    escanear(c, 'A1', 'A2');
    expect(c.lineas()[0].paquetes.map((p) => p.codigo)).toEqual(['A1', 'A2']);
    expect(c.kgDe(c.lineas()[0])).toBe(37.8);
    escanear(c, 'A1');
    expect(c.error()).toContain('ya está en la lista');
    escanear(c, 'OTRO');
    expect(c.error()).toContain('NEGRO 1/30, que no viene en este pedido');
    escanear(c, 'AP');
    expect(c.error()).toContain('apartado para otro pedido');
  });

  it('con el peso real recalcula el total y manda códigos y kilos', async () => {
    const c = await montar();
    escanear(c, 'A1', 'A2');
    expect(c.motivo()).toContain('Pesa los conos');
    c.lineas()[1].kg = 8.6;
    c.lineas()[1].conos = 6;
    expect(c.motivo()).toBeNull();
    // 37.8 kg × $100 + 8.6 kg × $100
    expect(c.total()).toBe(4640);
    c.guardar();
    expect(enviado).toEqual([
      { detalle_id: 10, codigos: ['A1', 'A2'] },
      { detalle_id: 11, cantidad: 8.6, piezas: 6 },
    ]);
  });
});
