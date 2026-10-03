import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Remesas } from './remesas';
import { InventarioService, Remesa } from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { Variante } from '../../../core/models/catalogo.models';

/**
 * Lo que importa de Recibir remesa: que el hilo se elija con color, calibre,
 * material y línea; que el nombre del archivo se COTEJE y solo avise; que el
 * precio de compra se capture siempre pero los costos ya guardados solo los vea
 * quien tiene `hacer:ver_costos`.
 */
describe('Remesas', () => {
  const rojo130 = {
    id: 10, producto_id: 1, sku: 'ROJO', producto: 'ROJO', calibre: '1/30',
    material: 'ACRILAN', linea: 'Turco', tipo_presentacion: 'paquete', precio: '100', activo: 1,
  } as unknown as Variante;
  const amarillo = {
    id: 11, producto_id: 2, sku: 'AMARILLO', producto: 'AMARILLO', calibre: '1/30',
    material: 'ACRILAN', linea: 'Chino', tipo_presentacion: 'paquete', precio: '100', activo: 1,
  } as unknown as Variante;

  const historial: Remesa[] = [
    { id: 1, folio: 'REM-1', producto: 'AMARILLO', calibre: '1/30', sku: 'AMARILLO', almacen: 'Bodega',
      num_bultos: 38, kg_total: '702.000', archivo: 'ROJO 1-30.xlsx', costo_kg: '90.00', creado_en: '2026-09-05 10:00:00' },
    { id: 2, folio: 'REM-2', producto: 'ROJO', calibre: '2/30', sku: 'ROJO-2', almacen: 'Bodega',
      num_bultos: 41, kg_total: '760.200', archivo: 'ROJO 2-30.xlsx', costo_kg: null, creado_en: '2026-09-12 10:00:00' },
  ];

  const pdfsPedidos: number[] = [];
  const invFalso = {
    almacenes: () => of([{ id: 1, nombre: 'Bodega', es_matriz: 1, es_punto_venta: 0, activo: 1 }]),
    variantesPorTipo: () => of([rojo130, amarillo]),
    remesas: () => of({ items: historial, total: 2, page: 1, limit: 20, paginas: 1 }),
    confirmarRemesa: () =>
      of({ id: 99, folio: 'REM-99', num_bultos: 1, kg_total: 20, lotes: ['L1'], saldo_anterior: 0, saldo_nuevo: 20 }),
    pdfCarga: (id: number) => {
      pdfsPedidos.push(id);
      return of(new Blob(['%PDF'], { type: 'application/pdf' }));
    },
  };
  let permisos: string[] | null = null;
  const authFalso = { puede: (p: string) => permisos === null || permisos.includes(p) };

  const catalogoFalso = {
    listarCategorias: () => of({ items: [], total: 0, page: 1, limit: 100, paginas: 1 }),
    opciones: () => of([]),
  };

  /**
   * Casi todas estas pruebas son de la carga de UN hilo; la lista completa
   * tiene las suyas (carga-lista.spec.ts). El modo se recuerda en el navegador.
   */
  async function montar(modo: 'hilo' | 'lista' | null | 'como-quedo' = 'hilo') {
    if (modo === null) localStorage.removeItem('remesa_modo');
    else if (modo !== 'como-quedo') localStorage.setItem('remesa_modo', modo);
    await TestBed.configureTestingModule({
      imports: [Remesas],
      providers: [
        { provide: InventarioService, useValue: invFalso },
        { provide: AuthService, useValue: authFalso },
        { provide: CatalogoService, useValue: catalogoFalso },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Remesas);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    permisos = null;
    pdfsPedidos.length = 0;
    // Que la "descarga" no descargue nada de verdad durante la prueba.
    spyOn(HTMLAnchorElement.prototype, 'click');
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.removeItem('remesa_modo');
  });

  it('abre en la lista con varios colores, y recuerda si se eligió un solo hilo', async () => {
    let f = await montar(null);
    expect(f.componentInstance.modo()).toBe('lista');
    expect((f.nativeElement as HTMLElement).querySelector('app-carga-lista')).not.toBeNull();

    f.componentInstance.cambiarModo('hilo');
    expect(localStorage.getItem('remesa_modo')).toBe('hilo');
    TestBed.resetTestingModule();

    f = await montar('como-quedo');
    expect(f.componentInstance.modo()).toBe('hilo');
    expect((f.nativeElement as HTMLElement).querySelector('app-carga-lista')).toBeNull();
    expect((f.nativeElement as HTMLElement).textContent).toContain('A qué hilo entra');
  });

  it('el hilo se elige con color, calibre, material y línea', async () => {
    const c = (await montar()).componentInstance;
    expect(c.etiquetaPaquete(rojo130)).toBe('ROJO 1/30 — ACRILAN · Turco');
  });

  it('coteja el nombre del archivo con el hilo: avisa, no bloquea', async () => {
    const c = (await montar()).componentInstance;
    c.varianteSel = 10;
    c.archivo = new File([''], 'ROJO 1-30.xlsx');
    expect(c.cotejo()).toBe('coincide');

    c.varianteSel = 11;
    expect(c.cotejo()).toBe('no');
    expect(c.avisoArchivo()).toContain('ROJO');

    // Un archivo con otro nombre no dice nada: no hay qué cotejar.
    c.archivo = new File([''], '');
    expect(c.cotejo()).toBeNull();
  });

  it('el historial marca la que entró al hilo equivocado', async () => {
    const c = (await montar()).componentInstance;
    expect(c.avisoHistorial(historial[0])).not.toBeNull();
    expect(c.nombreArchivo(historial[0])).toBe('ROJO 1-30');
    expect(c.sospechosas()).toBe(1);
    // La tienda no lleva el costo (core/costos.ts): que no traiga precio de
    // compra es lo normal y no se avisa.
    expect(c.sinCosto(historial[1])).toBe(false);
  });

  it('no pide el precio de compra: la tienda no lleva el costo', async () => {
    const el = (await montar()).nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Precio de compra por kg');
    expect(el.querySelector('input[name="costokg"]')).toBeNull();
  });

  it('la columna de costo del historial solo sale a quien puede ver costos', async () => {
    let el = (await montar()).nativeElement as HTMLElement;
    expect(el.textContent).toContain('Costo por kg');
    TestBed.resetTestingModule();

    permisos = ['ver:remesa'];
    el = (await montar()).nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Costo por kg');
  });
  it('al confirmar una carga baja su PDF solo, y el historial puede sacarlo cuando sea', async () => {
    const c = (await montar()).componentInstance;
    c.previa.set({ archivo: 'ROJO 1-30.xlsx', bultos: [{ codigo: 'A1', peso_kg: 20, lote: 'L1' }], se_puede_cargar: true } as never);
    c.varianteSel = 10;
    c.almacenSel = 1;
    c.confirmar();
    expect(c.ultima()?.folio).toBe('REM-99');
    expect(pdfsPedidos).toEqual([99]);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();

    c.descargarPdf(historial[1].id, historial[1].folio);
    expect(pdfsPedidos).toEqual([99, 2]);
  });
});
