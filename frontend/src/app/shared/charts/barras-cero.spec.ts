import { TestBed } from '@angular/core/testing';
import { BarraCero, BarrasCero } from './barras-cero';

/**
 * Lo que importa de "Qué colores dejan dinero":
 *   · con todo positivo el cero queda a la izquierda y no se dibuja la raya;
 *   · con negativos el cero se corre a su sitio y la barra que pierde crece
 *     hacia la izquierda desde ahí, terminando justo en la raya;
 *   · lo que pierde lleva su propia clase (otro color y tinta de alerta), y el
 *     rótulo se escribe tal cual lo da la pantalla.
 */
describe('BarrasCero', () => {
  async function montar(data: BarraCero[]) {
    await TestBed.configureTestingModule({ imports: [BarrasCero] }).compileComponents();
    const fixture = TestBed.createComponent(BarrasCero);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();
    return fixture;
  }

  const fila = (etiqueta: string, valor: number): BarraCero => ({ etiqueta, valor, rotulo: `${valor}` });

  afterEach(() => TestBed.resetTestingModule());

  it('con todo positivo, el cero queda a la izquierda y no hay raya', async () => {
    const f = await montar([fila('A', 100), fila('B', 50)]);
    const c = f.componentInstance;

    expect(c.hayNegativos()).toBe(false);
    expect(c.x0()).toBe(0);
    expect(f.nativeElement.querySelector('.bc-cero')).toBeNull();
    // La mayor llena el carril y la otra es proporcional.
    expect(c.barras()[0].ancho).toBe(100);
    expect(c.barras()[1].ancho).toBe(50);
  });

  it('con negativos, el cero se corre a su sitio y la que pierde crece a la izquierda', async () => {
    const f = await montar([fila('Gana', 300), fila('Pierde', -100)]);
    const c = f.componentInstance;

    expect(c.hayNegativos()).toBe(true);
    // El rango va de -100 a 300: el cero cae al 25% del carril.
    expect(c.x0()).toBeCloseTo(25, 5);
    const [gana, pierde] = c.barras();
    expect(gana.izq).toBeCloseTo(25, 5);
    expect(gana.ancho).toBeCloseTo(75, 5);
    // La negativa termina exactamente en el cero.
    expect(pierde.izq + pierde.ancho).toBeCloseTo(25, 5);
    expect(pierde.negativa).toBe(true);

    const raya = f.nativeElement.querySelector('.bc-cero') as HTMLElement;
    expect(raya).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.bc-barra.negativa').length).toBe(1);
    expect(f.nativeElement.querySelectorAll('.bc-rotulo.negativa').length).toBe(1);
  });

  it('escribe el rótulo que manda la pantalla, sin rehacerlo', async () => {
    const f = await montar([{ etiqueta: 'TURQUESA 1/30', valor: -1400, rotulo: '-$1,400 · -6%' }]);
    const texto = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('TURQUESA 1/30');
    expect(texto).toContain('-$1,400 · -6%');
  });

  it('lo poquito se ve: una barra distinta de cero nunca mide cero', async () => {
    const c = (await montar([fila('Grande', 100000), fila('Chica', 1)])).componentInstance;
    expect(c.barras()[1].ancho).toBeGreaterThan(0);
  });
});
