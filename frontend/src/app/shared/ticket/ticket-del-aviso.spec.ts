import { signal } from '@angular/core';
import { TicketDelAviso } from './ticket-del-aviso';

/** 2026-10-15: el botón de ticket va con SU aviso, y se va en cuanto el aviso cambia. */
describe('TicketDelAviso', () => {
  it('ofrece el botón mientras el aviso sea el mismo', () => {
    const mensaje = signal<string | null>(null);
    const aviso = new TicketDelAviso(mensaje);
    let impresos = 0;
    expect(aviso.actual()).toBeNull();

    mensaje.set('Abono registrado.');
    aviso.poner('Abono registrado.', 'Imprimir ticket del abono', () => impresos++);
    expect(aviso.actual()?.etiqueta).toBe('Imprimir ticket del abono');
    aviso.actual()!.imprimir();
    expect(impresos).toBe(1);

    mensaje.set('Se guardaron sus datos.');
    expect(aviso.actual()).toBeNull();
    mensaje.set(null);
    expect(aviso.actual()).toBeNull();
  });
});
