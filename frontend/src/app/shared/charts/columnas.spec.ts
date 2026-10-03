import { TestBed } from '@angular/core/testing';
import { Columna, Columnas } from './columnas';

/**
 * Lo que importa de las columnas (ventas por semana / por día):
 *   · la más alta llena la zona de dibujo menos el espacio del rótulo, y las
 *     demás son proporcionales;
 *   · una venta chiquita no desaparece y un cero no dibuja nada;
 *   · la columna resaltada lleva `.fuerte`;
 *   · con muchas columnas las etiquetas de abajo se ralean.
 */
describe('Columnas', () => {
  async function montar(data: Columna[], alto = 220) {
    await TestBed.configureTestingModule({ imports: [Columnas] }).compileComponents();
    const fixture = TestBed.createComponent(Columnas);
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('alto', alto);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('la mayor llena la zona útil y las demás son proporcionales', async () => {
    const c = (await montar([
      { etiqueta: 'a', valor: 100 },
      { etiqueta: 'b', valor: 50 },
    ], 230)).componentInstance;
    const util = 230 - c.ESPACIO_ROTULO;
    expect(c.columnas()[0].h).toBe(util);
    expect(c.columnas()[1].h).toBe(util / 2);
  });

  it('lo poquito se ve y el cero no dibuja nada', async () => {
    const c = (await montar([
      { etiqueta: 'a', valor: 100000 },
      { etiqueta: 'b', valor: 1 },
      { etiqueta: 'c', valor: 0 },
    ])).componentInstance;
    expect(c.columnas()[1].h).toBe(2);
    expect(c.columnas()[2].h).toBe(0);
  });

  it('la resaltada lleva .fuerte y el rótulo se escribe encima', async () => {
    const f = await montar([
      { etiqueta: '14 sep', valor: 10, rotulo: '$10' },
      { etiqueta: '21 sep', valor: 20, rotulo: '$20', fuerte: true },
    ]);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('i.fuerte').length).toBe(1);
    expect(el.textContent).toContain('$20');
  });

  it('con un mes día por día, las etiquetas se ralean y el hueco se angosta', async () => {
    const data = Array.from({ length: 31 }, (_, i) => ({ etiqueta: String(i + 1), valor: i }));
    const c = (await montar(data)).componentInstance;
    const visibles = c.columnas().filter((x) => x.verEtiqueta).length;
    expect(visibles).toBeLessThan(31);
    expect(visibles).toBeGreaterThan(8);
    expect(c.hueco()).toBeLessThan(10);
  });
});
