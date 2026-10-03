import { Injectable, signal } from '@angular/core';

/** Lo que se le pregunta a la persona antes de hacer algo que no tiene vuelta. */
export interface Confirmacion {
  /** La pregunta, corta: "¿Eliminar la presentación ROJO-2?". */
  titulo: string;
  /** Qué pasa si acepta, en una o dos frases. */
  mensaje?: string;
  /** Texto del botón que acepta (por omisión "Aceptar"). Mejor el verbo: "Eliminar", "Cerrar turno". */
  aceptar?: string;
  /** Texto del botón que se arrepiente (por omisión "Cancelar"). */
  cancelar?: string;
  /** Borra o pierde algo: el botón va en rojo y el icono avisa. */
  peligro?: boolean;
}

interface Pendiente extends Confirmacion {
  responder: (si: boolean) => void;
}

/**
 * Reemplaza al `confirm()` del navegador, que no se puede diseñar: un cuadro
 * gris con "localhost:4200 dice" en medio de un panel cuidado. La pantalla
 * pregunta así:
 *
 *   if (!(await this.confirmacion.pedir({ titulo: '¿Eliminar…?', peligro: true }))) return;
 *
 * La ventana la dibuja `<app-confirmacion>`, puesta UNA vez en la raíz de la
 * aplicación (`app.ts`), así sirve igual desde una pantalla que desde un modal.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmacionService {
  readonly actual = signal<Pendiente | null>(null);

  pedir(c: Confirmacion): Promise<boolean> {
    // Si quedaba otra abierta (no debería), se toma como "no".
    this.actual()?.responder(false);
    return new Promise<boolean>((resolve) => this.actual.set({ ...c, responder: resolve }));
  }

  responder(si: boolean): void {
    const a = this.actual();
    if (!a) return;
    this.actual.set(null);
    a.responder(si);
  }
}
