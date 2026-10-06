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
  let enviadoRemesa: Record<string, unknown> | null = null;
  const invFalso = {
    proveedores: () => of([{ id: 3, nombre: 'Canan Tekstil' }]),
    crearProveedor: (nombre: string) => of({ id: 4, nombre }),
    editarDatosCarga: () => of(historial[0]),
    almacenes: () => of([{ id: 1, nombre: 'Bodega', es_matriz: 1, es_punto_venta: 0, activo: 1 }]),
    variantesPorTipo: () => of([rojo130, amarillo]),
    remesas: () => of({ items: historial, total: 2, page: 1, limit: 20, paginas: 1 }),
    confirmarRemesa: (b: Record<string, unknown>) => {
      enviadoRemesa = b;
      return of({ id: 99, folio: 'REM-99', num_bultos: 1, kg_total: 20, lotes: ['L1'], saldo_anterior: 0, saldo_nuevo: 20 });
    },
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
    enviadoRemesa = null;
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
    // A quien lleva el costo se le avisa la carga que entró sin él.
    expect(c.sinCosto(historial[1])).toBe(true);
  });

  it('el costo por kilo solo se pide a administración y contabilidad (2026-10-06)', async () => {
    let el = (await montar()).nativeElement as HTMLElement;
    expect(el.textContent).toContain('Costo por kilo');
    TestBed.resetTestingModule();

    permisos = ['ver:remesa'];
    const f = await montar();
    el = f.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Costo por kilo');
    // Ni se le avisa de cargas sin costo.
    expect(f.componentInstance.sinCosto(historial[1])).toBe(false);
  });

  it('la carga manda proveedor, factura, pedimento, contenedor y fecha (y el costo, a quien toca)', async () => {
    const c = (await montar()).componentInstance;
    c.previa.set({ archivo: 'ROJO 1-30.xlsx', bultos: [{ codigo: 'A1', peso_kg: 20, lote: 'L1' }], se_puede_cargar: true } as never);
    c.varianteSel = 10;
    c.almacenSel = 1;
    c.datosCarga.set({
      proveedor_id: 3, factura: ' A-4821 ', pedimento: '26 07 3456 6001234', contenedor: '', fecha_ingreso: '2026-10-05', costo_kg: 95,
    });
    c.confirmar();
    expect(enviadoRemesa).toEqual(jasmine.objectContaining({
      proveedor_id: 3, factura: 'A-4821', pedimento: '26 07 3456 6001234', fecha_ingreso: '2026-10-05', costo_kg: 95,
    }));
    // Lo vacío no viaja.
    expect(enviadoRemesa!['contenedor']).toBeUndefined();
    // Y queda en blanco para la siguiente.
    expect(c.datosCarga().proveedor_id).toBeNull();
  });

  it('quien no ve costos no manda el costo aunque se haya quedado tecleado', async () => {
    permisos = ['ver:remesa'];
    const c = (await montar()).componentInstance;
    c.previa.set({ archivo: 'ROJO 1-30.xlsx', bultos: [{ codigo: 'A1', peso_kg: 20, lote: 'L1' }], se_puede_cargar: true } as never);
    c.varianteSel = 10;
    c.almacenSel = 1;
    c.datosCarga.update((d) => ({ ...d, costo_kg: 95 }));
    c.confirmar();
    expect(enviadoRemesa!['costo_kg']).toBeUndefined();
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
