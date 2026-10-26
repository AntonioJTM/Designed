import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { VistaHilo } from './vista-hilo';
import { HiloDetalle } from '../../../../core/models/rotacion.models';
import { AuthService } from '../../../../core/services/auth.service';

const MES = (mes: number, kg: number | null) => ({ mes, kg, origen: kg == null ? null : ('real' as const) });

function hilo(extra: Partial<HiloDetalle['hilo']> = {}, pedidoHoy: HiloDetalle['pedido_hoy'] = null): HiloDetalle {
  return {
    hoy: '2026-10-22',
    historia: { desde: '2026-07-02', dias: 113, semanas: 16, nivel: 'sin_temporada', meses_completos: 2, sistema_desde: '2026-07-02', hay_anteriores: false, faltan_semanas: 0 },
    ajustes: { semanas_proveedor: 10, semanas_colchon: 3, meses_cubre: 4, kg_contenedor: null, confirmados: false },
    hilos: [{ producto_id: 191, hilo: 'GRIS OXFORD 1/30' }],
    explica: { modelo: 'promedio', anual: null, mes_normal: null, mejor: null, siguiente: null, promedio_semana: 142.4 },
    hilo: {
      producto_id: 191, hilo: 'GRIS OXFORD 1/30', color: 'GRIS OXFORD', calibre: '1/30', material: 'ACRILAN', vendido_12m: 2217,
      rotacion: { veces: 11.1, cada_dias: 33, se_mueve: 'rapido', existencia_promedio: 641, dias: 114 },
      contra_anio_pasado: null, temporada: null,
      hay: { kg: 377.5, en_camino: 0, paquetes: 19, peso_paquete: 18.6, almacenes: 3 },
      se_vende_semana: 142.4, alcanza_semanas: 2.7, se_acaba: '2026-11-09', pedir: '2026-08-10', estado: 'ya',
      pedido: { kg: 2870, paquetes: 154, llega: '2026-12-31' }, nota: null,
      presentaciones: ['paquete', 'cono'], pct_del_total: 18.1, lugar: 1,
      tendencia: { valor: 1, comparable: false, actual: 0, anterior: 0, meses: 0, hasta_mes: 9, anio: 2026 },
      ...extra,
    },
    pedido_hoy: pedidoHoy,
    meses: { anio_anterior: 2025, anio_actual: 2026, corte: 22, mes_actual: 10, anterior: Array.from({ length: 12 }, (_, i) => MES(i + 1, null)), actual: Array.from({ length: 12 }, (_, i) => MES(i + 1, i >= 7 ? 700 : null)) },
    temporada: null,
    proyeccion: { semanas: [], llega_semana: null, siguiente: null },
    almacenes: [
      { almacen_id: 2, nombre: 'Bodega principal', vende: false, es_matriz: true, hay_kg: 200, paquetes: 11, vende_semana: null, alcanza_semanas: null, se_acaba: null, surtirle: false },
      { almacen_id: 1, nombre: 'Tienda principal', vende: true, es_matriz: false, hay_kg: 153, paquetes: 5, vende_semana: 70.1, alcanza_semanas: 2.2, se_acaba: '2026-11-06', surtirle: true },
    ],
    hay_sin_mostrador: true,
    avisos: [{ almacen_id: 1, texto: 'Tienda principal se queda sin GRIS OXFORD hacia el 6 de noviembre. Bodega principal tiene 200 kg para surtirle.' }],
    como_se_vende: { paquete: 2068, cono: 149, otro: 0 },
    cargas: [{ fecha: '2026-09-12', kg: 661, almacen: 'Bodega principal' }],
    cada_cuanto: 'Llega cada mes.',
  };
}

/**
 * Por hilo:
 *   · «Pedir ya» con la fecha que ya pasó y, si el pedido llega después de que se
 *     acaba, cuántas semanas faltaría;
 *   · lo que sobra no ofrece agregarlo al pedido;
 *   · el almacén sin mostrador «No vende» y la tienda corta lleva «Surtirle pronto»
 *     con el botón a Surtir sucursal;
 *   · paquete contra cono suma 100%.
 */
describe('VistaHilo', () => {
  async function montar(d: HiloDetalle, surte = true) {
    await TestBed.configureTestingModule({
      imports: [VistaHilo],
      providers: [provideRouter([]), { provide: AuthService, useValue: { puede: (p: string) => p === 'ver:surtir' && surte } }],
    }).compileComponents();
    const f = TestBed.createComponent(VistaHilo);
    f.componentRef.setInput('datos', d);
    f.detectChanges();
    return f;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('pedir ya: había que pedirlo, y dice cuánto faltaría', async () => {
    const f = await montar(hilo({}, { kg: 2870, paquetes: 154, llega: '2026-12-31', quedan_al_llegar: 0, se_vendera: 2868 }));
    const b = f.componentInstance.banner()!;
    expect(b.titulo).toBe('Pedir ya: había que pedirlo el 10 de agosto');
    expect(b.texto).toContain('se acaba antes, hacia el 9 de noviembre: faltaría unas 7 semanas');
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.banner-pedido .btn-primary')?.textContent).toContain('Agregar 2,870 kg al pedido');
  });

  it('si llega antes de que se acabe, dice lo que queda al llegar', async () => {
    const f = await montar(hilo({ se_acaba: '2027-01-20', pedir: '2026-10-21' }, { kg: 1580, paquetes: 96, llega: '2026-12-31', quedan_al_llegar: 221, se_vendera: 1800 }));
    const b = f.componentInstance.banner()!;
    expect(b.texto).toContain('para entonces quedan unos 221 kg');
    expect(b.texto).toContain('Si no se pide, se acaba hacia el 20 de enero');
  });

  it('lo que sobra no ofrece agregarlo al pedido', async () => {
    const f = await montar(hilo({ estado: 'sobra', pedido: null, alcanza_semanas: 80 }));
    expect(f.componentInstance.banner()!.titulo).toBe('Sobra: no hace falta pedir');
    expect((f.nativeElement as HTMLElement).querySelector('.banner-pedido .btn-primary')).toBeNull();
  });

  it('cada almacén: la bodega no vende y a la tienda hay que surtirle', async () => {
    const el = (await montar(hilo())).nativeElement as HTMLElement;
    const filas = el.querySelectorAll('table.almacenes tbody tr');
    expect(filas[0].textContent).toContain('No vende');
    expect(filas[1].querySelector('.pill.ambar')?.textContent).toContain('Surtirle pronto');
    expect(el.querySelector('.aviso-surtir a')?.getAttribute('href')).toBe('/admin/traspasos');
  });

  it('sin Surtir sucursal (Contabilidad) el aviso va sin el botón', async () => {
    const el = (await montar(hilo(), false)).nativeElement as HTMLElement;
    expect(el.querySelector('.aviso-surtir')?.textContent).toContain('se queda sin GRIS OXFORD');
    expect(el.querySelector('.aviso-surtir a')).toBeNull();
  });

  it('paquete contra cono', async () => {
    const c = (await montar(hilo())).componentInstance;
    const partes = c.comoSeVende()!;
    expect(partes.map((p) => p.texto)).toEqual(['En paquete', 'En cono']);
    expect(partes[0].pct + partes[1].pct).toBe(100);
  });
});
