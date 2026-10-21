import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AbonoModal } from './abono-modal';
import { ClientesService } from '../../../core/services/clientes.service';
import { VentasService } from '../../../core/services/ventas.service';
import { TransferenciasService } from '../../../core/services/transferencias.service';
import { transferenciasFalso } from '../../../core/services/transferencias.falso';

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
  const NOTAS = [
    { pedido_id: 1, numero_pedido: 'POS-1-AAAA', creado_en: '2026-10-01 10:00:00', almacen_id: 1, almacen: 'Tienda principal',
      otra_tienda: false, fiado: 500, pagado: 0, por_pagar: 500 },
    { pedido_id: 10, numero_pedido: 'POS-10-BBBB', creado_en: '2026-10-10 10:00:00', almacen_id: 2, almacen: 'Moroleón',
      otra_tienda: true, fiado: 500, pagado: 0, por_pagar: 500 },
  ];
  const clientesFalso = {
    notasCredito: () => of({ saldo: 1000, notas: NOTAS, ocultas: 0 }),
    abonar: (_id: number, b: { monto?: number; a_notas?: { monto: number }[] }) => {
      enviados.push(b as never);
      const m = b.monto ?? (b.a_notas ?? []).reduce((s, x) => s + x.monto, 0);
      return of({ movimiento_id: 1, saldo_nuevo: 1000 - m });
    },
  };

  async function montar(nota: number | null = null) {
    await TestBed.configureTestingModule({
      imports: [AbonoModal],
      providers: [{ provide: TransferenciasService, useValue: transferenciasFalso() }, 
        { provide: ClientesService, useValue: clientesFalso },
        { provide: VentasService, useValue: ventasFalso },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(AbonoModal);
    f.componentRef.setInput('clienteId', 7);
    f.componentRef.setInput('nombre', 'Doña Chela');
    f.componentRef.setInput('saldo', 1000);
    if (nota != null) f.componentRef.setInput('nota', nota);
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

  it('dice cómo queda su cuenta con el abono: antes → después (2026-10-19)', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.monto = 400;
    expect(c.quedaDebiendo()).toEqual({ queda: 600 });
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('quedará debiendo $600.00');
    c.monto = 1000;
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('queda al corriente');
    c.monto = 1500;
    expect(c.quedaDebiendo()).toBeNull();
  });

  it('el botón dice cuánto se abona también "A su cuenta" (2026-10-20, ronda 4)', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.monto = 400;
    f.detectChanges();
    const boton = (f.nativeElement as HTMLElement).querySelector('button[type=submit]')!;
    expect(boton.textContent).toContain('Abonar $400.00');
    c.monto = null;
    f.detectChanges();
    expect(boton.textContent).toContain('Registrar el abono');
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

  it('A NOTAS (2026-10-19): manda lo de cada nota marcada, y no más de lo que debe cada una', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.modo = 'notas';
    c.marcar(c.filas[1], true);
    expect(c.filas[1].monto).toBe(500); // de entrada, lo que debe
    c.filas[1].monto = 600;
    c.metodoId = 3;
    c.registrar();
    expect(enviados).toEqual([]);
    expect(c.error()).toContain('POS-10-BBBB');
    c.filas[1].monto = 300;
    expect(c.quedaDebiendo()).toEqual({ queda: 700 });
    c.registrar();
    expect(enviados[0]).toEqual({ a_notas: [{ pedido_id: 10, monto: 300 }], metodo_pago_id: 3, sesion_caja_id: undefined,
      referencia: undefined } as never);
  });

  it('A NOTAS sin marcar ninguna no manda nada', async () => {
    const c = (await montar()).componentInstance;
    c.modo = 'notas';
    c.metodoId = 3;
    c.registrar();
    expect(enviados).toEqual([]);
    expect(c.error()).toContain('Marca las notas');
  });

  it('desde el detalle de una venta abre en A notas con esa nota marcada', async () => {
    const f = await montar(10);
    const c = f.componentInstance;
    expect(c.modo).toBe('notas');
    expect(c.filas.find((x) => x.elegida)?.nota.pedido_id).toBe(10);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('Moroleón'); // la de otra tienda dice cuál
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

  it('a una nota no se le abona más de lo que debe: el renglón sale en rojo y no "queda bien" (2026-10-20)', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.modo = 'notas';
    const fila = c.filas[0];
    c.marcar(fila, true);
    fila.monto = 300;
    expect(c.pasaDeNota(fila)).toBeFalse();
    expect(c.quedaNota(fila)).toBe(200);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('le faltarán $200.00');
    fila.monto = 700;
    expect(c.pasaDeNota(fila)).toBeTrue();
    expect(c.quedaDebiendo()).toBeNull();
    f.detectChanges();
    const campo = (f.nativeElement as HTMLElement).querySelector('input[aria-invalid="true"]');
    expect(campo).not.toBeNull();
    expect((f.nativeElement as HTMLElement).textContent).toContain('no se le puede abonar más');
  });
});
