import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MinimoModal } from './minimo-modal';
import { InventarioService } from '../../../core/services/inventario.service';
import { StockItem } from '../../../core/models/inventario.models';

/**
 * Lo que importa del mínimo:
 *   · se captura en paquetes y se guarda en kilos, con el peso REAL de los bultos;
 *   · cambiar el mínimo no borra el máximo ni la ubicación que ya tenía;
 *   · "Quitar mínimo" lo deja en cero, que es "sin alerta";
 *   · el input se lee en ngOnInit, o el modal abre en blanco.
 */
describe('MinimoModal', () => {
  function fila(extra: Partial<StockItem> = {}): StockItem {
    return {
      id: 1, variante_id: 5, sku: 'NEGRO', producto: 'NEGRO', calibre: '2/30',
      tipo_presentacion: 'paquete', peso_kg: '19.094',
      almacen_id: 3, almacen: 'Bodega',
      cantidad: '95.985', cantidad_reservada: '0.000', disponible: '95.985',
      stock_minimo: '0.000', stock_maximo: '500.000', ubicacion_fisica: 'Pasillo 2',
      actualizado_en: '2026-10-01 10:00:00',
      ...extra,
    } as StockItem;
  }

  /** 5 bultos que pesan en promedio 19.197 kg, no el nominal de 19.094. */
  const equivalencia = {
    sku: 'NEGRO', producto: 'NEGRO', peso_nominal: '19.094',
    disponible: {
      paquetes: 5, kg_en_bultos: 95.985, peso_promedio: 19.197,
      peso_min: 18.5, peso_max: 19.8, kg_inventario: 95.985, kg_apartado: 0, kg_libre: 95.985,
    },
    peso_referencia: 19.197,
    referencia_nominal: false,
    sugerencia: null,
  };

  let enviado: Record<string, unknown> | null = null;
  const invFalso = {
    equivalenciaPaquetes: () => of(equivalencia),
    configurar: (body: Record<string, unknown>) => {
      enviado = body;
      return of({});
    },
  };

  async function montar(f: StockItem) {
    await TestBed.configureTestingModule({
      imports: [MinimoModal],
      providers: [{ provide: InventarioService, useValue: invFalso }],
    }).compileComponents();
    const fixture = TestBed.createComponent(MinimoModal);
    fixture.componentRef.setInput('fila', f);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => (enviado = null));
  afterEach(() => TestBed.resetTestingModule());

  it('un paquete sin mínimo se captura en paquetes', async () => {
    const c = (await montar(fila())).componentInstance;
    expect(c.unidad).toBe('paq');
    expect(c.cantidad).toBeNull();
  });

  it('traduce paquetes a kilos con el peso promedio REAL, no el nominal', async () => {
    const c = (await montar(fila())).componentInstance;
    c.cantidad = 3;
    expect(c.kilos()).toBe(57.591);
  });

  it('guarda en kilos sin borrar el máximo ni la ubicación', async () => {
    const fixture = await montar(fila());
    const c = fixture.componentInstance;
    let guardo = false;
    c.guardado.subscribe(() => (guardo = true));

    c.cantidad = 3;
    c.guardar();

    expect(enviado).toEqual({
      variante_id: 5, almacen_id: 3, stock_minimo: 57.591,
      stock_maximo: 500, ubicacion_fisica: 'Pasillo 2',
    });
    expect(guardo).toBe(true);
  });

  it('un mínimo ya capturado abre tal cual, en kilos', async () => {
    const c = (await montar(fila({ stock_minimo: '40.000' }))).componentInstance;
    expect(c.unidad).toBe('kg');
    expect(c.cantidad).toBe(40);
  });

  it('avisa si con lo que hay hoy ya queda bajo el mínimo', async () => {
    const c = (await montar(fila())).componentInstance;
    c.cantidad = 6; // 6 paquetes ≈ 115 kg y hay 95.985
    expect(c.quedaBajo()).toBe(true);
    c.cantidad = 2;
    expect(c.quedaBajo()).toBe(false);
  });

  it('"Quitar mínimo" lo deja en cero: sin alerta', async () => {
    const c = (await montar(fila({ stock_minimo: '40.000' }))).componentInstance;
    c.quitar();
    expect(enviado?.['stock_minimo']).toBe(0);
  });

  it('un cono se captura en kilos y no pide equivalencia de paquetes', async () => {
    const llamada = spyOn(invFalso, 'equivalenciaPaquetes').and.callThrough();
    const c = (await montar(fila({ tipo_presentacion: 'cono', sku: 'NEGRO-CONO' }))).componentInstance;
    expect(c.unidad).toBe('kg');
    expect(llamada).not.toHaveBeenCalled();
    c.cantidad = 12.5;
    c.guardar();
    expect(enviado?.['stock_minimo']).toBe(12.5);
  });

  it('sin cantidad no guarda y lo dice', async () => {
    const c = (await montar(fila())).componentInstance;
    c.guardar();
    expect(enviado).toBeNull();
    expect(c.error()).toBeTruthy();
  });
});
