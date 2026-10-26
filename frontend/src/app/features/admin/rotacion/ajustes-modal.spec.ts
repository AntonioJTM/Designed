import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AjustesModal } from './ajustes-modal';
import { RotacionService } from '../../../core/services/rotacion.service';
import { AjustesRotacion } from '../../../core/models/rotacion.models';

/**
 * Los tiempos para pedir: abre con los que hay, no deja guardar lo que no va
 * (proveedor 1-52 semanas, colchón 0-12, cubre 1-12 meses, contenedor vacío o más
 * de 0) y manda los cuatro.
 */
describe('AjustesModal', () => {
  let enviados: Omit<AjustesRotacion, 'confirmados'>[];

  async function montar() {
    enviados = [];
    await TestBed.configureTestingModule({
      imports: [AjustesModal],
      providers: [{
        provide: RotacionService,
        useValue: { guardarAjustes: (a: Omit<AjustesRotacion, 'confirmados'>) => { enviados.push(a); return of({ ...a, confirmados: true }); } },
      }],
    }).compileComponents();
    const f = TestBed.createComponent(AjustesModal);
    f.componentRef.setInput('ajustes', { semanas_proveedor: 10, semanas_colchon: 3, meses_cubre: 4, kg_contenedor: null, confirmados: false });
    f.detectChanges();
    return f.componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('abre con los que hay y guarda los cuatro', async () => {
    const c = await montar();
    let guardado: AjustesRotacion | null = null;
    c.guardado.subscribe((a) => (guardado = a));
    expect([c.proveedor, c.colchon, c.cubre, c.contenedor]).toEqual([10, 3, 4, null]);
    c.proveedor = 12;
    c.contenedor = 18000;
    c.guardar();
    expect(enviados).toEqual([{ semanas_proveedor: 12, semanas_colchon: 3, meses_cubre: 4, kg_contenedor: 18000 }]);
    expect(guardado!.confirmados).toBe(true);
  });

  it('no guarda lo que no va', async () => {
    const c = await montar();
    c.proveedor = 0;
    c.guardar();
    expect(c.error()).toContain('1 a 52');
    c.proveedor = 10;
    c.colchon = 13;
    c.guardar();
    expect(c.error()).toContain('0 a 12');
    c.colchon = 3;
    c.cubre = 2.5;
    c.guardar();
    expect(c.error()).toContain('1 a 12 meses');
    c.cubre = 4;
    c.contenedor = -5;
    c.guardar();
    expect(c.error()).toContain('contenedor');
    expect(enviados).toEqual([]);
  });
});
