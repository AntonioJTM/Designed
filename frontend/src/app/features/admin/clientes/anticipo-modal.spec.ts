import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AnticipoModal } from './anticipo-modal';
import { ClientesService } from '../../../core/services/clientes.service';
import { VentasService } from '../../../core/services/ventas.service';
import { AnticipoInput } from '../../../core/models/clientes.models';
import { TransferenciasService } from '../../../core/services/transferencias.service';
import { transferenciasFalso } from '../../../core/services/transferencias.falso';

/**
 * El ANTICIPO (2026-10-14): el cliente deja dinero a cuenta, sin nota, en
 * efectivo y/o por transferencia, y le queda a favor. El efectivo entra a un
 * turno de caja: desde el punto de venta, el de esa caja.
 */
describe('AnticipoModal', () => {
  let enviado: { id: number; body: AnticipoInput } | null;
  let turnos: { id: number; caja_id: number; caja: string }[];

  async function montar(sesionId: number | null) {
    await TestBed.configureTestingModule({
      imports: [AnticipoModal],
      providers: [{ provide: TransferenciasService, useValue: transferenciasFalso() }, 
        {
          provide: ClientesService,
          useValue: {
            recibirAnticipo: (id: number, body: AnticipoInput) => {
              enviado = { id, body };
              const total = (body.efectivo ?? 0) + (body.transferencia ?? 0);
              return of({ movimiento_id: 31, total, saldo_favor: 200 + total, efectivo: body.efectivo ?? 0, transferencia: body.transferencia ?? 0 });
            },
          },
        },
        {
          provide: VentasService,
          useValue: {
            cajas: () => of(turnos.map((t) => ({ id: t.caja_id, activo: 1 }))),
            sesionAbierta: (cajaId: number) => of(turnos.find((t) => t.caja_id === cajaId) ?? null),
          },
        },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(AnticipoModal);
    f.componentRef.setInput('clienteId', 20);
    f.componentRef.setInput('nombre', 'Doña Chela');
    f.componentRef.setInput('saldoFavor', 200);
    f.componentRef.setInput('sesionId', sesionId);
    f.detectChanges();
    await f.whenStable();
    return f.componentInstance;
  }

  beforeEach(() => {
    enviado = null;
    turnos = [];
  });
  afterEach(() => TestBed.resetTestingModule());

  it('desde la caja: $600 en efectivo y $400 por transferencia, el efectivo a ese turno', async () => {
    const c = await montar(9);
    let hecho: { total: number; saldo_favor: number; movimiento_id: number } | null = null;
    c.registrado.subscribe((r) => (hecho = r));
    c.efectivo = 600;
    c.transferencia = 400;
    c.referencia = 'folio 123';
    expect(c.total()).toBe(1000);
    c.registrar();
    expect(enviado).toEqual({ id: 20, body: { efectivo: 600, transferencia: 400, sesion_caja_id: 9, referencia: 'folio 123' } });
    // Con `movimiento_id` se imprime su ticket.
    expect(hecho!).toEqual({ total: 1000, saldo_favor: 1200, movimiento_id: 31 });
  });

  it('sin poner cuánto no registra nada', async () => {
    const c = await montar(9);
    c.registrar();
    expect(enviado).toBeNull();
    expect(c.error()).toContain('cuánto deja');
  });

  it('solo por transferencia no necesita caja', async () => {
    const c = await montar(null);
    c.transferencia = 500;
    c.registrar();
    expect(enviado!.body).toEqual({ efectivo: undefined, transferencia: 500, sesion_caja_id: undefined, referencia: undefined });
  });

  it('efectivo desde el expediente sin turno abierto: lo dice y no registra', async () => {
    const c = await montar(null);
    c.efectivo = 300;
    c.registrar();
    expect(enviado).toBeNull();
    expect(c.error()).toContain('turno de caja abierto');
  });

  it('con un solo turno abierto, el efectivo entra a ese', async () => {
    turnos = [{ id: 77, caja_id: 2, caja: 'Caja 2' }];
    const c = await montar(null);
    c.efectivo = 300;
    c.registrar();
    expect(enviado!.body.sesion_caja_id).toBe(77);
  });
});
