import { TestBed } from '@angular/core/testing';
import { Composicion, Tramo } from './composicion';

/**
 * Lo que importa de la barra de composición:
 *   · los tramos suman el total y el hueco de 2 px no descuadra la medida;
 *   · el porcentaje se escribe DENTRO solo si cabe: un número recortado es peor
 *     que ningún número;
 *   · un total en cero no dibuja nada en vez de dividir por cero.
 */
describe('Composicion', () => {
  const RAMPA = ['#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];

  async function montar(valores: number[]) {
    const data: Tramo[] = valores.map((v, i) => ({
      etiqueta: 'T' + i,
      valor: v,
      color: RAMPA[i % 4],
    }));
    await TestBed.configureTestingModule({ imports: [Composicion] }).compileComponents();
    const fixture = TestBed.createComponent(Composicion);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('reparte los tramos en proporción al total', async () => {
    const c = (await montar([25, 25, 50])).componentInstance;
    const t = c.tramos();

    expect(t.length).toBe(3);
    expect(t.map((x) => x.pct)).toEqual([25, 25, 50]);
  });

  it('los tramos en cero no se dibujan', async () => {
    const c = (await montar([100, 0, 50])).componentInstance;
    expect(c.tramos().length).toBe(2);
  });

  it('un total en cero no dibuja nada ni divide por cero', async () => {
    const c = (await montar([0, 0])).componentInstance;
    expect(c.tramos()).toEqual([]);
  });

  it('no escribe el porcentaje en un tramo donde no cabe', async () => {
    // 1% de 900 px son 9 px: no cabe "1%" con aire a los lados.
    const c = (await montar([99, 1])).componentInstance;
    const [grande, chico] = c.tramos();

    expect(grande.cabe).toBe(true);
    expect(chico.cabe).toBe(false);
  });

  it('elige la letra de MAYOR contraste: tinta en los dos azules claros, blanca en los oscuros', async () => {
    const c = (await montar([25, 25, 25, 25])).componentInstance;
    const t = c.tramos();

    // Auditoría 2026-10-13: sobre el segundo azul la blanca daba 3.64:1 y la tinta da 4.78:1.
    expect(t.map((x) => x.textoClaro)).toEqual([false, false, true, true]);
  });

  it('el lector de pantalla oye cada tramo con su cifra y su parte del total', async () => {
    const f = await montar([75, 25]);
    f.componentRef.setInput('descripcion', 'Desde cuándo te deben');
    f.detectChanges();
    const svg = f.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('aria-label')).toBe('Desde cuándo te deben. T0: $75 (75%); T1: $25 (25%).');
  });
});
