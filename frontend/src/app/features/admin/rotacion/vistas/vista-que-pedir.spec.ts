import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { VistaQuePedir } from './vista-que-pedir';
import { RotacionService } from '../../../../core/services/rotacion.service';
import { EstadoPedido, HiloRotacion, QuePedirRotacion } from '../../../../core/models/rotacion.models';

/** Un hilo de «Qué pedir» con lo mínimo. */
function hilo(id: number, color: string, estado: EstadoPedido, pedir: string | null, kg: number | null, paquetes: number | null = null): HiloRotacion {
  return {
    producto_id: id, hilo: `${color} 2/30`, color, calibre: '2/30', material: 'ACRILAN', vendido_12m: 1000,
    rotacion: null, contra_anio_pasado: null, temporada: null,
    hay: { kg: 500, en_camino: 0, paquetes: 30, peso_paquete: 16.4, almacenes: 2 },
    se_vende_semana: 50, alcanza_semanas: 10, se_acaba: '2027-01-14', pedir, estado,
    pedido: kg != null ? { kg, paquetes, llega: '2026-12-30' } : null, nota: null,
  };
}

function datos(hilos: HiloRotacion[], extra: Partial<QuePedirRotacion> = {}): QuePedirRotacion {
  return {
    hoy: '2026-10-22',
    historia: { desde: '2025-01-05', dias: 655, semanas: 93, nivel: 'confiable', meses_completos: 21, sistema_desde: '2026-10-14', hay_anteriores: true, faltan_semanas: 0 },
    ajustes: { semanas_proveedor: 10, semanas_colchon: 3, meses_cubre: 4, kg_contenedor: null, confirmados: false },
    hilos,
    totales: {
      ya: { hilos: 2, kg: 2580, paquetes: 157 },
      proximos: { hilos: 3, kg: 4050, paquetes: 246 },
      calma: { hilos: 1, desde: '2027-04-11', hasta: '2027-04-11' },
      sobra: { hilos: 1, kg: 5100, uno: { hilo: 'OPTIK 2/30', alcanza: 'más de 3 años' } },
    },
    ...extra,
  };
}

/**
 * «Qué pedir»:
 *   · de entrada van en el pedido los de «Pedir ya» y los de los próximos meses;
 *   · el que viene de «Agregar al pedido» (Por hilo) también;
 *   · lo que sobra no se puede marcar;
 *   · el pedido suma kilos y paquetes de lo marcado y el archivo pide esos hilos;
 *   · "ya pasó" va marcado.
 */
describe('VistaQuePedir', () => {
  let pedidos: number[][];

  async function montar(d: QuePedirRotacion, agregar: string | null = null) {
    pedidos = [];
    await TestBed.configureTestingModule({
      imports: [VistaQuePedir],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(agregar ? { agregar } : {}) } } },
        { provide: RotacionService, useValue: { quePedirCsv: (ids: number[]) => { pedidos.push(ids); return of(new Blob(['x'])); } } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(VistaQuePedir);
    f.componentRef.setInput('datos', d);
    f.detectChanges();
    return f;
  }

  afterEach(() => TestBed.resetTestingModule());

  const LISTA = [
    hilo(1, 'MARINO', 'ya', '2026-10-15', 1580, 96),
    hilo(2, 'OXFORD JASPE', 'ya', '2026-10-28', 1000, 61),
    hilo(3, 'HUESO', 'pronto', '2026-12-26', 1470, 89),
    hilo(4, 'CAMEL', 'calma', '2027-04-11', 1910, 116),
    hilo(5, 'OPTIK', 'sobra', null, null),
  ];

  it('de entrada van los de ya y los próximos; sobra no se puede marcar', async () => {
    const f = await montar(datos(LISTA));
    const c = f.componentInstance;
    expect([...c.elegidos()].sort()).toEqual([1, 2, 3]);
    const casillas = (f.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]');
    expect(casillas.length).toBe(5);
    expect(casillas[4].disabled).toBe(true);
    expect(casillas[3].checked).toBe(false);
    expect(c.pedido().kg).toBe(4050);
    expect(c.pedido().paquetes).toBe(246);
    expect(c.titulo()).toBe('3 hilos · 4,050 kg (4.05 t) · ≈ 246 paquetes');
  });

  it('el que viene de «Agregar al pedido» entra marcado', async () => {
    const c = (await montar(datos(LISTA), '4')).componentInstance;
    expect(c.elegidos().has(4)).toBe(true);
  });

  it('marcar y desmarcar cambia el pedido y el archivo pide esos hilos', async () => {
    const f = await montar(datos(LISTA));
    const c = f.componentInstance;
    c.alternar(LISTA[3], true);
    c.alternar(LISTA[0], false);
    expect([...c.elegidos()].sort()).toEqual([2, 3, 4]);
    c.bajar();
    expect(pedidos).toEqual([[2, 3, 4]]);
  });

  it('dice «ya pasó» en naranja y el estado de cada uno', async () => {
    const f = await montar(datos(LISTA));
    const el = f.nativeElement as HTMLElement;
    const filas = el.querySelectorAll('tbody tr');
    expect(filas[0].querySelector('.cuando.ya-paso')?.textContent).toContain('ya pasó');
    expect(filas[0].querySelector('.pill.naranja')?.textContent).toContain('Pedir ya');
    expect(filas[2].querySelector('.pill.ambar')?.textContent).toContain('En diciembre');
    expect(filas[4].textContent).toContain('No hace falta');
  });

  it('sin ajustes guardados dice «Por confirmar», y el pedido al proveedor va apagado', async () => {
    const el = (await montar(datos(LISTA))).nativeElement as HTMLElement;
    expect(el.querySelector('.ajustes-barra .pill.ambar')?.textContent).toContain('Por confirmar');
    const botones = [...el.querySelectorAll<HTMLButtonElement>('.el-pedido button')];
    const hacer = botones.find((b) => b.textContent?.includes('Hacer pedido'));
    expect(hacer?.disabled).toBe(true);
    expect(el.querySelectorAll('.btn-primary').length).toBe(1);
  });

  it('«Cambiar» los tiempos solo con su permiso', async () => {
    const f = await montar(datos(LISTA));
    const boton = () => [...(f.nativeElement as HTMLElement).querySelectorAll('.ajustes-barra button')].find((b) => b.textContent?.includes('Cambiar'));
    expect(boton()).toBeUndefined();
    f.componentRef.setInput('puedeCambiar', true);
    f.detectChanges();
    expect(boton()).toBeDefined();
  });

  it('con poca historia solo dice cuántas semanas faltan', async () => {
    const d = datos([]);
    d.historia = { ...d.historia, nivel: 'poca', dias: 8, faltan_semanas: 3 };
    const el = (await montar(d)).nativeElement as HTMLElement;
    expect(el.querySelector('.aviso')?.textContent).toContain('Faltan 3 semanas');
    expect(el.querySelector('table')).toBeNull();
  });
});
