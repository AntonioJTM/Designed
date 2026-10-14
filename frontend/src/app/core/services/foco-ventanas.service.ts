import { DestroyRef, Injectable, inject } from '@angular/core';

/** Lo que se puede enfocar con Tab dentro de una ventana. */
const ENFOCABLES = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

interface Abierta {
  ventana: HTMLElement;
  /** Lo que tenía el foco antes de abrirla: ahí regresa al cerrarla. */
  antes: HTMLElement | null;
}

/**
 * EL FOCO DEL TECLADO EN LAS VENTANAS (2026-10-13, auditoría): las 30 ventanas
 * del sistema (`role="dialog"` o `"alertdialog"` + `aria-modal="true"`) estaban marcadas como
 * ventana pero el foco se quedaba DETRÁS: con Tab se recorría el menú lateral y
 * quien usa lector de pantalla no se enteraba de que se había abierto algo.
 *
 * Se resuelve una sola vez, para todas, sin tocar cada ventana:
 *   · al ABRIRSE, el foco entra: al primer campo de su cuerpo (o al primer botón,
 *     o a la ventana misma). Si la ventana ya puso el foco por su cuenta —el
 *     lector de Surtir sucursal, el botón de la confirmación—, no se toca;
 *   · mientras está abierta, Tab y Mayús+Tab dan la vuelta DENTRO de ella (la de
 *     más arriba, si hay una confirmación sobre otra ventana);
 *   · al CERRARSE, el foco regresa a lo que lo tenía antes (el botón que la abrió).
 * Escape y "no se cierra al tocar el fondo" siguen siendo de cada ventana.
 */
@Injectable({ providedIn: 'root' })
export class FocoVentanas {
  private readonly destroyRef = inject(DestroyRef);
  private abiertas: Abierta[] = [];
  private pendiente = false;

  /** Se llama una vez, desde la raíz de la aplicación. */
  iniciar(raiz: HTMLElement = document.body): void {
    const observador = new MutationObserver(() => this.programarRevision());
    observador.observe(raiz, { childList: true, subtree: true });
    const alTeclear = (e: KeyboardEvent) => this.alTeclear(e);
    document.addEventListener('keydown', alTeclear, true);
    this.destroyRef.onDestroy(() => {
      observador.disconnect();
      document.removeEventListener('keydown', alTeclear, true);
    });
    this.revisar();
  }

  /** Las ventanas abiertas, la de más arriba al final (para las pruebas). */
  get cuantas(): number {
    return this.abiertas.length;
  }

  private programarRevision(): void {
    if (this.pendiente) return;
    this.pendiente = true;
    queueMicrotask(() => {
      this.pendiente = false;
      this.revisar();
    });
  }

  /** Quién se cerró (regresa el foco) y quién se abrió (lo mete). */
  revisar(): void {
    const cerradas = this.abiertas.filter((a) => !a.ventana.isConnected);
    this.abiertas = this.abiertas.filter((a) => a.ventana.isConnected);
    for (const c of cerradas.reverse()) {
      const enfocado = document.activeElement;
      const perdido = !enfocado || enfocado === document.body || !enfocado.isConnected;
      if (perdido && c.antes?.isConnected) c.antes.focus();
    }
    const visibles = Array.from(document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'
    ));
    for (const ventana of visibles) {
      if (this.abiertas.some((a) => a.ventana === ventana)) continue;
      const activo = document.activeElement;
      const antes = activo instanceof HTMLElement && activo !== document.body && !ventana.contains(activo) ? activo : null;
      this.abiertas.push({ ventana, antes });
      // Después de que la ventana termine de dibujarse y de poner su propio foco.
      setTimeout(() => this.entrar(ventana), 60);
    }
  }

  private entrar(ventana: HTMLElement): void {
    if (!ventana.isConnected || ventana.contains(document.activeElement)) return;
    // En pantalla táctil (el celular) NO se enfoca un campo: abriría el teclado de
    // la pantalla encima de la ventana recién abierta. Va a la ventana misma, que
    // el lector de pantalla anuncia igual.
    const tactil = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const cuerpo = ventana.querySelector<HTMLElement>('.modal-body') ?? ventana;
    const destino = tactil ? null :
      ventana.querySelector<HTMLElement>('[autofocus]') ??
      this.primero(cuerpo, 'input:not([disabled]):not([type="hidden"]):not([type="file"]), select:not([disabled]), textarea:not([disabled])') ??
      this.primero(cuerpo, ENFOCABLES) ??
      this.primero(ventana, ENFOCABLES);
    if (destino) {
      destino.focus();
    } else {
      if (!ventana.hasAttribute('tabindex')) ventana.setAttribute('tabindex', '-1');
      ventana.focus();
    }
  }

  private alTeclear(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const arriba = [...this.abiertas].reverse().find((a) => a.ventana.isConnected)?.ventana;
    if (!arriba) return;
    const lista = this.enfocables(arriba);
    if (!lista.length) {
      e.preventDefault();
      arriba.focus();
      return;
    }
    const primero = lista[0];
    const ultimo = lista[lista.length - 1];
    const activo = document.activeElement as HTMLElement | null;
    const adentro = !!activo && arriba.contains(activo);
    if (e.shiftKey && (!adentro || activo === primero)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && (!adentro || activo === ultimo)) {
      e.preventDefault();
      primero.focus();
    }
  }

  private enfocables(raiz: HTMLElement): HTMLElement[] {
    return Array.from(raiz.querySelectorAll<HTMLElement>(ENFOCABLES)).filter((e) => this.visible(e));
  }

  private primero(raiz: HTMLElement, selector: string): HTMLElement | null {
    return Array.from(raiz.querySelectorAll<HTMLElement>(selector)).find((e) => this.visible(e)) ?? null;
  }

  /** Visible para el teclado: con caja, o el campo de archivo escondido de una etiqueta. */
  private visible(e: HTMLElement): boolean {
    if (e.closest('[hidden], [aria-hidden="true"]')) return false;
    return e.getClientRects().length > 0;
  }
}
