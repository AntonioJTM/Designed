import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Reportes, pctTexto } from './reportes';
import { periodos } from './periodos';
import { ReportesService } from '../../../core/services/reportes.service';
import { AuthService } from '../../../core/services/auth.service';
import { HiloVentaColor, ReporteVentaColor, ReporteVentas } from '../../../core/models/reportes.models';

/**
 * Reportes → "Venta por color". Lo que importa:
 *   · se pide hasta que se abre la pestaña, con las fechas de arriba, y otra vez
 *     si cambian las fechas o lo que se busca;
 *   · el hilo se nombra con su CALIBRE, y abajo material y línea;
 *   · cada número lleva su unidad y la barra se llena con el mismo % que dice;
 *   · con una búsqueda, la cifra dice qué parte de TODO lo vendido fue ese color;
 *   · la tabla se puede ordenar por "% ya vendido";
 *   · un atajo de periodo mueve las fechas de arriba.
 */
describe('Reportes · Venta por color', () => {
  const hilo = (o: Partial<HiloVentaColor>): HiloVentaColor => ({
    producto_id: 1, color: 'ROJO', calibre: '2/30', material: 'ACRILAN', linea: 'Turco',
    kg_vendidos: 0, importe: 0, pct_del_periodo: 0, vendido_total: 0, existencia: 0,
    pct_vendido: null, ultima_venta: null, ...o,
  });

  function reporte(q: string | null): ReporteVentaColor {
    const hilos = q
      ? [hilo({ kg_vendidos: 50, importe: 4500, pct_del_periodo: 25, vendido_total: 120, existencia: 80,
                pct_vendido: 60, ultima_venta: '2026-10-01' })]
      : [
          hilo({ kg_vendidos: 150, importe: 13500, pct_del_periodo: 75, vendido_total: 300, existencia: 300,
                 pct_vendido: 50, ultima_venta: '2026-10-05' }),
          hilo({ producto_id: 2, color: 'NEGRO', calibre: '1/30', linea: 'Nacional', kg_vendidos: 50, importe: 4500,
                 pct_del_periodo: 25, vendido_total: 90, existencia: 10, pct_vendido: 90, ultima_venta: '2026-10-01' }),
          hilo({ producto_id: 3, color: 'CAMEL', calibre: '2/30', existencia: 306.75, pct_vendido: 0 }),
        ];
    return {
      rango: { desde: '2026-09-23', hasta: '2026-10-06' },
      q,
      periodo: { kg_vendidos: 200, importe: 18000 },
      totales: q
        ? { kg_vendidos: 50, importe: 4500, pct_del_periodo: 25, vendido_total: 120, existencia: 80, pct_vendido: 60,
            num_hilos: 1, num_con_venta: 1 }
        : { kg_vendidos: 200, importe: 18000, pct_del_periodo: 100, vendido_total: 390, existencia: 616.75,
            pct_vendido: 38.74, num_hilos: 3, num_con_venta: 2 },
      hilos,
    };
  }

  const ventas: ReporteVentas = {
    rango: { desde: '', hasta: '' },
    resumen: { num_pedidos: 0, subtotal: '0', descuento: '0', impuestos: '0', total: '0', kilos: 0, kilos_paquete: 0 },
    porCanal: [],
    porDia: [],
  };

  let pedidos: { desde?: string; hasta?: string; q?: string }[] = [];

  async function montar() {
    pedidos = [];
    await TestBed.configureTestingModule({
      imports: [Reportes],
      providers: [
        provideRouter([]),
        {
          provide: ReportesService,
          useValue: {
            ventas: () => of(ventas),
            cortesCaja: () => of({ rango: { desde: '', hasta: '' }, cortes: [] }),
            masVendidos: () => of([]),
            porReabastecer: () => of([]),
            ventaPorColor: (desde?: string, hasta?: string, q?: string) => {
              pedidos.push({ desde, hasta, q });
              return of(reporte(q ? q : null));
            },
          },
        },
        { provide: AuthService, useValue: { puede: () => true } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Reportes);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  const texto = (f: { nativeElement: HTMLElement }) => f.nativeElement.textContent ?? '';

  it('se pide hasta que se abre la pestaña, con las fechas de arriba', async () => {
    const f = await montar();
    const c = f.componentInstance;
    expect(pedidos.length).toBe(0);

    c.elegir('color');
    f.detectChanges();
    expect(pedidos.length).toBe(1);
    expect(pedidos[0]).toEqual(jasmine.objectContaining({ desde: c.rango().desde, hasta: c.rango().hasta, q: '' }));

    // Volver a la pestaña sin cambiar nada no lo pide otra vez.
    c.elegir('ventas');
    c.elegir('color');
    expect(pedidos.length).toBe(1);

    // Cambiar las fechas con la pestaña abierta, sí.
    c.desde = '2026-09-01';
    c.hasta = '2026-09-30';
    c.cargar();
    expect(pedidos.length).toBe(2);
    expect(pedidos[1]).toEqual(jasmine.objectContaining({ desde: '2026-09-01', hasta: '2026-09-30' }));
  });

  it('nombra el hilo con su calibre y dice kilos, porcentaje y lo que queda', async () => {
    const f = await montar();
    f.componentInstance.elegir('color');
    f.detectChanges();
    const t = texto(f);

    expect(t).toContain('ROJO 2/30');
    expect(t).toContain('NEGRO 1/30');
    expect(t).toContain('ACRILAN · Turco');
    expect(t).toContain('150 kg');
    expect(t).toContain('306.75 kg');
    expect(t).toContain('75%');
    expect(t).toContain('última venta 05/10/2026');
    expect(t).toContain('nunca se ha vendido');

    // La barra del % del periodo se llena con el mismo 75% que dice el número.
    const barra = (f.nativeElement as HTMLElement).querySelector('.tabla-color tbody tr .pct-celda .carril > span') as HTMLElement;
    expect(barra.style.width).toBe('75%');

    const kpis = f.componentInstance.kpisColor();
    expect(kpis.map((k) => k.etiqueta)).toEqual(['Kilos vendidos', 'Importe', 'Queda en inventario', 'Hilos']);
    expect(kpis[0].pie).toBe('en 2 hilos');
    expect(kpis[2].pie).toBe('ya se vendió el 38.7%');
    expect(kpis[3].pie).toBe('2 con ventas · 1 sin vender en el periodo');
  });

  it('al buscar un color dice qué parte de todo lo vendido fue', fakeAsync(() => {
    let f!: Awaited<ReturnType<typeof montar>>;
    montar().then((x) => (f = x));
    tick();
    f.componentInstance.elegir('color');
    f.detectChanges();

    f.componentInstance.buscarColor('rojo 2-30');
    tick(299);
    expect(pedidos.length).toBe(1);
    tick(1);
    expect(pedidos.length).toBe(2);
    expect(pedidos[1].q).toBe('rojo 2-30');
    f.detectChanges();

    expect(f.componentInstance.kpisColor()[0].pie).toBe('25% de todo lo vendido');
    expect(f.componentInstance.filasColor().map((h) => h.color)).toEqual(['ROJO']);
  }));

  it('se ordena por "% ya vendido" y lo que no tiene contra qué medirse va al final', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.elegir('color');
    expect(c.filasColor().map((h) => h.color)).toEqual(['ROJO', 'NEGRO', 'CAMEL']);

    c.ordenColor.set('pct_vendido');
    expect(c.filasColor().map((h) => h.color)).toEqual(['NEGRO', 'ROJO', 'CAMEL']);

    c.ordenColor.set('existencia');
    expect(c.filasColor().map((h) => h.color)).toEqual(['CAMEL', 'ROJO', 'NEGRO']);
  });

  it('un atajo de periodo mueve las fechas de arriba y vuelve a pedir el reporte', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.elegir('color');
    const p = periodos(new Date()).find((x) => x.clave === 'mes-1')!;

    c.usarPeriodo('mes-1');
    expect([c.desde, c.hasta]).toEqual([p.desde, p.hasta]);
    expect(c.periodoActual()).toBe('mes-1');
    expect(pedidos.at(-1)).toEqual(jasmine.objectContaining({ desde: p.desde, hasta: p.hasta }));
  });

  it('el porcentaje se lee de un golpe', () => {
    expect(pctTexto(null)).toBe('—');
    expect(pctTexto(0)).toBe('0%');
    expect(pctTexto(0.04)).toBe('< 0.1%');
    expect(pctTexto(18.41)).toBe('18.4%');
    expect(pctTexto(100)).toBe('100%');
  });
});
