import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AbonoModal } from './abono-modal';
import { ClientesService } from '../../../core/services/clientes.service';
import { VentasService } from '../../../core/services/ventas.service';

/**
 * El abono:
 *   · en EFECTIVO sin turno abierto no se manda (el corte no cuadraría);
 *   · no se abona más de lo que debe (se leería como saldo a favor);
 *   · con turno, el efectivo entra a ESE turno.
 */
describe('AbonoModal', () => {
  let enviados: { monto: number; metodo_pago_id?: number; sesion_caja_id?: number }[];
  let turnoAbierto: boolean;

  const ventasFalso = {
    metodosPago: () => of([{ id: 1, nombre: 'Efectivo' }, { id: 3, nombre: 'Transferencia' }]),
    cajas: () => of([{ id: 4, almacen_id: 1, nombre: 'Caja 1', activo: 1 }]),
    sesionAbierta: () => of(turnoAbierto ? { id: 88, caja_id: 4, caja: 'Caja 1', estado: 'abierta' } : null),
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
  });
  afterEach(() => TestBed.resetTestingModule());

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
