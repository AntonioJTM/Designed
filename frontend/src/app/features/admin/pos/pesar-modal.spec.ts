import { TestBed } from '@angular/core/testing';
import { PesarModal, HiloAPesar } from './pesar-modal';

/**
 * La báscula del punto de venta (2026-10-06):
 *   · manda los kilos que marcó y, si son conos, cuántos eran;
 *   · sin peso no se agrega;
 *   · avisa ANTES si pesó más de lo que hay en esta tienda.
 */
describe('PesarModal', () => {
  const cono: HiloAPesar = {
    id: 7, sku: 'ROJO-2-30-CONO', producto: 'ROJO 2/30', tipo: 'cono', precio: 200,
    aqui: { cantidad: 12.5, paquetes: null },
  };

  async function montar(hilo: HiloAPesar) {
    await TestBed.configureTestingModule({ imports: [PesarModal] }).compileComponents();
    const f = TestBed.createComponent(PesarModal);
    f.componentRef.setInput('hilo', hilo);
    f.detectChanges();
    let enviado: { kg: number; piezas?: number } | null = null;
    f.componentInstance.agregado.subscribe((e) => (enviado = e));
    return { c: f.componentInstance, f, enviado: () => enviado };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('manda los kilos y los conos', async () => {
    const { c, enviado } = await montar(cono);
    expect(c.esCono).toBe(true);
    c.kg = 9.3504;
    c.piezas = 6;
    c.agregar();
    expect(enviado()).toEqual({ kg: 9.35, piezas: 6 });
  });

  it('sin peso no agrega nada', async () => {
    const { c, enviado } = await montar(cono);
    c.agregar();
    expect(c.puedeAgregar()).toBe(false);
    expect(enviado()).toBeNull();
  });

  it('por kilo de un paquete no pregunta conos', async () => {
    const { c, f, enviado } = await montar({ ...cono, id: 6, tipo: 'paquete', aqui: { cantidad: 390, paquetes: 20 } });
    expect((f.nativeElement as HTMLElement).textContent).not.toContain('¿Cuántos conos');
    c.kg = 2.5;
    c.piezas = 3;
    c.agregar();
    expect(enviado()).toEqual({ kg: 2.5, piezas: undefined });
  });

  it('avisa si pesó más de lo que hay aquí', async () => {
    const { c, f } = await montar(cono);
    c.kg = 13;
    f.detectChanges();
    expect(c.noAlcanza()).toBe(true);
    expect((f.nativeElement as HTMLElement).textContent).toContain('así no se va a poder cobrar');
  });
});
