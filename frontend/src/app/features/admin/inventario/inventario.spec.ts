import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Inventario } from './inventario';
import { InventarioService } from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { StockItem } from '../../../core/models/inventario.models';

/**
 * Lo que se comprueba es la lectura de la pantalla: que las presentaciones del
 * mismo hilo queden JUNTAS (antes salían como renglones sueltos con el nombre
 * repetido y parecían duplicados), que la gráfica sume paquete + cono del mismo
 * hilo, que los porcentajes cuadren y que cada puesto vea solo las acciones que
 * puede hacer.
 *
 * Los datos son los de la base real del 2026-07-28.
 */
describe('Inventario', () => {
  const almacenes = [
    {
      almacen_id: 1,
      nombre: 'Bodega principal',
      es_punto_venta: 0,
      es_matriz: 1,
      es_tienda_linea: 0,
      skus: 5,
      kilos: '3562.640',
      piezas: '0',
      kilos_paquete: '3562.640',
      kilos_cono: '0.000',
      alertas: 0,
    },
    {
      almacen_id: 3,
      nombre: 'tienda moroleon',
      es_punto_venta: 1,
      es_matriz: 0,
      es_tienda_linea: 0,
      skus: 0,
      kilos: '0.000',
      piezas: '0',
      kilos_paquete: '0.000',
      kilos_cono: '0.000',
      alertas: 0,
    },
    {
      almacen_id: 2,
      nombre: 'Tienda principal',
      es_punto_venta: 1,
      es_matriz: 0,
      es_tienda_linea: 1,
      skus: 8,
      kilos: '3057.390',
      piezas: '0',
      kilos_paquete: '2952.650',
      kilos_cono: '104.740',
      alertas: 0,
    },
  ];

  const filas = [
    {
      variante_id: 6,
      sku: 'AMARILLO',
      producto_id: 6,
      producto: 'AMARILLO',
      calibre: '1/30',
      material: 'ACRILAN',
      linea: 'Chino',
      presentacion: 'Paquete',
      tipo_presentacion: 'paquete',
      peso_kg: '22.575',
      unidad: 'kg',
      existencias: { '1': { cantidad: '248.380', bajo_minimo: false } },
      total: 248.38,
    },
    {
      variante_id: 7,
      sku: 'AMARILLO-CONO',
      producto_id: 6,
      producto: 'AMARILLO',
      calibre: '1/30',
      material: 'ACRILAN',
      linea: 'Chino',
      presentacion: 'Cono',
      tipo_presentacion: 'cono',
      peso_kg: null,
      unidad: 'kg',
      existencias: { '2': { cantidad: '23.320', bajo_minimo: false } },
      total: 23.32,
    },
    {
      variante_id: 8,
      sku: 'BLANCO',
      producto_id: 7,
      producto: 'BLANCO',
      calibre: '2/30',
      material: 'ACRILAN',
      linea: 'Nacional',
      presentacion: 'Paquete',
      tipo_presentacion: 'paquete',
      peso_kg: '19.088',
      unidad: 'kg',
      existencias: {
        '1': { cantidad: '1308.110', bajo_minimo: false },
        '2': { cantidad: '200.000', bajo_minimo: false },
      },
      total: 1508.11,
    },
    {
      variante_id: 9,
      sku: 'SIN-STOCK',
      producto_id: 8,
      producto: 'BEIGE',
      calibre: '1/30',
      material: 'ACRILAN',
      linea: 'Nacional',
      presentacion: 'Paquete',
      tipo_presentacion: 'paquete',
      peso_kg: '22.239',
      unidad: 'kg',
      existencias: { '3': { cantidad: '0.000', bajo_minimo: false } },
      total: 0,
    },
    // El MISMO color en otro calibre es OTRO producto: no se pueden mezclar.
    {
      variante_id: 20,
      sku: 'MARINO-OSCURO',
      producto_id: 1,
      producto: 'MARINO OSCURO',
      calibre: '1/30',
      material: 'ACRILAN',
      linea: 'Nacional',
      presentacion: 'Paquete',
      tipo_presentacion: 'paquete',
      peso_kg: '19.094',
      unidad: 'kg',
      existencias: { '1': { cantidad: '100.000', bajo_minimo: false } },
      total: 100,
    },
    {
      variante_id: 21,
      sku: 'MARINO-OSCURO-2',
      producto_id: 2,
      producto: 'MARINO OSCURO',
      calibre: '2/30',
      material: 'ACRILAN',
      linea: 'Turco',
      presentacion: 'Paquete',
      tipo_presentacion: 'paquete',
      peso_kg: '19.094',
      unidad: 'kg',
      existencias: { '2': { cantidad: '50.000', bajo_minimo: false } },
      total: 50,
    },
  ];

  /** Un renglón de existencias (presentación + almacén), como lo da GET /inventario. */
  function renglon(
    id: number,
    variante_id: number,
    producto_id: number,
    producto: string,
    calibre: string,
    tipo: string,
    almacen_id: number,
    almacen: string,
    cantidad: string,
    extra: Partial<StockItem> = {}
  ): StockItem {
    return {
      id,
      variante_id,
      producto_id,
      producto,
      calibre,
      sku: tipo === 'cono' ? producto + '-CONO' : producto,
      material: 'ACRILAN',
      linea: 'Nacional',
      tipo_presentacion: tipo,
      peso_kg: tipo === 'paquete' ? '19.088' : null,
      almacen_id,
      almacen,
      cantidad,
      cantidad_reservada: '0.000',
      disponible: cantidad,
      stock_minimo: '0.000',
      actualizado_en: '2026-10-01 10:00:00',
      ...extra,
    } as StockItem;
  }

  const stock: StockItem[] = [
    // AMARILLO: el cono va antes en el arreglo a propósito; la tabla lo pone después.
    renglon(2, 7, 6, 'AMARILLO', '1/30', 'cono', 2, 'Tienda principal', '23.320'),
    renglon(1, 6, 6, 'AMARILLO', '1/30', 'paquete', 1, 'Bodega principal', '248.380'),
    renglon(3, 8, 7, 'BLANCO', '2/30', 'paquete', 1, 'Bodega principal', '1308.110'),
    renglon(4, 8, 7, 'BLANCO', '2/30', 'paquete', 2, 'Tienda principal', '200.000'),
    // En cero y sin mínimo: no dice nada y se oculta por omisión.
    renglon(5, 9, 8, 'BEIGE', '1/30', 'paquete', 3, 'tienda moroleon', '0.000'),
    // En cero PERO con mínimo: es justo el que hay que surtir, se ve siempre.
    renglon(6, 10, 9, 'ROJO', '2/30', 'paquete', 2, 'Tienda principal', '0.000', {
      stock_minimo: '40.000',
    }),
    // El MISMO color en otro calibre es OTRO producto: no se pueden mezclar.
    renglon(7, 20, 1, 'MARINO OSCURO', '1/30', 'paquete', 1, 'Bodega principal', '100.000'),
    renglon(8, 21, 2, 'MARINO OSCURO', '2/30', 'paquete', 2, 'Tienda principal', '50.000'),
  ];

  /** Lo que se pidió al servidor la última vez, para ver los filtros. */
  let pedido: Record<string, unknown> | null = null;

  const invFalso = {
    almacenes: () => of([]),
    resumen: () => of({ almacenes, filas, truncado: false, total_variantes: 4 }),
    stock: (f: Record<string, unknown>) => {
      pedido = f;
      return of({ items: stock, total: stock.length, page: 1, limit: 100, paginas: 1 });
    },
    alertas: () => of([]),
    buscarVariantes: () => of([]),
    conversiones: () => of({ items: [], total: 0, page: 1, limit: 20, paginas: 1 }),
  };

  /** Los permisos del puesto; null = todos (el administrador). */
  let permisos: string[] | null = null;
  const authFalso = { puede: (p: string) => permisos === null || permisos.includes(p) };

  async function montarFixture() {
    await TestBed.configureTestingModule({
      imports: [Inventario],
      // La pantalla trae el enlace al Kardex, así que necesita router.
      providers: [
        { provide: InventarioService, useValue: invFalso },
        { provide: AuthService, useValue: authFalso },
        provideRouter([]),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Inventario);
    fixture.detectChanges();
    return fixture;
  }

  async function montar() {
    return (await montarFixture()).componentInstance;
  }

  beforeEach(() => {
    permisos = null;
    pedido = null;
  });
  afterEach(() => TestBed.resetTestingModule());

  it('agrupa las presentaciones del mismo hilo, con el nombre una sola vez', async () => {
    const c = await montar();
    const grupos = c.grupos();

    // BEIGE está en cero y sin mínimo: se oculta por omisión. Los dos MARINO
    // OSCURO son productos distintos (calibres distintos) y NO se juntan.
    expect(grupos.map((g) => c.nombreCompleto(g))).toEqual([
      'BLANCO 2/30',
      'AMARILLO 1/30',
      'MARINO OSCURO 1/30',
      'MARINO OSCURO 2/30',
      'ROJO 2/30',
    ]);

    const amarillo = grupos.find((g) => g.producto === 'AMARILLO')!;
    expect(amarillo.filas.length).toBe(2);
    // Paquete primero, cono después: es el orden en que pasa en la tienda.
    expect(amarillo.filas[0].tipo_presentacion).toBe('paquete');
    expect(amarillo.filas[1].tipo_presentacion).toBe('cono');
    // 248.38 + 23.32
    expect(amarillo.total).toBe(271.7);

    // Los dos renglones de BLANCO (bodega y tienda) van juntos y suman.
    const blanco = grupos.find((g) => g.producto === 'BLANCO')!;
    expect(blanco.filas.map((f) => f.almacen)).toEqual(['Bodega principal', 'Tienda principal']);
    expect(blanco.total).toBe(1508.11);
  });

  it('lo que está en cero sin mínimo se oculta; con mínimo se ve siempre', async () => {
    const c = await montar();
    const nombres = () => c.grupos().map((g) => g.producto);
    expect(nombres()).not.toContain('BEIGE');
    expect(nombres()).toContain('ROJO');

    c.soloConStock.set(false);
    expect(nombres()).toContain('BEIGE');
  });

  it('pide el último movimiento y manda el filtro de la vista', async () => {
    const c = await montar();
    expect(pedido?.['ultimo_movimiento']).toBe(true);

    c.vista = 'apartado';
    c.cargarStock();
    expect(pedido?.['apartado']).toBe(true);
    expect(pedido?.['bajo_stock']).toBeUndefined();

    c.vista = 'minimo';
    c.cargarStock();
    expect(pedido?.['bajo_stock']).toBe(true);
    expect(pedido?.['apartado']).toBeUndefined();
  });

  it('la gráfica suma paquete y cono del mismo hilo y ordena de mayor a menor', async () => {
    const c = await montar();
    const g = c.grafica();

    // La etiqueta lleva el CALIBRE: sin él, los dos MARINO OSCURO se verían como
    // dos barras idénticas y no se sabría cuál es cuál.
    expect(g.map((b) => b.label)).toEqual([
      'BLANCO 2/30',
      'AMARILLO 1/30',
      'MARINO OSCURO 1/30',
      'MARINO OSCURO 2/30',
    ]);
    expect(g[0].total).toBe(1508.11);
    expect(g[1].total).toBe(271.7);
    // Y el material y la línea van junto al nombre.
    expect(g[0].detalle).toBe('ACRILAN · Nacional');
    expect(g[3].detalle).toBe('ACRILAN · Turco');
    // El largo se mide contra el primero, que está a la vista.
    expect(g[0].ancho).toBe(1);
    expect(g[1].ancho).toBeCloseTo(271.7 / 1508.11, 3);
  });

  it('más de ocho hilos no caben: dice cuántos quedaron fuera y cuánto suman', async () => {
    const c = await montar();
    const muchas = Array.from({ length: 10 }, (_, i) => ({
      ...filas[0],
      variante_id: 100 + i,
      producto_id: 100 + i,
      producto: 'HILO ' + i,
      existencias: { '1': { cantidad: String(10 + i), bajo_minimo: false } },
      total: 10 + i,
    }));
    c.resumen.set({
      almacenes: almacenes as never,
      filas: muchas as never,
      truncado: false,
      total_variantes: 10,
    });

    expect(c.grafica().length).toBe(8);
    // Los dos más chicos: 10 + 11 kg.
    expect(c.restoGrafica()).toEqual({ hilos: 2, kilos: 21 });
  });

  it('el total del hilo se lee como porcentaje del inventario, no contra el mayor', async () => {
    const c = await montar();
    // 1,508.11 de 6,620.03 kg
    expect(c.porcentajeDelTotal(1508.11)).toBe(23);
    expect(c.porcentajeDelTotal(c.kilosTotales())).toBe(100);
  });

  it('cada tramo de la barra es un almacén, y solo los que tienen algo', async () => {
    const c = await montar();
    const blanco = c.grafica().find((b) => b.label === 'BLANCO 2/30')!;

    expect(blanco.segmentos.map((s) => [s.serie, s.value])).toEqual([
      ['Bodega principal', 1308.11],
      ['Tienda principal', 200],
    ]);

    // El AMARILLO tiene el paquete en la bodega y el cono en la tienda.
    const amarillo = c.grafica().find((b) => b.label === 'AMARILLO 1/30')!;
    expect(amarillo.segmentos.map((s) => [s.serie, s.value])).toEqual([
      ['Bodega principal', 248.38],
      ['Tienda principal', 23.32],
    ]);
  });

  it('el almacén vacío no es una serie de la gráfica, pero sí una tarjeta', async () => {
    const c = await montar();
    // "tienda moroleon" tiene 0 kg: no pinta y no gasta un color.
    expect(c.seriesGrafica().map((s) => s.nombre)).toEqual([
      'Bodega principal',
      'Tienda principal',
    ]);
    // Los tres primeros almacenes usan los tres colores validados, sin "otros".
    expect(c.seriesGrafica().every((s) => !s.otros)).toBe(true);
    expect(c.leyenda().map((l) => l.nombre)).toEqual(['Bodega principal', 'Tienda principal']);
    expect(c.tarjetas().map((t) => t.nombre)).toContain('tienda moroleon');
  });

  it('los porcentajes de las tarjetas suman el total de la tienda', async () => {
    const c = await montar();
    // 3,562.64 + 0 + 3,057.39
    expect(c.kilosTotales()).toBeCloseTo(6620.03, 2);
    expect(c.porcentaje(almacenes[0] as never)).toBe(54);
    expect(c.porcentaje(almacenes[1] as never)).toBe(0);
    expect(c.porcentaje(almacenes[2] as never)).toBe(46);
  });

  it('la tarjeta dice qué papel juega el almacén y cuánto ya está enconado', async () => {
    const c = await montar();
    const [bodega, moroleon, tienda] = c.tarjetas();

    expect(bodega.tipo).toBe('Matriz · bodega');
    expect(bodega.desglose).toBe('Todo en paquete');
    // AMARILLO, BLANCO y MARINO OSCURO 1/30: hilos, no presentaciones.
    expect(bodega.hilos).toBe(3);

    expect(moroleon.tipo).toBe('Sucursal con mostrador');
    expect(moroleon.kilos).toBe(0);

    // La Tienda principal surte a la tienda en línea, que está apagada: no dice "web".
    expect(tienda.tipo).toBe('Sucursal con mostrador');
    // 104.74 de 3,057.39 kg ya son conos.
    expect(tienda.desglose).toBe('97% paquete · 3% enconado');
  });

  it('rotula la presentación sin hacer adivinar el SKU y la traduce a piezas', async () => {
    const c = await montar();
    expect(c.etiquetaPresentacion(stock[1])).toBe('Paquete');
    expect(c.etiquetaPresentacion(stock[0])).toBe('Cono');
    // 248.38 kg / 19.088 kg ≈ 13 paquetes
    expect(c.equivalencia(stock[1])).toBe('≈ 13 paquetes');
  });

  it('con todos los permisos ofrece las dos acciones y el kardex', async () => {
    const fixture = await montarFixture();
    const cabeza = (fixture.nativeElement as HTMLElement).querySelector('.page-head')!.textContent!;
    expect(cabeza).toContain('Bajar conos a mostrador');
    expect(cabeza).toContain('Ajuste / merma');
    expect(cabeza).toContain('Ver kardex');
  });

  it('esconde lo que el puesto no puede hacer, pero la columna del mínimo sigue', async () => {
    permisos = ['ver:inventario'];
    const fixture = await montarFixture();
    const el = fixture.nativeElement as HTMLElement;
    const cabeza = el.querySelector('.page-head')!.textContent!;
    expect(cabeza).not.toContain('Bajar conos a mostrador');
    expect(cabeza).not.toContain('Ajuste / merma');
    expect(cabeza).not.toContain('Ver kardex');
    // El mínimo se captura con ver:inventario, que ya tiene quien ve la pantalla.
    expect(el.querySelector('table.detalle')!.textContent).toContain('Mínimo');
    expect(el.querySelectorAll('td.minimo button').length).toBeGreaterThan(0);
  });
});
