import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Tablero } from './tablero';
import { AnalisisService } from '../../../core/services/analisis.service';
import { ReportesService } from '../../../core/services/reportes.service';
import { AuthService } from '../../../core/services/auth.service';
import { Tablero as DatosTablero } from '../../../core/models/analisis.models';
import { ReporteVentas } from '../../../core/models/reportes.models';

/**
 * "Cómo va el negocio". Lo que importa:
 *   · el margen EXPONE COSTOS: sin «Ver costos y márgenes» no se dibuja su
 *     tarjeta ni la ganancia (el servidor además lo manda en null);
 *   · el hilo parado SÍ se ve sin ese permiso, valorado a precio de venta, con
 *     lo que se ha vendido de cada hilo (la tienda no lleva el costo);
 *   · el botón "Ver" del expediente solo sale a quien puede abrir Clientes;
 *   · los hilos que pierden dinero no se quedan fuera de la gráfica aunque
 *     haya muchos que ganan;
 *   · la última de las 12 semanas es la resaltada.
 */
describe('Tablero', () => {
  function datos(conCostos: boolean): DatosTablero {
    return {
      cobranza: {
        total_por_cobrar: 5000, num_clientes: 1, vencido: 0, num_vencidos: 0, dias_aviso: 30,
        por_antiguedad: [{ clave: 'al_dia', etiqueta: 'Al día (0-30 días)', monto: 5000, clientes: 1 }],
        clientes: [{ cliente_id: 7, nombre: 'María López', nombre_comercial: 'Doña Mari', saldo: '5000.00', dias_sin_abonar: 4 }],
      },
      clientes_enfriados: { dias: 60, min_compras: 2, num_clientes: 0, venta_en_riesgo: 0, clientes: [] },
      // Con costos se valora al costo; sin ellos, a precio de venta (90 × 20 kg).
      hilo_muerto: conCostos
        ? { dias: 90, dinero_parado: 1200, kilos_parados: 20, num_hilos: 1, nunca_vendidos: 0, hay_sin_costo: false,
            valorado_a: 'costo',
            hilos: [{ producto_id: 1, color: 'MORADO', calibre: '1/30', variante_id: 11, sku: 'MORADO', tipo_presentacion: 'paquete',
                      precio: '90', kilos: '20.000', dias_parado: 104, nunca_vendido: 0, dinero_parado: '1200.00', valorado_a: 'costo',
                      kg_vendidos_historico: '35.500', ultima_salida: '2026-06-20 10:00:00' }] }
        : { dias: 90, dinero_parado: 1800, kilos_parados: 20, num_hilos: 1, nunca_vendidos: 0, hay_sin_costo: false,
            valorado_a: 'precio_venta',
            hilos: [{ producto_id: 1, color: 'MORADO', calibre: '1/30', variante_id: 11, sku: 'MORADO', tipo_presentacion: 'paquete',
                      precio: '90', kilos: '20.000', dias_parado: 104, nunca_vendido: 0, dinero_parado: '1800.00', valorado_a: 'precio_venta',
                      kg_vendidos_historico: '35.500', ultima_salida: '2026-06-20 10:00:00' }] },
      margen: conCostos
        ? { desde: null, hasta: null, venta_analizada: 1000, ganancia: 200, margen_pct: 20, sin_costo_lineas: 0, sin_costo_venta: 0,
            hilos: [
              ...Array.from({ length: 12 }, (_, i) => ({
                producto_id: 100 + i, color: `GANA${i}`, calibre: '2/30', kilos: '1', venta: '100', costo: '80',
                ganancia: String(100 - i), margen_pct: '20', num_ventas: 1,
              })),
              { producto_id: 999, color: 'TURQUESA', calibre: '1/30', kilos: '1', venta: '100', costo: '106',
                ganancia: '-6.00', margen_pct: '-6', num_ventas: 1 },
            ] }
        : null,
    };
  }

  const ventas: ReporteVentas = {
    rango: { desde: '', hasta: '' },
    resumen: { num_pedidos: 3, subtotal: '900', descuento: '0', impuestos: '100', total: '1000.00' },
    porCanal: [],
    porDia: [],
  };

  async function montar(permisos: string[]) {
    await TestBed.configureTestingModule({
      imports: [Tablero],
      providers: [
        provideRouter([]),
        { provide: AnalisisService, useValue: { tablero: () => of(datos(permisos.includes('hacer:ver_costos'))) } },
        { provide: ReportesService, useValue: { ventas: () => of(ventas) } },
        { provide: AuthService, useValue: { puede: (p: string | null) => p === null || permisos.includes(p) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Tablero);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('sin «Ver costos» no hay ganancia ni margen, pero sí el hilo parado a precio de venta', async () => {
    const f = await montar(['ver:negocio']);
    const c = f.componentInstance;
    const texto = (f.nativeElement as HTMLElement).textContent ?? '';

    expect(c.kpis().map((k) => k.etiqueta)).not.toContain('Ganancia');
    expect(texto).not.toContain('Qué colores dejan dinero');
    // El hilo parado: existencias × precio de venta, con lo que se ha vendido.
    expect(c.kpis().map((k) => k.etiqueta)).toContain('Dinero en hilo parado');
    expect(texto).toContain('Hilo parado');
    expect(texto).toContain('valorado a precio de venta');
    expect(texto).toContain('a $90.00 el kg');
    expect(texto).toContain('35.5 kg');
    expect(texto).toContain('última venta');
    expect(texto).not.toContain('al costo');
    // La cobranza sí se ve: no expone costos.
    expect(texto).toContain('Lo que te deben');
  });

  it('con «Ver costos» aparecen las cuatro cifras y las dos tarjetas', async () => {
    const f = await montar(['ver:negocio', 'hacer:ver_costos']);
    const texto = (f.nativeElement as HTMLElement).textContent ?? '';

    expect(f.componentInstance.kpis().length).toBe(4);
    expect(texto).toContain('Qué colores dejan dinero');
    expect(texto).toContain('Hilo parado');
    expect(texto).toContain('MORADO 1/30');
  });

  it('el botón "Ver" del expediente solo sale a quien puede abrir Clientes', async () => {
    let f = await montar(['ver:negocio']);
    expect((f.nativeElement as HTMLElement).querySelector('a[href="/admin/clientes/7"]')).toBeNull();
    TestBed.resetTestingModule();

    f = await montar(['ver:negocio', 'ver:clientes']);
    expect((f.nativeElement as HTMLElement).querySelector('a[href="/admin/clientes/7"]')).not.toBeNull();
  });

  it('el hilo que pierde dinero no se queda fuera de la gráfica', async () => {
    const c = (await montar(['ver:negocio', 'hacer:ver_costos'])).componentInstance;
    const barras = c.barrasMargen();
    expect(barras.length).toBe(11); // los 10 que más dejan + el que pierde
    const ultima = barras[barras.length - 1];
    expect(ultima.etiqueta).toBe('TURQUESA 1/30');
    expect(ultima.valor).toBeLessThan(0);
    // El signo va antes del símbolo.
    expect(ultima.rotulo).toContain('-$6');
    expect(c.hayPerdidas()).toBe(true);
  });

  it('dibuja 12 semanas y resalta la última', async () => {
    const c = (await montar(['ver:negocio'])).componentInstance;
    const cols = c.columnasSemanas();
    expect(cols.length).toBe(12);
    expect(cols.filter((x) => x.fuerte).length).toBe(1);
    expect(cols[11].fuerte).toBe(true);
  });
});
