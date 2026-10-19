import { Signal, computed, signal } from '@angular/core';

/**
 * El botón de TICKET que acompaña al aviso verde de "listo" (2026-10-15): al
 * registrar un abono, un anticipo o el pago de una nota, el aviso trae
 * "Imprimir ticket de…". Se va en cuanto el aviso cambia por otro, así nunca
 * imprime algo distinto de lo que dice la pantalla.
 *
 * Uso: `readonly ticketAviso = new TicketDelAviso(this.mensaje);` (después de
 * declarar `mensaje`), `this.ticketAviso.poner(texto, 'Imprimir ticket de abono',
 * () => …)` junto con `this.mensaje.set(texto)`, y en la plantilla el botón con
 * `ticketAviso.actual()` dentro de `.ok-msg.con-accion`.
 *
 * Desde el 2026-10-16 también lo MANDA POR WHATSAPP: el cuarto argumento de
 * `poner` y, en la plantilla, `<app-boton-whatsapp>` junto al de imprimir.
 */
export class TicketDelAviso {
  private readonly ultimo = signal<{ texto: string; etiqueta: string; imprimir: () => void; whatsapp?: () => void } | null>(null);

  constructor(private readonly mensaje: Signal<string | null>) {}

  /** El botón, mientras el aviso siga siendo el mismo; si no, null. */
  readonly actual = computed(() => {
    const u = this.ultimo();
    return u && this.mensaje() === u.texto ? u : null;
  });

  poner(texto: string, etiqueta: string, imprimir: () => void, whatsapp?: () => void): void {
    this.ultimo.set({ texto, etiqueta, imprimir, whatsapp });
  }
}
