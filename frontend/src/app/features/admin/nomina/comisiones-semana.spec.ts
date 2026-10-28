import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ComisionesSemanaComponent } from './comisiones-semana';
import { NominaService } from '../../../core/services/nomina.service';
import { ComisionesSemana } from '../../../core/models/nomina.models';

/**
 * El reporte de comisiones (2026-10-07): la comisión de cada venta se paga la
 * semana en que queda pagada. Por vendedor dice qué ventas paga esta nómina y
 * cuáles todavía deben (fiadas, apartados, pedidos).
 */
const datos: ComisionesSemana = {
  regla: 'al_liquidar',
  desde: '2026-10-04',
  vendedores: [
    {
      recibo_id: 1, usuario_id: 7, usuario: 'Rosa Hernández', rol: 'cajero', porcentaje: 3,
      ventas_netas: 1800, comision: 54,
      ventas: [
        { pedido_id: 10, numero_pedido: 'POS-1790000000000-AAAA', cliente: 'Doña Chela', tipo: 'pedido',
          vendida_en: '2026-10-12 11:00:00', liquidada_en: '2026-10-12 11:00:00', total: 1120, venta_neta: 1000, comision: 30 },
        { pedido_id: 11, numero_pedido: 'POS-1790000000000-BBBB', cliente: null, tipo: 'credito',
          vendida_en: '2026-10-06 10:00:00', liquidada_en: '2026-10-14 09:00:00', total: 800, venta_neta: 800, comision: 24 },
      ],
      por_liquidar: [
        { pedido_id: 12, numero_pedido: 'POS-1790000000000-CCCC', cliente: 'Don Juan', tipo: 'apartado', usuario_id: 7,
          vendida_en: '2026-10-13 10:00:00', liquidada_en: null, total: 600, venta_neta: 600, comision: 18, pagado: 100, falta: 500 },
      ],
      por_liquidar_comision: 18, por_liquidar_debe: 500,
      proxima_nomina: { ventas: 1, venta_neta: 500, comision: 15 },
    },
    {
      recibo_id: 2, usuario_id: 8, usuario: 'Carlos', rol: 'almacenista', porcentaje: 0,
      ventas_netas: 0, comision: 0, ventas: [], por_liquidar: [], por_liquidar_comision: 0, por_liquidar_debe: 0,
      proxima_nomina: { ventas: 0, venta_neta: 0, comision: 0 },
    },
  ],
};

describe('ComisionesSemanaComponent', () => {
  let pedidos: { periodo: number; usuario?: number }[] = [];

  async function montar(usuarioId: number | null = null, respuesta: ComisionesSemana = datos) {
    pedidos = [];
    await TestBed.configureTestingModule({
      imports: [ComisionesSemanaComponent],
      providers: [
        provideRouter([]),
        {
          provide: NominaService,
          useValue: {
            comisiones: (periodo: number, usuario?: number) => {
              pedidos.push({ periodo, usuario });
              return of(usuarioId ? { ...respuesta, vendedores: [respuesta.vendedores[0]] } : respuesta);
            },
          },
        },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(ComisionesSemanaComponent);
    f.componentRef.setInput('periodoId', 5);
    if (usuarioId) f.componentRef.setInput('usuarioId', usuarioId);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return f;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('por vendedor: lo que se paga, lo que falta por liquidar y quién no cobra', async () => {
    const f = await montar();
    const texto = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(pedidos).toEqual([{ periodo: 5, usuario: undefined }]);
    expect(texto).toContain('Rosa Hernández');
    expect(texto).toContain('2 ventas pagadas');
    expect(texto).toContain('A crédito');
    expect(texto).toContain('sin $120.00 de envío o IVA');
    expect(texto).toContain('Por liquidar al día de hoy');
    expect(texto).toContain('1 venta ya pagada entra en la próxima nómina');
    expect(texto).toContain('Sin comisión ni ventas esta semana: Carlos.');
    expect(texto).toContain('una vez, completa');
  });

  it('lo que regresó: la venta dice cuánto, y el descuento de una ya pagada va en negativo (2026-10-14)', async () => {
    const conDevolucion: ComisionesSemana = {
      ...datos,
      vendedores: [{
        ...datos.vendedores[0],
        ventas: [
          { pedido_id: 8, numero_pedido: 'POS-1-DDDD', cliente: 'Doña Chela', tipo: 'contado', vendida_en: '2026-10-12 10:00:00',
            liquidada_en: '2026-10-12 10:00:00', total: 1000, venta_neta: 600, devuelto: 400, comision: 18 },
          { pedido_id: 9, numero_pedido: 'POS-1-EEEE', cliente: 'Doña Chela', tipo: 'devolucion', vendida_en: '2026-10-05 10:00:00',
            liquidada_en: '2026-10-13 11:00:00', total: 0, venta_neta: -250, devuelto: 250, comision: -7.5 },
        ],
        proxima_nomina: { ventas: 0, devoluciones: 1, venta_neta: -100, comision: -3 },
      }],
    };
    const f = await montar(null, conDevolucion);
    const texto = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('1 venta pagada');
    expect(texto).toContain('regresaron $400.00');
    expect(texto).not.toContain('de envío o IVA');
    expect(texto).toContain('Devolución');
    expect(texto).toContain('se descuenta');
    expect(texto).toContain('1 descuento (regresó o se canceló una venta ya pagada) se aplica en la próxima nómina');
  });

  it('en el recibo: solo esa persona, sin la explicación de arriba', async () => {
    const f = await montar(7);
    const texto = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(pedidos).toEqual([{ periodo: 5, usuario: 7 }]);
    expect(texto).toContain('Comisión de la semana');
    expect(texto).not.toContain('una vez, completa');
    expect(f.componentInstance.suma(datos.vendedores[0].ventas, 'comision')).toBe(54);
  });

  it('una venta que regresó completa no cuenta como venta ni suma su total (2026-10-20)', async () => {
    const c = (await montar()).componentInstance;
    const lista = [
      { pedido_id: 1, numero_pedido: 'POS-1-AAAA', cliente: null, tipo: 'contado', vendida_en: '2026-10-19 10:00:00',
        liquidada_en: '2026-10-19 10:00:00', total: 2726, venta_neta: 0, devuelto: 2350, comision: 0 },
      { pedido_id: 2, numero_pedido: 'POS-1-BBBB', cliente: null, tipo: 'contado', vendida_en: '2026-10-19 11:00:00',
        liquidada_en: '2026-10-19 11:00:00', total: 14761, venta_neta: 12725, comision: 381.75 },
    ] as unknown as Parameters<typeof c.ventasDe>[0];
    expect(c.ventasDe(lista)).toBe(1);
    expect(c.suma(lista, 'total')).toBe(14761);
    expect(c.devueltaCompleta(lista[0])).toBeTrue();
  });
});
