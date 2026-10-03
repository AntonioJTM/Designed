import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ClientesPantalla } from './clientes';
import { RedisenoService } from '../../../core/services/rediseno.service';
import { AuthService } from '../../../core/services/auth.service';
import { ClientesService } from '../../../core/services/clientes.service';
import { VentasService } from '../../../core/services/ventas.service';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { Deuda, Frecuencia, Gasto, VistaClientes } from '../../../core/models/rediseno.models';

/**
 * La sección Clientes:
 *   · cada ruta dice su pestaña (`data.vista`) y se pide SOLO esa al servidor;
 *   · el periodo sale de `?dias=` (lo conservan las pestañas);
 *   · Cuánto debe no tiene periodo: el saldo es el de hoy;
 *   · la cabecera reusa la respuesta de la pestaña cuando es la misma.
 *   · en Frecuencia, "A los que ya les toca" no enseña a los que van bien;
 *   · la frecuencia dice también cuánto se llevan, en kilos y en dinero;
 *   · Dejaron de venir pide el corte de la campana (60 días) si no se dice otro.
 */
describe('ClientesPantalla', () => {
  const gasto: Gasto = {
    dias: 90, total_clientes: 1000, total_ventas: 2000, pct_de_ventas: 50, compras: 2, ticket: 500,
    gasto_mes: 333, pct_top10: 100, compran_mas: 1, compran_menos: 0, nuevos: 1,
    por_lista: [{ lista: 'Público', total: 1000, pct: 100 }],
    clientes: [
      { pos: 1, cliente_id: 1, nombre: 'Boutique Lucy', total: 1000, compras: 2, ticket: 500, antes: 0, cambio_pct: null, acumulado_pct: 100 },
      { pos: 2, cliente_id: 2, nombre: 'Taller Martínez', total: 0, compras: 0, ticket: null, antes: 0, cambio_pct: null, acumulado_pct: null },
    ],
  };
  const deuda: Deuda = {
    total_por_cobrar: 500, num_clientes: 1, vencido: 0, num_vencidos: 0, dias_aviso: 30,
    por_antiguedad: [{ clave: 'al_dia', etiqueta: 'Al día', monto: 500, clientes: 1 }],
    clientes: [{ cliente_id: 2, nombre: 'Taller Martínez', limite_credito: '1000.00', saldo: '500.00', dias_sin_abonar: 3, tramo: 'al_dia' }],
    credito_usado: 500, credito_autorizado: 1000, cobrado_mes: { monto: 0, abonos: 0 },
  };
  const frecuencia: Frecuencia = {
    dias: 90, total_clientes: 2, mediana_ritmo: 8, mediana_kg_visita: 24.5, mediana_dinero_visita: 3500,
    al_corriente: 1, les_toca: 0, enfriandose: 1, perdidos: 0,
    tramos: { semana: 1, mes: 0, mas: 0, una: 0, frio: 1, perdido: 0 },
    clientes: [
      { cliente_id: 1, nombre: 'Boutique Lucy', num_compras: 9, dias_con_compra: 9, primera: '2026-07-01', ultima: '2026-09-01',
        dias_sin_venir: 31, ritmo: 7, veces: 4.4, estado: 'frio', compras_periodo: 3,
        kg_total: 180, dinero_total: 21000, kg_por_visita: 20, dinero_por_visita: 2333.33, kg_periodo: 60, dinero_periodo: 7000 },
      { cliente_id: 2, nombre: 'Taller Martínez', num_compras: 9, dias_con_compra: 9, primera: '2026-07-01', ultima: '2026-09-30',
        dias_sin_venir: 2, ritmo: 7, veces: 0.3, estado: 'bien', compras_periodo: 5,
        kg_total: 400, dinero_total: 50000, kg_por_visita: 44.444, dinero_por_visita: 5555.56, kg_periodo: 220, dinero_periodo: 27500 },
    ],
  };

  let pedidos: { vista: string; dias: number }[];
  const apiFalsa = {
    frecuencia: (dias: number) => { pedidos.push({ vista: 'frecuencia', dias }); return of(frecuencia); },
    deuda: (dias: number) => { pedidos.push({ vista: 'deuda', dias }); return of(deuda); },
    queCompra: (dias: number) => { pedidos.push({ vista: 'que-compra', dias }); return of(null); },
    cuando: (dias: number) => { pedidos.push({ vista: 'cuando', dias }); return of(null); },
    gasto: (dias: number) => { pedidos.push({ vista: 'gasto', dias }); return of(gasto); },
    dejaron: (sinVenir: number) => {
      pedidos.push({ vista: 'dejaron', dias: sinVenir });
      return of({ dias: sinVenir, min_compras: 2, num_clientes: 0, venta_en_riesgo: 0, clientes: [] });
    },
  };

  async function montar(vista: VistaClientes, dias: string | null = null) {
    await TestBed.configureTestingModule({
      imports: [ClientesPantalla],
      providers: [
        provideRouter([]),
        { provide: RedisenoService, useValue: apiFalsa },
        { provide: AuthService, useValue: { puede: () => true } },
        {
          provide: ClientesService,
          useValue: { buscar: () => of([]), listar: () => of({ items: [], total: 0, page: 1, limit: 100, pages: 0 }) },
        },
        { provide: VentasService, useValue: { metodosPago: () => of([]), cajas: () => of([]) } },
        { provide: CatalogoService, useValue: { tiposCliente: () => of([]) } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: { vista } },
            queryParamMap: of(convertToParamMap(dias ? { dias } : {})),
          },
        },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(ClientesPantalla);
    f.detectChanges();
    return f;
  }

  const textoDe = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

  beforeEach(() => (pedidos = []));
  afterEach(() => TestBed.resetTestingModule());

  it('pide la pestaña de su ruta con el periodo de la dirección, y la cabecera', async () => {
    const f = await montar('frecuencia', '30');
    // La pestaña, más lo de la cabecera (gasto y deuda).
    expect(pedidos.map((p) => p.vista).sort()).toEqual(['deuda', 'frecuencia', 'gasto']);
    expect(pedidos.every((p) => p.dias === 30)).toBe(true);
    const t = textoDe(f.nativeElement);
    expect(t).toContain('2 clientes · 1 compraron en los últimos 30 días · 1 te debe');
  });

  it('sin ?dias usa 90 y no pide dos veces la misma vista', async () => {
    await montar('gasto');
    expect(pedidos.filter((p) => p.vista === 'gasto').length).toBe(1);
    expect(pedidos[0].dias).toBe(90);
  });

  it('Cuánto debe no ofrece periodo y deja abonar desde el renglón', async () => {
    const f = await montar('deuda');
    expect(f.nativeElement.querySelector('.periodo')).toBeNull();
    const boton = [...f.nativeElement.querySelectorAll('button')].find((b) => (b as HTMLElement).textContent?.trim() === 'Abonar') as HTMLButtonElement;
    expect(boton).toBeTruthy();
    boton.click();
    f.detectChanges();
    expect(f.componentInstance.abonando()?.cliente_id).toBe(2);
    expect(f.nativeElement.querySelector('app-abono-modal')).not.toBeNull();
  });

  it('la frecuencia dice también cuánto se llevan, en kilos y en dinero', async () => {
    const f = await montar('frecuencia');
    const el = f.nativeElement as HTMLElement;
    // La visita típica, arriba.
    expect(el.textContent).toContain('cada vez se llevan unos 24.5 kg ($3,500)');
    // Por cliente: lo del periodo y lo de cada visita.
    const fila = textoDe(el.querySelector('table.grid tbody tr') as HTMLElement);
    expect(fila).toContain('60 kg');
    expect(fila).toContain('20 kg por visita');
    expect(fila).toContain('$7,000');
    expect(fila).toContain('$2,333 por visita');
    // Y se puede ordenar por dinero: con "Todos", primero el que más deja.
    const c = f.debugElement.query((d) => d.name === 'app-vista-frecuencia').componentInstance;
    c.mostrar.set('todos');
    c.orden.set('dinero');
    f.detectChanges();
    expect(textoDe(el.querySelector('table.grid tbody tr') as HTMLElement)).toContain('Taller Martínez');
  });

  it('Dejaron de venir pide el corte de la campana si no se dice otro', async () => {
    await montar('dejaron');
    expect(pedidos.find((p) => p.vista === 'dejaron')?.dias).toBe(60);
  });

  it('en Frecuencia, "a los que ya les toca" no enseña a los que van al corriente', async () => {
    const f = await montar('frecuencia');
    const filas = [...f.nativeElement.querySelectorAll('table.grid tbody tr')].map((tr) => textoDe(tr as HTMLElement));
    expect(filas.length).toBe(1);
    expect(filas[0]).toContain('Boutique Lucy');
    expect(filas[0]).toContain('Se está enfriando');
  });
});
