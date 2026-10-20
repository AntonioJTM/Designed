import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Nomina } from './nomina';
import { NominaService } from '../../../core/services/nomina.service';
import { AuthService } from '../../../core/services/auth.service';
import { AutorizacionesService } from '../../../core/services/autorizaciones.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { PeriodoNomina, ReciboNomina } from '../../../core/models/nomina.models';

/**
 * NÓMINA, autorizaciones fase 3 (2026-10-19): la prepara la gerente o
 * Contabilidad y PIDE que se pague; el administrador la paga (aceptando lo
 * pedido). Nadie toca su propio recibo.
 */
describe('Nomina (fase 3)', () => {
  const recibo = (id: number, usuario_id: number) => ({ id, periodo_id: 7, usuario_id, usuario: `P${usuario_id}`, total_pagar: '2000.00' }) as unknown as ReciboNomina;
  const PERIODO = {
    id: 7, fecha_inicio: '2026-10-18', fecha_fin: '2026-10-24', fecha_pago: '2026-10-24', estado: 'borrador',
    creado_en: '', actualizado_en: '', recibos: [recibo(1, 2), recibo(2, 3)], total_nomina: 4000, pago_pedido: null,
  } as PeriodoNomina;
  let pedidos: number[];
  let aprobados: number[];
  let pagados: number[];

  async function montar(permisos: string[], yo: number, admin = false, periodo: PeriodoNomina = PERIODO) {
    pedidos = []; aprobados = []; pagados = [];
    await TestBed.configureTestingModule({
      imports: [Nomina],
      providers: [
        provideRouter([]),
        {
          provide: NominaService,
          useValue: {
            semanaActual: () => of({ semana: { fecha_inicio: '2026-10-18', fecha_fin: '2026-10-24', fecha_pago: '2026-10-24' }, periodo }),
            listarPeriodos: () => of({ items: [], total: 0 }),
            pedirPago: (id: number) => { pedidos.push(id); return of(undefined); },
            cambiarEstado: (id: number) => { pagados.push(id); return of({ ...periodo, estado: 'pagado' }); },
          },
        },
        { provide: AuthService, useValue: { puede: (k: string) => admin || permisos.includes(k), esAdmin: () => admin, miId: () => yo } },
        { provide: AutorizacionesService, useValue: { aprobar: (id: number) => { aprobados.push(id); return of({}); } } },
        { provide: ConfirmacionService, useValue: { pedir: () => Promise.resolve(true) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(Nomina);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return f;
  }
  const botones = (el: HTMLElement) => [...el.querySelectorAll('button')].map((b) => b.textContent?.trim());

  it('quien la prepara ve "Pedir que se pague" y la pide (no la paga)', async () => {
    const f = await montar(['ver:nomina', 'pedir:pagar_nomina'], 2);
    expect(botones(f.nativeElement)).toContain('Pedir que se pague');
    expect(botones(f.nativeElement)).not.toContain('Marcar como pagada');
    await f.componentInstance.pedirPago();
    expect(pedidos).toEqual([7]);
    expect(pagados).toEqual([]);
  });

  it('ya pedida: el botón lo dice y no se vuelve a pedir', async () => {
    const f = await montar(['ver:nomina', 'pedir:pagar_nomina'], 2, false,
      { ...PERIODO, pago_pedido: { id: 40, solicitante: 'Yessica', solicitado_en: '2026-10-19 10:00:00' } });
    const b = [...(f.nativeElement as HTMLElement).querySelectorAll('button')].find((x) => x.textContent?.includes('Ya se pidió'));
    expect(b?.disabled).toBeTrue();
  });

  it('el administrador, con una pedida, la paga ACEPTANDO lo que se pidió', async () => {
    const f = await montar([], 1, true, { ...PERIODO, pago_pedido: { id: 40, solicitante: 'Yessica', solicitado_en: '2026-10-19 10:00:00' } });
    await f.componentInstance.marcarPagada();
    expect(aprobados).toEqual([40]);
    expect(pagados).toEqual([]);
  });

  it('nadie toca su propio recibo; el administrador sí', async () => {
    const f = await montar(['ver:nomina', 'pedir:pagar_nomina'], 2);
    expect(f.componentInstance.puedeTocar(recibo(1, 2))).toBeFalse();
    expect(f.componentInstance.puedeTocar(recibo(2, 3))).toBeTrue();
    TestBed.resetTestingModule();
    const g = await montar([], 1, true);
    expect(g.componentInstance.puedeTocar(recibo(3, 1))).toBeTrue();
  });
});
