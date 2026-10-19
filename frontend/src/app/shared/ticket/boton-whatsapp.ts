import { Component, input, output } from '@angular/core';

/**
 * El botón "WhatsApp" que va junto a cada botón de ticket (2026-10-16): manda
 * ESE ticket al cliente en PDF. Lleva la palabra además del ícono: un ícono solo
 * no se lee con el lector de pantalla ni lo reconoce todo el mundo.
 */
@Component({
  selector: 'app-boton-whatsapp',
  host: { class: 'boton-whatsapp' },
  template: `
    <button type="button" class="btn btn-ghost" [class.btn-sm]="chico()" [attr.aria-label]="etiqueta()"
            [title]="etiqueta()" (click)="mandar.emit()">
      <!-- El ícono va dentro de un span: así el botón se alinea por la línea de la letra,
           como el de "Ticket" a su lado (con el ícono suelto se alineaba por su orilla de abajo). -->
      <span class="icono" aria-hidden="true"><svg class="icono-whatsapp" width="16" height="16" viewBox="0 0 24 24" focusable="false">
        <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.06 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.42.25-.69.25-1.29.18-1.41-.08-.13-.27-.2-.57-.35zM12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88zm8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89a11.82 11.82 0 0 0-3.48-8.41z"></path>
      </svg></span>
      WhatsApp
    </button>
  `,
  styles: `
    :host { display: inline-flex; }
    .btn { gap: 6px; }
    .icono { display: block; }
    .icono-whatsapp { display: inline-block; vertical-align: middle; margin-top: -2px; fill: var(--whatsapp); }
  `,
})
export class BotonWhatsapp {
  /** Lo que dice al lector de pantalla y al pasar el puntero: "Mandar por WhatsApp el ticket de venta". */
  readonly etiqueta = input('Mandar el ticket por WhatsApp');
  /** El tamaño chico, para renglones de tabla y avisos. */
  readonly chico = input(false);
  readonly mandar = output<void>();
}
