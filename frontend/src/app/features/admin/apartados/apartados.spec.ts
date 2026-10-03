import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApartadosPantalla } from './apartados';
import { VentasService } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { Apartado } from '../../../core/models/ventas.models';

/**
 * Lo que importa de Apartados:
 *   · los LIQUIDADOS van aparte: a ellos no se les cobra, se les entrega;
 *   · un abono en efectivo entra al turno de la caja con que se está trabajando;
 *   · lo que se apartó se dice con el calibre.
 */
describe('ApartadosPantalla', () => {
  const ap = (o: Partial<Apartado>): Apartado => ({
    pedido_id: 1, numero_pedido: 'POS-1', cliente_id: 3, cliente: 'Lucy', total: '1000',
    abonado: '400', pendiente: '600', pct_pagado: '40', creado_en: '2026-10-01 10:00:00',
    dias_apartado: 1, ...o,
  });

  let abonoEnviado: { sesion_caja_id?: number } | null = null;

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [ApartadosPantalla],
      providers: [
        provideRouter([]),
        {
          provide: VentasService,
          useValue: {
            apartados: () =>
              of({
                items: [
                  ap({ pedido_id: 1 }),
                  ap({ pedido_id: 2, numero_pedido: 'POS-2', abonado: '1000', pendiente: '0', pct_pagado: '100',
                       hilos: [{ hilo: 'NEGRO 2/30', tipo_presentacion: 'paquete', kg: 57.1, paquetes: 3 }] }),
                ],
                num_apartados: 2, total_apartado: 2000, total_abonado: 1400, kg_apartado: 80,
              }),
            metodosPago: () => of([{ id: 1, nombre: 'Efectivo' }, { id: 2, nombre: 'Transferencia' }]),
            cajas: () =>
              of([
                { id: 1, almacen_id: 1, nombre: 'Caja 1', activo: 1, turno_id: 30 },
                { id: 2, almacen_id: 2, nombre: 'Caja 2', activo: 1, turno_id: 40 },
              ]),
            abonarApartado: (_id: number, body: { sesion_caja_id?: number }) => {
              abonoEnviado = body;
              return of({ pedido_id: 1, numero_pedido: 'POS-1', total: 1000, abonado: 600, pendiente: 400, liquidado: false });
            },
          },
        },
        { provide: AuthService, useValue: { puede: () => true } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ApartadosPantalla);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    abonoEnviado = null;
    try { localStorage.removeItem('caja_sel'); } catch { /* sin almacenamiento */ }
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    try { localStorage.removeItem('caja_sel'); } catch { /* sin almacenamiento */ }
  });

  it('separa los liquidados de los que todavía deben', async () => {
    const c = await montar();
    expect(c.listosParaEntregar().map((a) => a.pedido_id)).toEqual([2]);
    expect(c.pendientes().map((a) => a.pedido_id)).toEqual([1]);
    expect(c.porCobrar()).toBe(600);
  });

  it('dice qué se apartó con su calibre', async () => {
    const c = await montar();
    expect(c.queSeAparto(c.listosParaEntregar()[0])).toBe('NEGRO 2/30 · 3 paquetes');
  });

  it('el abono en efectivo entra al turno de la caja con que se trabaja', async () => {
    localStorage.setItem('caja_sel', '2');
    const c = await montar();
    expect(c.sesion()).toEqual({ id: 40, caja: 'Caja 2' });

    c.abrirAbono(c.pendientes()[0]);
    c.montoAbono = 200;
    c.metodoAbono = 1;
    c.registrarAbono();
    expect(abonoEnviado!.sesion_caja_id).toBe(40);
  });
});
