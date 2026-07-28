import { TestBed } from '@angular/core/testing';
import { BarraApilada, StackedBars } from './stacked-bars';

/**
 * La geometría se comprueba con números porque a ojo no se ve: que los pedazos
 * queden pegados en el orden correcto, que entre ellos quede el hueco de 2 px del
 * color del fondo (y no un borde), que solo el extremo del dato vaya redondeado y
 * que la etiqueta del total no se salga del lienzo.
 */
describe('StackedBars', () => {
  /** 'VERDE BOTELLA MUY LARGO' pasa de 22 caracteres: se recorta. */
  const datos: BarraApilada[] = [
    {
      label: 'BLANCO',
      total: 1508.11,
      segmentos: [
        { serie: 'Bodega principal', value: 1308.11, color: 'var(--viz-series-1)' },
        { serie: 'Tienda principal', value: 200, color: 'var(--viz-series-2)' },
      ],
    },
    {
      label: 'VERDE BOTELLA MUY LARGO',
      total: 435.24,
      segmentos: [{ serie: 'Bodega principal', value: 435.24, color: 'var(--viz-series-1)' }],
    },
  ];

  async function montar(data: BarraApilada[]) {
    await TestBed.configureTestingModule({ imports: [StackedBars] }).compileComponents();
    const fixture = TestBed.createComponent(StackedBars);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('la barra más grande llena el área y las demás son proporcionales', async () => {
    const c = (await montar(datos)).componentInstance;
    const [blanco, verde] = c.barras();

    // 1,508.11 es el máximo: su total llega al final del área de dibujo.
    expect(blanco.valX).toBeCloseTo(c.gutter + c.plotW() + 8, 3);
    // 435.24 / 1,508.11 ≈ 28.86%
    const esperado = c.gutter + (435.24 / 1508.11) * c.plotW() + 8;
    expect(verde.valX).toBeCloseTo(esperado, 3);
  });

  it('los pedazos van pegados, en orden, y con el hueco de 2 px entre ellos', async () => {
    const c = (await montar(datos)).componentInstance;
    const [blanco] = c.barras();
    expect(blanco.piezas.length).toBe(2);

    const anchoBodega = (1308.11 / 1508.11) * c.plotW();
    // El primer pedazo arranca en el eje y se le resta el hueco.
    expect(blanco.piezas[0].d).toContain(`M${c.gutter},`);
    const finPrimero = c.gutter + anchoBodega - 2;
    expect(blanco.piezas[0].d).toContain(`L${finPrimero},`);
    // El segundo arranca donde acabaría el primero SIN el hueco: la suma sigue
    // midiendo lo mismo, el hueco no corre la barra.
    expect(blanco.piezas[1].d).toContain(`M${c.gutter + anchoBodega},`);
  });

  it('solo el último pedazo lleva el extremo redondeado', async () => {
    const c = (await montar(datos)).componentInstance;
    const [blanco] = c.barras();
    // Los de en medio son rectos: sin curvas.
    expect(blanco.piezas[0].d).not.toContain('Q');
    // El del extremo del dato sí las lleva (4 px).
    expect(blanco.piezas[1].d).toContain('Q');
  });

  it('un solo almacén dibuja una sola pieza, redondeada', async () => {
    const c = (await montar(datos)).componentInstance;
    const [, verde] = c.barras();
    expect(verde.piezas.length).toBe(1);
    expect(verde.piezas[0].d).toContain('Q');
  });

  it('los almacenes en cero no dibujan pedazos invisibles', async () => {
    const c = (
      await montar([
        {
          label: 'NEGRO',
          total: 100,
          segmentos: [
            { serie: 'Bodega', value: 0, color: 'var(--viz-series-1)' },
            { serie: 'Tienda', value: 100, color: 'var(--viz-series-2)' },
          ],
        },
      ])
    ).componentInstance;
    expect(c.barras()[0].piezas.length).toBe(1);
    expect(c.barras()[0].piezas[0].serie).toBe('Tienda');
  });

  it('la etiqueta del total cabe en el lienzo y el nombre largo se recorta', async () => {
    const c = (await montar(datos)).componentInstance;
    const [blanco, verde] = c.barras();

    // Espacio reservado a la derecha para el número con su unidad ("1,508 kg"),
    // sin que se salga del lienzo.
    expect(blanco.valX + 60).toBeLessThanOrEqual(c.W());
    expect(c.fmt(blanco.total)).toBe('1,508');

    // El nombre largo se recorta (el completo queda en el tooltip).
    expect(verde.corta.length).toBeLessThanOrEqual(22);
    expect(verde.corta.endsWith('…')).toBe(true);
    expect(blanco.corta).toBe('BLANCO');
  });

  it('el alto crece con los renglones: el eje nunca queda fuera de la caja', async () => {
    const c = (await montar(datos)).componentInstance;
    expect(c.alto()).toBe(2 * c.rowH + 8);
  });

  it('el área de dibujo crece con el ancho medido, sin dejar hueco', async () => {
    // El lienzo se mide en pantalla: si la tarjeta es más ancha, las barras se
    // alargan en vez de dejar media tarjeta vacía (y el texto no se escala).
    const c = (await montar(datos)).componentInstance;
    const antes = c.plotW();
    c['medido'].set(1580);
    expect(c.W()).toBe(1580);
    expect(c.plotW()).toBe(1580 - c.gutter - c.padRight);
    expect(c.plotW()).toBeGreaterThan(antes);
    // Y el total sigue cayendo al final de la barra más grande.
    expect(c.barras()[0].valX).toBeCloseTo(c.gutter + c.plotW() + 8, 3);
  });
});
