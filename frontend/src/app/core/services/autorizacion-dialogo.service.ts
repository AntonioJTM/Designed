import { Injectable, signal } from '@angular/core';
import { NecesitaAutorizacion } from '../models/autorizaciones.models';

/** Lo que eligió quien pide: mandarla a autorizar, autorizarla aquí con una clave, o no hacerla. */
export type EleccionAutorizacion =
  | { tipo: 'pedir' }
  | { tipo: 'aqui'; usuario_id: number; clave: string }
  | { tipo: 'no' };

interface Estado {
  info: NecesitaAutorizacion;
  /** Lo que salió mal la vez anterior (clave equivocada…). */
  error: string | null;
  /** Ya se eligió y el servidor está contestando. */
  ocupado: boolean;
  /** Se pidió: la ventana dice "Listo" hasta que la persona lo lea. */
  pedida: boolean;
  responder: (e: EleccionAutorizacion) => void;
  enterado?: () => void;
}

/**
 * LA VENTANA "HACE FALTA AUTORIZACIÓN" (2026-10-19). La abre el interceptor
 * (`autorizacion.interceptor.ts`) cuando el servidor contesta 428
 * NECESITA_AUTORIZACION a cualquier operación: así ninguna pantalla tiene que
 * saber de autorizaciones. La dibuja `<app-autorizacion-dialogo>`, una vez en la
 * raíz (`app.ts`), encima de cualquier ventana.
 */
@Injectable({ providedIn: 'root' })
export class AutorizacionDialogoService {
  readonly actual = signal<Estado | null>(null);

  /** Pregunta qué hacer (con el error de la vez anterior, si lo hubo). */
  preguntar(info: NecesitaAutorizacion, error: string | null = null): Promise<EleccionAutorizacion> {
    return new Promise((resolve) => {
      this.actual.set({ info, error, ocupado: false, pedida: false, responder: resolve });
    });
  }

  elegir(e: EleccionAutorizacion): void {
    const a = this.actual();
    if (!a || a.ocupado) return;
    if (e.tipo === 'no') this.actual.set(null);
    else this.actual.set({ ...a, ocupado: true, error: null });
    a.responder(e);
  }

  /** Se mandó a autorizar: lo dice hasta que la persona dé "Entendido". */
  avisarPedida(): Promise<void> {
    const a = this.actual();
    if (!a) return Promise.resolve();
    return new Promise((resolve) => this.actual.set({ ...a, ocupado: false, pedida: true, enterado: resolve }));
  }

  enterado(): void {
    const a = this.actual();
    this.actual.set(null);
    a?.enterado?.();
  }

  cerrar(): void {
    this.actual.set(null);
  }
}
