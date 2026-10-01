import { TestBed } from '@angular/core/testing';
import { Barras } from './barras';

/**
 * Lo que importa de la gráfica de barras:
 *   · con todo positivo el cero queda a la izquierda (barras normales);
 *   · con negativos el cero se coloca donde toca y las barras crecen a los dos
 *     lados, que es lo que hace falta para leer un margen;
 *   · el signo va ANTES del símbolo de moneda ("-$3,200", no "$-3,200");
 *   · el carril de fondo no se dibuja cuando hay negativos, porque dejaría gris
 *     vacío del lado contrario y se leería como si faltara dato.
 */
describe('Barras', () => {
  async function montar(data: { label: string; value: number }[]) {
    await TestBed.configureTestingModule({ imports: [Barras] }).compileComponents();
    const fixture = TestBed.createComponent(Barras);
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('prefijo', '$');
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('con todo positivo, el cero queda al inicio del carril', async () => {
    const c = (await montar([{ label: 'A', value: 100 }, { label: 'B', value: 50 }]))
      .componentInstance;

    expect(c.hayNegativos()).toBe(false);
    // El cero coincide con el borde del área de dibujo.
    expect(c.x0()).toBe(c.gutter());
  });

  it('con negativos, el cero se corre a su sitio', async () => {
    const c = (await montar([{ label: 'Gana', value: 300 }, { label: 'Pierde', value: -100 }]))
      .componentInstance;

    expect(c.hayNegativos()).toBe(true);
    // El rango va de -100 a 300: el cero cae al 25% del ancho.
    const esperado = c.gutter() + 0.25 * c.plotW();
    expect(c.x0()).toBeCloseTo(esperado, 5);
  });

  it('la barra negativa crece hacia la izquierda del cero', async () => {
    const c = (await montar([{ label: 'Gana', value: 300 }, { label: 'Pierde', value: -100 }]))
      .componentInstance;
    const [gana, pierde] = c.barras();

    // La etiqueta de la positiva va a la derecha; la de la negativa, a la izquierda.
    expect(gana.anclaFin).toBe(false);
    expect(pierde.anclaFin).toBe(true);
    expect(pierde.valX).toBeLessThan(c.x0());
    expect(gana.valX).toBeGreaterThan(c.x0());
  });

  it('pone el signo antes del símbolo de moneda', async () => {
    const c = (await montar([{ label: 'Pierde', value: -3200 }])).componentInstance;

    // "$-3,200" se lee como un error de captura.
    expect(c.conSigno(-3200)).toBe('-$3,200');
    expect(c.conSigno(3200)).toBe('$3,200');
  });

  it('una lista vacía no truena ni divide por cero', async () => {
    const c = (await montar([])).componentInstance;

    expect(c.barras()).toEqual([]);
    expect(Number.isFinite(c.x0())).toBe(true);
  });

  it('un solo valor en cero no rompe la escala', async () => {
    const c = (await montar([{ label: 'Nada', value: 0 }])).componentInstance;

    expect(c.barras().length).toBe(1);
    expect(Number.isFinite(c.barras()[0].valX)).toBe(true);
  });

  it('recorta los nombres largos pero conserva el completo', async () => {
    const largo = 'MARINO OSCURO MUY MUY LARGO 2/30';
    const c = (await montar([{ label: largo, value: 10 }])).componentInstance;
    const b = c.barras()[0];

    expect(b.corta.length).toBeLessThanOrEqual(24);
    expect(b.corta.endsWith('…')).toBe(true);
    // El nombre completo se queda para el tooltip.
    expect(b.label).toBe(largo);
  });
});
