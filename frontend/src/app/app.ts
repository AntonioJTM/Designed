import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmacionComponent } from './shared/confirmacion/confirmacion';
import { FocoVentanas } from './core/services/foco-ventanas.service';
import { TablasDesplazables } from './core/services/tablas-desplazables.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConfirmacionComponent],
  // La ventana de confirmación vive aquí, una sola vez, para todo el sistema.
  template: '<router-outlet /><app-confirmacion />',
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
