import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { EntradasModal } from './entradas-modal';
import { InventarioService, Remesa } from '../../../core/services/inventario.service';

/**
 * Lo que importa del reporte de entradas de un hilo:
 *   · lista las cargas de ESE hilo (no las de todos);
 *   · el PDF de todas sus entradas lleva el periodo que se tecleó, y no se pide
 *     con "Desde" después de "Hasta";
 *   · cada carga saca su propio PDF;
 *   · el input se lee en ngOnInit, o abriría sin cargas.
 */
describe('EntradasModal', () => {
  const cargas: Remesa[] = [
    { id: 5, folio: 'REM-1789814460000-D0B2', producto: 'ROSA MEXICANO', calibre: '2/30', sku: 'ROSA-MEXICANO',
      almacen: 'Bodega principal', num_bultos: 29, kg_total: '630.890', creado_en: '2026-09-19 10:41:00' },
  ];
  let pedidas: { tipo: string; args: unknown[] }[] = [];
  const pdf = () => of(new Blob(['%PDF'], { type: 'application/pdf' }));
  const invFalso = {
    remesas: (...args: unknown[]) => {
      pedidas.push({ tipo: 'remesas', args });
      return of({ items: cargas, total: 1, page: 1, limit: 100, paginas: 1 });
    },
    pdfEntradasProducto: (...args: unknown[]) => {
      pedidas.push({ tipo: 'todo', args });
      return pdf();
    },
    pdfCarga: (...args: unknown[]) => {
      pedidas.push({ tipo: 'carga', args });
      return pdf();
    },
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [EntradasModal],
      providers: [{ provide: InventarioService, useValue: invFalso }],
    }).compileComponents();
    const fixture = TestBed.createComponent(EntradasModal);
    fixture.componentRef.setInput('productoId', 190);
    fixture.componentRef.setInput('hilo', 'ROSA MEXICANO 2/30');
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    pedidas = [];
    spyOn(HTMLAnchorElement.prototype, 'click');
  });
  afterEach(() => TestBed.resetTestingModule());

  it('lista las cargas de ese hilo', async () => {
    const f = await montar();
    expect(pedidas[0]).toEqual({ tipo: 'remesas', args: [100, 190] });
    expect(f.componentInstance.cargas()?.length).toBe(1);
    expect(f.nativeElement.textContent).toContain('REM-D0B2');
  });

  it('el PDF de todas sus entradas lleva el periodo, y no se pide al revés', async () => {
    const c = (await montar()).componentInstance;
    c.desde = '2026-10-01';
    c.hasta = '2026-09-01';
    c.pdfTodo();
    expect(c.error()).toContain('Desde');
    expect(pedidas.some((p) => p.tipo === 'todo')).toBe(false);

    c.desde = '2026-09-01';
    c.hasta = '2026-10-01';
    c.pdfTodo();
    expect(pedidas.find((p) => p.tipo === 'todo')?.args).toEqual([190, '2026-09-01', '2026-10-01']);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it('cada carga saca su propio PDF', async () => {
    const c = (await montar()).componentInstance;
    c.pdfCarga(cargas[0]);
    expect(pedidas.find((p) => p.tipo === 'carga')?.args).toEqual([5]);
  });
});
