import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AjusteFavorModal } from './ajuste-favor-modal';
import { ClientesService } from '../../../../core/services/clientes.service';
import { AjusteSaldoFavor } from '../../../../core/models/clientes.models';

/**
 * Ajustar su saldo a favor a mano (2026-10-16):
 *   · quitarle manda el monto en negativo, agregarle en positivo, con el motivo;
 *   · no se le puede quitar más de lo que tiene ni guardar sin motivo.
 */
describe('AjusteFavorModal', () => {
  let enviados: { id: number; monto: number; notas: string }[];

  async function montar() {
    enviados = [];
    await TestBed.configureTestingModule({
      imports: [AjusteFavorModal],
      providers: [{
        provide: ClientesService,
        useValue: {
          ajustarSaldoFavor: (id: number, monto: number, notas: string) => {
            enviados.push({ id, monto, notas });
            return of({ movimiento_id: 1, tenia: 500, saldo_favor: 500 + monto } as AjusteSaldoFavor);
          },
        },
      }],
    }).compileComponents();
    const f = TestBed.createComponent(AjusteFavorModal);
    f.componentRef.setInput('clienteId', 7);
    f.componentRef.setInput('nombre', 'Doña Mari');
    f.componentRef.setInput('saldo', 500);
    f.detectChanges();
    return f.componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('quitarle $200 manda -200 con su motivo y dice cuánto le queda', async () => {
    const c = await montar();
    let registrado: AjusteSaldoFavor | null = null;
    c.registrado.subscribe((r) => (registrado = r));
    c.sentido = 'quita';
    c.monto = 200;
    c.motivo = 'Se le regresó en efectivo';
    expect(c.saldoTras()).toBe(300);
    c.guardar();
    expect(enviados).toEqual([{ id: 7, monto: -200, notas: 'Se le regresó en efectivo' }]);
    expect(registrado!.saldo_favor).toBe(300);
  });

  it('agregarle manda el monto en positivo', async () => {
    const c = await montar();
    c.sentido = 'agrega';
    c.monto = 150;
    c.motivo = 'Le faltó una devolución';
    c.guardar();
    expect(enviados[0].monto).toBe(150);
  });

  it('no deja quitarle más de lo que tiene ni guardar sin motivo', async () => {
    const c = await montar();
    c.sentido = 'quita';
    c.monto = 600;
    c.motivo = 'De más';
    c.guardar();
    expect(enviados.length).toBe(0);
    expect(c.error()).toContain('No se le puede quitar más');

    c.monto = 100;
    c.motivo = '';
    c.guardar();
    expect(enviados.length).toBe(0);
    expect(c.error()).toContain('motivo');
  });
});
