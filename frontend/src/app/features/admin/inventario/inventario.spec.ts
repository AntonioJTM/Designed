import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Inventario } from './inventario';
import { InventarioService } from '../../../core/services/inventario.service';

/**
 * Lo que se comprueba es la lectura de la pantalla: que las presentaciones del
 * mismo color queden JUNTAS (antes salían como renglones sueltos con el nombre
 * repetido y parecían duplicados), que la gráfica sume paquete + cono del mismo
 * hilo y que los porcentajes cuadren.
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

  const invFalso = {
    almacenes: () => of([]),
    resumen: () => of({ almacenes, filas, truncado: false, total_variantes: 4 }),
    stock: () => of({ items: [], total: 0, page: 1, limit: 20, paginas: 1 }),
    alertas: () => of([]),
    buscarVariantes: () => of([]),
    conversiones: () => of({ items: [], total: 0, page: 1, limit: 20, paginas: 1 }),
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [Inventario],
      // La pantalla trae el enlace al Kardex, así que necesita router.
      providers: [{ provide: InventarioService, useValue: invFalso }, provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(Inventario);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('agrupa las presentaciones del mismo color en un solo renglón', async () => {
    const c = await montar();
    const grupos = c.grupos();

    // BEIGE está en cero y se oculta por omisión. Los dos MARINO OSCURO son
    // productos distintos (calibres distintos) y NO se juntan.
    expect(grupos.map((g) => g.producto)).toEqual([
      'BLANCO',
      'AMARILLO',
      'MARINO OSCURO',
      'MARINO OSCURO',
    ]);

    const amarillo = grupos.find((g) => g.producto === 'AMARILLO')!;
    expect(amarillo.filas.length).toBe(2);
    // Paquete primero, cono después: es el orden en que pasa en la tienda.
    expect(amarillo.filas[0].tipo_presentacion).toBe('paquete');
    expect(amarillo.filas[1].tipo_presentacion).toBe('cono');
    // 248.38 + 23.32
    expect(amarillo.total).toBe(271.7);
  });

  it('al destapar los ceros aparece el color sin existencias', async () => {
    const c = await montar();
    c.soloConStock.set(false);
    expect(c.grupos().map((g) => g.producto)).toContain('BEIGE');
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
    // Y el material y la línea van al tooltip.
    expect(g[0].detalle).toBe('ACRILAN · Nacional');
    expect(g[3].detalle).toBe('ACRILAN · Turco');
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

  it('el almacén vacío no es una serie de la gráfica, pero sí una columna', async () => {
    const c = await montar();
    // "tienda moroleon" tiene 0 kg: no pinta y no gasta un color.
    expect(c.seriesGrafica().map((s) => s.nombre)).toEqual([
      'Bodega principal',
      'Tienda principal',
    ]);
    // Los tres primeros almacenes usan los tres colores validados, sin "otros".
    expect(c.seriesGrafica().every((s) => !s.otros)).toBe(true);
  });

  it('los porcentajes de las tarjetas suman el total de la tienda', async () => {
    const c = await montar();
    // 3,562.64 + 0 + 3,057.39
    expect(c.kilosTotales()).toBeCloseTo(6620.03, 2);
    expect(c.porcentaje(almacenes[0] as never)).toBe(54);
    expect(c.porcentaje(almacenes[1] as never)).toBe(0);
    expect(c.porcentaje(almacenes[2] as never)).toBe(46);
  });

  it('rotula la presentación con su peso, sin hacer adivinar el SKU', async () => {
    const c = await montar();
    expect(c.etiquetaPresentacion(filas[2] as never)).toBe('Paquete de 19.088 kg');
    expect(c.etiquetaPresentacion(filas[1] as never)).toBe('Cono');
  });
});
