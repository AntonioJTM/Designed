import { DestroyRef, Injectable, inject } from '@angular/core';

/** Lo que este servicio le puso a una tabla (para quitárselo si deja de hacer falta). */
const MARCA = 'data-desplazable';

/**
 * LAS TABLAS QUE SE MUEVEN DE LADO (2026-10-15, auditoría): una tabla ancha va
 * dentro de `.tabla-scroll` y se desplaza en su caja en vez de ensanchar la
 * página. Pero en el celular —o en la computadora con la página ampliada— quien
 * usa solo el teclado no tenía cómo moverla (WCAG 2.1.1), y nadie veía que había
 * más columnas: "Sus compras" se cortaba a media palabra.
 *
 * Se resuelve una sola vez, para las 62 tablas, sin tocar cada pantalla (como el
 * foco de las ventanas). Mientras una tabla NO cabe:
 *   · se llega a ella con Tab y se mueve con las flechas (`tabindex="0"`);
 *   · el lector de pantalla la anuncia con el título de su tarjeta
 *     (`role="region"`, "Tabla: Sus compras");
 *   · la orilla donde hay más columnas se desvanece (`hay-mas-der` / `hay-mas-izq`).
 * En cuanto cabe, se le quita todo: no agrega una parada de Tab que no sirve.
 * Lo que la pantalla le haya puesto por su cuenta (su propio `tabindex`) se respeta.
 */
@Injectable({ providedIn: 'root' })
export class TablasDesplazables {
  private readonly destroyRef = inject(DestroyRef);
  private readonly vistas = new WeakSet<HTMLElement>();
  private medidor: ResizeObserver | null = null;
  private pendiente = false;

  /** Se llama una vez, desde la raíz de la aplicación. */
  iniciar(raiz: HTMLElement = document.body): void {
    this.medidor = new ResizeObserver((cambios) => {
      for (const c of cambios) this.ajustar(c.target as HTMLElement);
    });
    // Las tablas aparecen y cambian de contenido con los datos: se revisa una vez
    // por cuadro, no en cada cambio.
    const observador = new MutationObserver(() => this.programar(raiz));
    observador.observe(raiz, { childList: true, subtree: true });
    this.destroyRef.onDestroy(() => {
      observador.disconnect();
      this.medidor?.disconnect();
    });
    this.revisar(raiz);
  }

  /** Revisa todas las tablas desplazables de `raiz`. */
  revisar(raiz: ParentNode = document.body): void {
    raiz.querySelectorAll<HTMLElement>('.tabla-scroll').forEach((caja) => {
      if (!this.vistas.has(caja)) {
        this.vistas.add(caja);
        this.medidor?.observe(caja);
        caja.addEventListener('scroll', () => this.orillas(caja), { passive: true });
      }
      this.ajustar(caja);
    });
  }

  private programar(raiz: HTMLElement): void {
    if (this.pendiente) return;
    this.pendiente = true;
    requestAnimationFrame(() => {
      this.pendiente = false;
      this.revisar(raiz);
    });
  }

  private ajustar(caja: HTMLElement): void {
    const desborda = caja.scrollWidth > caja.clientWidth + 1;
    const puestoAqui = caja.getAttribute(MARCA) === 'si';
    if (desborda) {
      if (!caja.hasAttribute('tabindex')) {
        caja.tabIndex = 0;
        caja.setAttribute(MARCA, 'si');
      }
      if (caja.getAttribute(MARCA) === 'si') {
        caja.setAttribute('role', 'region');
        caja.setAttribute('aria-label', this.nombreDe(caja));
      }
    } else if (puestoAqui) {
      caja.removeAttribute('tabindex');
      caja.removeAttribute('role');
      caja.removeAttribute('aria-label');
      caja.removeAttribute(MARCA);
    }
    this.orillas(caja);
  }

  /** Desvanece la orilla donde todavía hay columnas que no se ven. */
  private orillas(caja: HTMLElement): void {
    const resto = caja.scrollWidth - caja.clientWidth;
    caja.classList.toggle('hay-mas-izq', resto > 1 && caja.scrollLeft > 1);
    caja.classList.toggle('hay-mas-der', resto > 1 && resto - caja.scrollLeft > 1);
  }

  /** "Tabla: <título de su tarjeta>", o el título de la tabla si trae uno. */
  private nombreDe(caja: HTMLElement): string {
    const limpio = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();
    const propio = limpio(caja.querySelector('caption')?.textContent);
    if (propio) return `Tabla: ${propio}`;
    const contenedor = caja.closest('.card, .modal, section');
    const titulo = limpio(
      contenedor?.querySelector('.card-head h2, .card-head h3, .modal-head h2, h2, h3')?.textContent
    );
    return titulo ? `Tabla: ${titulo}` : 'Tabla';
  }
}
