import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ComoSeCalculaModal } from './como-se-calcula-modal';
import { RotacionService } from '../../../core/services/rotacion.service';
import { HiloDetalle } from '../../../core/models/rotacion.models';

const MES = (mes: number, kg: number | null) => ({ mes, kg, origen: kg == null ? null : ('real' as const) });

/** El ejemplo del diseño: MARINO 2/30, con dos años de ventas. */
function marino(): HiloDetalle {
  return {
    hoy: '2026-10-21',
    historia: { desde: '2025-01-05', dias: 654, semanas: 93, nivel: 'confiable', meses_completos: 21, sistema_desde: '2026-10-14', hay_anteriores: true, faltan_semanas: 0 },
    ajustes: { semanas_proveedor: 10, semanas_colchon: 3, meses_cubre: 4, kg_contenedor: null, confirmados: false },
    hilos: [{ producto_id: 1, hilo: 'MARINO 2/30' }],
    explica: {
      modelo: 'temporada', anual: 6205, mes_normal: 517,
      mejor: { mes: 9, anio: 2025, kg: 851 },
      siguiente: { mes: 11, anio: 2026, base_anio: 2025, base_kg: 626, kg: 701 },
      promedio_semana: null,
    },
    hilo: {
      producto_id: 1, hilo: 'MARINO 2/30', color: 'MARINO', calibre: '2/30', material: 'ACRILAN', vendido_12m: 6799,
      rotacion: { veces: 2.6, cada_dias: 140, se_mueve: 'rapido', existencia_promedio: 2615, dias: 365, kardex_cuadra: true },
      contra_anio_pasado: 1.12, temporada: 'Agosto a octubre',
      hay: { kg: 1720, en_camino: 0, paquetes: 105, peso_paquete: 16.4, almacenes: 2 },
      se_vende_semana: 182, alcanza_semanas: 9.5, se_acaba: '2027-01-14', pedir: '2026-10-15', estado: 'ya',
      pedido: { kg: 1580, paquetes: 96, llega: '2026-12-30' }, nota: null,
      presentaciones: ['paquete', 'cono'], pct_del_total: 21, lugar: 1,
      tendencia: { valor: 1.12, comparable: true, actual: 4824, anterior: 4304, meses: 9, hasta_mes: 9, anio: 2026 },
    },
    pedido_hoy: { kg: 1580, paquetes: 96, llega: '2026-12-30', quedan_al_llegar: 221, se_vendera: 1800 },
    meses: { anio_anterior: 2025, anio_actual: 2026, corte: 21, mes_actual: 10, anterior: Array.from({ length: 12 }, (_, i) => MES(i + 1, 500)), actual: Array.from({ length: 12 }, (_, i) => MES(i + 1, 520)) },
    temporada: { texto: 'agosto a octubre', num_meses: 3, pct_del_anio: 38, mejor: { mes: 9, indice: 1.65, kg: [{ anio: 2025, kg: 851 }] }, peor: { mes: 2, indice: 0.7, kg: [{ anio: 2025, kg: 360 }] }, veces_mejor_peor: 2.4 },
    proyeccion: { semanas: [], llega_semana: null, siguiente: null },
    almacenes: [], hay_sin_mostrador: false, avisos: [],
    como_se_vende: { paquete: 5711, cono: 1088, otro: 0 },
    cargas: [], cada_cuanto: null,
  };
}

const texto = (el: HTMLElement, i: number) => el.querySelectorAll('.paso')[i].textContent!.replace(/\s+/g, ' ');

/**
 * «¿Cómo se calcula?»: los 7 pasos con los números del hilo que más se vende,
 * los mismos del diseño (MARINO: 2.6 veces al año, 1.65, 701 kg, 15 de octubre,
 * 1,580 kg), y el botón de cargar ventas anteriores solo para quien puede.
 */
describe('ComoSeCalculaModal', () => {
  async function montar(d: HiloDetalle, puede = true) {
    await TestBed.configureTestingModule({
      imports: [ComoSeCalculaModal],
      providers: [{ provide: RotacionService, useValue: { hilo: () => of(d) } }],
    }).compileComponents();
    const f = TestBed.createComponent(ComoSeCalculaModal);
    f.componentRef.setInput('puedeCargar', puede);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('trae los siete pasos con sus números', async () => {
    const el = await montar(marino());
    expect(el.querySelectorAll('.paso').length).toBe(7);
    expect(el.querySelector('.modal-head')!.textContent).toContain('Con el ejemplo de MARINO 2/30');
    expect(texto(el, 0)).toContain('MARINO vendió 6,799 kg en los últimos 12 meses: 5,711 kg en paquete y 1,088 kg en cono.');
    expect(texto(el, 1)).toContain('2.6 veces al año');
    expect(texto(el, 1)).toContain('140 días');
    expect(texto(el, 2)).toContain('851 ÷ 517 = 1.65, o sea 65% más');
    expect(texto(el, 2)).toContain('Agosto a octubre pasan del 30%');
    expect(texto(el, 3)).toContain('va 12% arriba (× 1.12)');
    expect(texto(el, 3)).toContain('626 × 1.12 = 701 kg');
    expect(texto(el, 4)).toContain('se acaba hacia el 14 de enero');
    expect(texto(el, 4)).toContain('(13 semanas, 91 días): 15 de octubre');
    expect(texto(el, 4)).toContain('ya pasó, sale «Pedir ya»');
    expect(texto(el, 5)).toContain('1,800 − 221 ≈ 1,580 kg, unos 96 paquetes de 16.4 kg');
    expect(el.querySelector('.cargar button')).not.toBeNull();
  });

  it('sin un año de ventas el paso 4 usa el promedio de las semanas', async () => {
    const d = marino();
    d.historia = { ...d.historia, nivel: 'sin_temporada', dias: 113 };
    d.explica = { modelo: 'promedio', anual: null, mes_normal: null, mejor: null, siguiente: null, promedio_semana: 142.4 };
    d.temporada = null;
    const el = await montar(d, false);
    expect(texto(el, 2)).toContain('hace falta un año completo');
    expect(texto(el, 3)).toContain('142.4 kg por semana');
    expect(el.querySelector('.cargar button')).toBeNull();
  });
});
