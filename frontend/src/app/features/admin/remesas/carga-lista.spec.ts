import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { CargaLista } from './carga-lista';
import { EventoCarga, InventarioService, PreviaLista, ResultadoLista } from '../../../core/services/inventario.service';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Lo que importa de la lista completa del proveedor (varios colores):
 *   · cada color + calibre es un hilo: dice si ya existe o si se va a crear;
 *   · los nuevos piden material (lo sugiere el ARTÍCULO del archivo) y su
 *     calibre tiene que ser de ese material;
 *   · un renglón con error impide cargar;
 *   · al confirmar manda los hilos con sus bultos (sin precio de compra: el
 *     usuario pone los precios en Productos), baja el PDF de toda la lista y
 *     avisa cuáles quedaron sin precio;
 *   · mientras carga dice qué está haciendo: hilo por hilo y los bultos que van.
 */
describe('CargaLista', () => {
  const previa: PreviaLista = {
    archivo: 'HTX INVENTARIO.xlsx',
    hoja: 'GLOBAL',
    documento: { proveedor: 'Canan Tekstil', numero: 'IRD00103079', fecha: '28.08.2026' },
    articulo: '%100 ACRYLIC',
    control: { lotes: 2, cuadra: true, diferencias: [] },
    errores: [],
    avisos: [{ fila: 4, mensaje: 'Renglón 4 (bulto 002): AVISO: NET releído' }],
    resumen: { num_hilos: 2, nuevos: 1, num_bultos: 3, kg_total: 57.5, conos: 36, lotes: 2 },
    material_sugerido_id: 2,
    se_puede_cargar: true,
    hilos: [
      {
        clave: 'CAMEL|2/30', nombre: 'CAMEL', calibre: '2/30', estado: 'nuevo', producto: null,
        parecidos: ['CAMEL 1/30'], num_bultos: 2, kg_total: 38.5, conos: 24, peso_min: 19, peso_max: 19.5,
        peso_promedio: 19.25, lotes: [{ lote: 'L1', bultos: 2, kg: 38.5 }],
        bultos: [{ fila: 3, codigo: '001', peso_kg: 19, lote: 'L1', conos: 12 }, { fila: 4, codigo: '002', peso_kg: 19.5, lote: 'L1', conos: 12 }],
      },
      {
        clave: 'BLANCO|2/30', nombre: 'BLANCO', calibre: '2/30', estado: 'existe',
        producto: { id: 7, nombre: 'BLANCO', calibre: '2/30', material: 'ACRILAN', linea: 'Nacional', activo: true, precio_kg: 180, sku: 'BLANCO', tiene_precio: true },
        parecidos: [], num_bultos: 1, kg_total: 19, conos: 12, peso_min: 19, peso_max: 19, peso_promedio: 19,
        lotes: [{ lote: 'L2', bultos: 1, kg: 19 }],
        bultos: [{ fila: 5, codigo: '003', peso_kg: 19, lote: 'L2', conos: 12 }],
      },
    ],
  };

  const resultado: ResultadoLista = {
    cargas: [
      { id: 50, folio: 'REM-1-AAAA', num_bultos: 2, kg_total: 38.5, lotes: ['L1'], saldo_anterior: 0, saldo_nuevo: 38.5, producto_id: 300, hilo: 'CAMEL 2/30', nuevo: true, sin_precio: true },
      { id: 51, folio: 'REM-1-BBBB', num_bultos: 1, kg_total: 19, lotes: ['L2'], saldo_anterior: 10, saldo_nuevo: 29, producto_id: 7, hilo: 'BLANCO 2/30', nuevo: false, sin_precio: false },
    ],
    ids: [50, 51],
    num_hilos: 2,
    nuevos: 1,
    num_bultos: 3,
    kg_total: 57.5,
    sin_precio: [{ producto_id: 300, hilo: 'CAMEL 2/30' }],
  };

  let enviado: Parameters<InventarioService['cargarLista']>[0] | null = null;
  /** Lo que "contesta" el servidor al cargar; cada prueba lo maneja a su ritmo. */
  let servidor: Subject<EventoCarga>;
  let pdfs: number[][] = [];
  let respuestaPrevia: PreviaLista = previa;

  /** Los permisos del puesto; null = todos (el administrador). */
  let permisos: string[] | null = null;
  const authFalso = { puede: (p: string) => permisos === null || permisos.includes(p) };

  const invFalso = {
    // El proveedor que dice el archivo ya está dado de alta: se elige solo.
    proveedores: () => of([{ id: 3, nombre: 'CANAN TEKSTIL' }]),
    crearProveedor: (nombre: string) => of({ id: 4, nombre }),
    previaLista: () => of(respuestaPrevia),
    cargarLista: (b: Parameters<InventarioService['cargarLista']>[0]) => {
      enviado = b;
      return servidor.asObservable();
    },
    pdfCargas: (ids: number[]) => {
      pdfs.push(ids);
      return of(new Blob(['%PDF'], { type: 'application/pdf' }));
    },
  };
  const catalogoFalso = {
    listarCategorias: () =>
      of({
        items: [
          { id: 2, nombre: 'ACRILAN', calibres: '1/30,2/30', orden: 0, activo: 1 },
          { id: 19, nombre: 'VISCOSA', calibres: '2/48', orden: 0, activo: 1 },
        ],
        total: 2, page: 1, limit: 100, paginas: 1,
      }),
    opciones: () => of([{ id: 1, nombre: 'Turco' }, { id: 2, nombre: 'Nacional' }]),
  };

  beforeEach(() => (permisos = null));

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [CargaLista],
      providers: [
        provideRouter([]),
        { provide: InventarioService, useValue: invFalso },
        { provide: CatalogoService, useValue: catalogoFalso },
        { provide: AuthService, useValue: authFalso },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CargaLista);
    fixture.componentRef.setInput('almacenes', [
      { id: 1, nombre: 'Tienda', es_matriz: 0, activo: 1 },
      { id: 2, nombre: 'Bodega principal', es_matriz: 1, activo: 1 },
    ]);
    fixture.detectChanges();
    return fixture;
  }

  function subir(c: CargaLista): void {
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'HTX INVENTARIO.xlsx')] });
    c.elegirArchivo({ target: input } as unknown as Event);
  }

  beforeEach(() => {
    enviado = null;
    pdfs = [];
    respuestaPrevia = previa;
    servidor = new Subject<EventoCarga>();
    spyOn(HTMLAnchorElement.prototype, 'click');
  });
  afterEach(() => TestBed.resetTestingModule());

  it('enseña cada hilo: el nuevo se crea sin precio y el que existe recibe bultos', async () => {
    const f = await montar();
    const c = f.componentInstance;
    expect(c.almacenSel).toBe(2); // la matriz
    subir(c);
    f.detectChanges();
    const texto = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('CAMEL 2/30');
    expect(texto).toContain('Se crea sin precio');
    expect(texto).toContain('ya tienes CAMEL 1/30');
    expect(texto).toContain('Se le agregan bultos');
    expect(texto).toContain('Cuadra con el resumen de 2 lotes');
    expect(texto).toContain('AVISO: NET releído');
    // El material lo sugirió el artículo del archivo.
    expect(c.materialSel).toBe(2);
    expect(c.falta()).toBeNull();
  });

  it('los hilos nuevos piden material, y su calibre tiene que ser de ese material', async () => {
    const c = (await montar()).componentInstance;
    respuestaPrevia = { ...previa, material_sugerido_id: null };
    subir(c);
    expect(c.falta()).toContain('material');
    c.materialSel = 19; // VISCOSA no tiene 2/30
    expect(c.calibresFuera()).toEqual(['2/30']);
    expect(c.falta()).toContain('VISCOSA no tiene el calibre 2/30');
    c.materialSel = 2;
    expect(c.falta()).toBeNull();
  });

  it('un renglón con error impide cargar', async () => {
    const f = await montar();
    const c = f.componentInstance;
    respuestaPrevia = {
      ...previa,
      se_puede_cargar: false,
      errores: [{ fila: 9, mensaje: 'Renglón 9 (bulto 009): el peso neto está vacío.' }],
    };
    subir(c);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('el peso neto está vacío');
    const boton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Cargar'))!;
    expect(boton.disabled).toBe(true);
  });

  it('el costo por kilo va por hilo, y solo para administración y contabilidad (2026-10-06)', async () => {
    permisos = ['ver:remesa'];
    let f = await montar();
    subir(f.componentInstance);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('table.hilos input')).toBeNull();
    TestBed.resetTestingModule();

    permisos = null;
    f = await montar();
    const c = f.componentInstance;
    subir(c);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelectorAll('table.hilos input').length).toBe(2);
    c.costos['CAMEL|2/30'] = 88;
    c.confirmar();
    expect(enviado!.hilos[0].costo_kg).toBe(88);
    expect(enviado!.hilos[1].costo_kg).toBeUndefined();
  });

  it('los papeles van para toda la lista, y el proveedor del archivo viene elegido', async () => {
    const f = await montar();
    const c = f.componentInstance;
    subir(c);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    // «Canan Tekstil» del archivo = «CANAN TEKSTIL» de la lista.
    expect(c.datosCarga().proveedor_id).toBe(3);
    c.datosCarga.update((d) => ({ ...d, factura: 'F-9', contenedor: 'MSCU1234567' }));
    c.confirmar();
    expect(enviado).toEqual(jasmine.objectContaining({ proveedor_id: 3, factura: 'F-9', contenedor: 'MSCU1234567' }));
  });

  it('mientras carga dice qué está haciendo, hilo por hilo y los bultos que van', async () => {
    const f = await montar();
    const c = f.componentInstance;
    subir(c);
    c.confirmar();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const texto = () => el.querySelector('.estado-carga')?.textContent ?? '';
    // Sin botón apagado y mudo: el panel de avance.
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.includes('Cargar'))).toBe(false);
    expect(texto()).toContain('Enviando la lista al servidor');
    expect(texto()).toContain('0 de 3 bultos registrados');

    servidor.next({ tipo: 'hilo', i: 0, n: 2, hilo: 'CAMEL 2/30', nuevo: true });
    servidor.next({ tipo: 'bultos', hilo: 'CAMEL 2/30', hechos: 2, total: 3 });
    f.detectChanges();
    expect(texto()).toContain('Creando CAMEL 2/30 y registrando sus bultos');
    expect(texto()).toContain('2 de 3 bultos registrados');
    expect(texto()).toContain('Creando el hilo y sus bultos');

    servidor.next({ tipo: 'hilo_listo', i: 0, hilo: 'CAMEL 2/30', folio: 'REM-1790864580000-AAAA' });
    servidor.next({ tipo: 'hilo', i: 1, n: 2, hilo: 'BLANCO 2/30', nuevo: false });
    f.detectChanges();
    expect(texto()).toContain('Listo · carga REM-AAAA');
    expect(texto()).toContain('Agregando los bultos de BLANCO 2/30');
  });

  it('si el servidor dice que no se pudo, lo explica junto al botón y deja volver a intentar', async () => {
    const f = await montar();
    const c = f.componentInstance;
    subir(c);
    c.confirmar();
    servidor.next({ tipo: 'error', status: 409, error: { code: 'CODIGOS_DUPLICADOS', message: '3 código(s) ya están registrados.' } });
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.error-carga')?.textContent).toContain('ya están registrados. No se guardó nada.');
    expect(el.querySelector('.estado-carga')).toBeNull();
    const boton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Cargar'))!;
    expect(boton.disabled).toBe(false);
  });

  it('al terminar manda los hilos con sus bultos, baja el PDF de la lista y avisa los que no tienen precio', async () => {
    const f = await montar();
    const c = f.componentInstance;
    subir(c);
    c.lineaSel = 1;
    c.confirmar();
    expect(enviado!.almacen_id).toBe(2);
    expect(enviado!.categoria_id).toBe(2);
    expect(enviado!.linea_id).toBe(1);
    expect(enviado!.documento?.numero).toBe('IRD00103079');
    expect(enviado!.hilos.map((h) => `${h.nombre} ${h.calibre} ${h.bultos.length}`)).toEqual([
      'CAMEL 2/30 2',
      'BLANCO 2/30 1',
    ]);
    servidor.next({ tipo: 'fin', data: resultado });
    servidor.complete();
    expect(pdfs).toEqual([[50, 51]]);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();

    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Falta ponerle precio a 1 hilo');
    expect(el.textContent).toContain('CAMEL 2/30');
    const enlace = el.querySelector('a[href*="falta=precio"]');
    expect(enlace).not.toBeNull();
  });
});
