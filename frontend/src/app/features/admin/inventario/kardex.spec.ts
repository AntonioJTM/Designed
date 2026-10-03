import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Kardex } from './kardex';
import { FiltroKardex, InventarioService } from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { Movimiento } from '../../../core/models/inventario.models';

/**
 * El kardex habla de DOCUMENTOS: la etiqueta la pone el backend y la pantalla
 * solo elige el color por el tipo de documento. Se comprueba también que los
 * filtros nuevos (búsqueda y fechas) lleguen al servidor y que "Ver venta" solo
 * se ofrezca a quien puede abrir el pedido.
 */
describe('Kardex', () => {
  function mov(extra: Partial<Movimiento>): Movimiento {
    return {
      id: 1, variante_id: 5, sku: 'NEGRO', almacen_id: 1, almacen: 'Bodega principal',
      tipo: 'salida', cantidad: '-11.890', creado_en: '2026-10-02 13:42:00',
      producto: 'NEGRO', calibre: '2/30', unidad: 'kg', concepto: 'Venta mostrador',
      ...extra,
    } as Movimiento;
  }

  const venta = mov({ id: 1, detalle_tipo: 'pedido', detalle_id: 91, folio: 'POS-91B0' });
  const remesa = mov({ id: 2, tipo: 'entrada', cantidad: '1527.500', detalle_tipo: 'remesa', concepto: 'Remesa del proveedor' });
  const conos = mov({ id: 3, tipo: 'entrada', cantidad: '19.550', detalle_tipo: 'conversion', concepto: 'Conos producidos NEGRO-CONO', codigo_bulto: '00531340' });
  const desarme = mov({ id: 4, cantidad: '-19.050', detalle_tipo: 'conversion', concepto: 'Desarme de paquetes NEGRO' });
  const ajuste = mov({ id: 5, tipo: 'ajuste', cantidad: '-1.200', detalle_tipo: null, concepto: 'Ajuste de inventario' });
  const merma = mov({ id: 6, tipo: 'merma', cantidad: '-2.400', detalle_tipo: null, concepto: 'Merma' });

  let pedido: { concepto?: string; extra?: FiltroKardex } = {};
  const invFalso = {
    almacenes: () => of([]),
    movimientos: (_a?: number, _v?: number, concepto?: string, extra?: FiltroKardex) => {
      pedido = { concepto, extra };
      return of({ items: [venta, remesa, conos, desarme, ajuste, merma], total: 6, page: 1, limit: 100, paginas: 1 });
    },
  };
  let permisos: string[] | null = null;
  const authFalso = { puede: (p: string) => permisos === null || permisos.includes(p) };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [Kardex],
      providers: [
        { provide: InventarioService, useValue: invFalso },
        { provide: AuthService, useValue: authFalso },
        provideRouter([]),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Kardex);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    permisos = null;
    pedido = {};
  });
  afterEach(() => TestBed.resetTestingModule());

  it('el color sale del documento, no del texto', async () => {
    const c = (await montar()).componentInstance;
    expect(c.tono(venta)).toBe('azul');
    expect(c.tono(remesa)).toBe('verde');
    expect(c.tono(conos)).toBe('verde');
    expect(c.tono(desarme)).toBe('gris');
    expect(c.tono(ajuste)).toBe('ambar');
    expect(c.tono(merma)).toBe('rojo');
  });

  it('pinta la etiqueta del backend tal cual, con el folio o el bulto', async () => {
    const el = (await montar()).nativeElement as HTMLElement;
    expect(el.textContent).toContain('Venta mostrador');
    expect(el.textContent).toContain('POS-91B0');
    expect(el.textContent).toContain('bulto 00531340');
  });

  it('manda la búsqueda y las fechas al servidor', async () => {
    const c = (await montar()).componentInstance;
    c.filtroQ = 'negro 2/30';
    c.desde = '2026-09-26';
    c.hasta = '2026-10-02';
    c.filtroConcepto = 'desarmes';
    c.buscarYa();
    expect(pedido.concepto).toBe('desarmes');
    expect(pedido.extra).toEqual({ q: 'negro 2/30', desde: '2026-09-26', hasta: '2026-10-02', page: 1 });
  });

  it('"Ver venta" solo para quien puede abrir el pedido', async () => {
    let fixture = await montar();
    expect(fixture.componentInstance.enlaceVenta(venta)).toBe('/admin/pedidos/91');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Ver venta');
    TestBed.resetTestingModule();

    permisos = ['ver:kardex'];
    fixture = await montar();
    expect(fixture.componentInstance.enlaceVenta(venta)).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Ver venta');
  });
});
