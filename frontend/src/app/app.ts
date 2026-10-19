import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmacionComponent } from './shared/confirmacion/confirmacion';
import { WhatsappTicket } from './shared/ticket/whatsapp-ticket';
import { FocoVentanas } from './core/services/foco-ventanas.service';
import { TablasDesplazables } from './core/services/tablas-desplazables.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConfirmacionComponent, WhatsappTicket],
  // La ventana de confirmación y la de mandar un ticket por WhatsApp viven aquí,
  // una sola vez, para todo el sistema.
  template: '<router-outlet /><app-whatsapp-ticket /><app-confirmacion />',
})
export class App {
  constructor() {
    // El foco del teclado entra a cada ventana al abrirse, da la vuelta dentro de
    // ella y regresa al cerrarla (todas las ventanas del sistema, de una vez).
    inject(FocoVentanas).iniciar();
    // La tabla que no cabe y se mueve de lado: se llega con Tab, tiene nombre y
    // la orilla con más columnas se desvanece.
    inject(TablasDesplazables).iniciar();
  }
}
