import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AbonoModal } from './abono-modal';
import { ClientesService } from '../../../core/services/clientes.service';
import { VentasService } from '../../../core/services/ventas.service';

/**
 * El abono:
 *   · en EFECTIVO sin turno abierto no se manda (el corte no cuadraría);
 *   · no se abona más de lo que debe (se leería como saldo a favor);
 *   · con turno, el efectivo entra a ESE turno;
 *   · con dos tiendas abiertas, entra al de la caja con que se trabaja, y si no
 *     hay una elegida, hay que escoger (antes caía en la primera de la lista).
 */
describe('AbonoModal', () => {
  let enviados: { monto: number; metodo_pago_id?: number; sesion_caja_id?: number }[];
  let turnoAbierto: boolean;
  let dosTiendas: boolean;

  const ventasFalso = {
    metodosPago: () => of([{ id: 1, nombre: 'Efectivo' }, { id: 3, nombre: 'Transferencia' }]),
    cajas: () =>
      of(
        dosTiendas
          ? [{ id: 4, almacen_id: 1, nombre: 'Caja 1', activo: 1 }, { id: 5, almacen_id: 2, nombre: 'Caja Moroleón', activo: 1 }]
          : [{ id: 4, almacen_id: 1, nombre: 'Caja 1', activo: 1 }]
      ),
    sesionAbierta: (cajaId: number) =>
      of(
        !turnoAbierto ? null
          : cajaId === 5 ? { id: 99, caja_id: 5, caja: 'Caja Moroleón', estado: 'abierta' }
          : { id: 88, caja_id: 4, caja: 'Caja 1', estado: 'abierta' }
      ),
  };
  const clientesFalso = {
    abonar: (_id: number, b: { monto: number }) => {
      enviados.push(b);
      return of({ movimiento_id: 1, saldo_nuevo: 1000 - b.monto });
    },
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [AbonoModal],
      providers: [
        { provide: ClientesService, useValue: clientesFalso },
        { provide: VentasService, useValue: ventasFalso },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(AbonoModal);
    f.componentRef.setInput('clienteId', 7);
    f.componentRef.setInput('nombre', 'Doña Chela');
    f.componentRef.setInput('saldo', 1000);
    f.detectChanges();
    // Los turnos se buscan con una promesa: se deja que termine.
    await new Promise((r) => setTimeout(r));
    await f.whenStable();
    return f;
  }

  beforeEach(() => {
    enviados = [];
    turnoAbierto = false;
    dosTiendas = false;
    try { localStorage.removeItem('caja_sel'); } catch { /* sin almacenamiento */ }
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    try { localStorage.removeItem('caja_sel'); } catch { /* sin almacenamiento */ }
  });

  it('con dos tiendas abiertas, el efectivo entra a la caja con que se trabaja', async () => {
    turnoAbierto = true;
    dosTiendas = true;
    localStorage.setItem('caja_sel', '5');
    const c = (await montar()).componentInstance;
    expect(c.turnoId).toBe(99);
    c.metodoId = 1;
    c.monto = 100;
    c.registrar();
    expect(enviados[0].sesion_caja_id).toBe(99);
  });

  it('con dos tiendas abiertas y ninguna elegida, hay que escoger la caja', async () => {
    turnoAbierto = true;
    dosTiendas = true;
    const c = (await montar()).componentInstance;
    expect(c.turnoId).toBeNull();
    c.metodoId = 1;
    c.monto = 100;
    c.registrar();
    expect(enviados).toEqual([]);
    expect(c.error()).toContain('Elige a qué caja');
  });

  it('propone abonar todo lo que debe', async () => {
    const f = await montar();
    expect(f.componentInstance.monto).toBe(1000);
  });

  it('en efectivo sin turno abierto no registra nada', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.metodoId = 1;
    c.registrar();
    expect(enviados.length).toBe(0);
    expect(c.error()).toContain('turno');
  });

  it('no deja abonar más de lo que debe', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.metodoId = 3;
    c.monto = 1500;
    c.registrar();
    expect(enviados.length).toBe(0);
  });

  it('con turno abierto, el efectivo entra a ese turno', async () => {
    turnoAbierto = true;
    const f = await montar();
    const c = f.componentInstance;
    const registrados: number[] = [];
    c.registrado.subscribe((r) => registrados.push(r.saldo_nuevo));
    c.metodoId = 1;
    c.monto = 400;
    c.registrar();
    expect(enviados).toEqual([{ monto: 400, metodo_pago_id: 1, sesion_caja_id: 88, referencia: undefined } as never]);
    expect(registrados).toEqual([600]);
  });

  it('por transferencia no manda turno', async () => {
    turnoAbierto = true;
    const f = await montar();
    const c = f.componentInstance;
    c.metodoId = 3;
    c.monto = 200;
    c.registrar();
    expect(enviados[0].sesion_caja_id).toBeUndefined();
  });
});
