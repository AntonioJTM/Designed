import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmacionComponent } from './shared/confirmacion/confirmacion';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConfirmacionComponent],
  // La ventana de confirmación vive aquí, una sola vez, para todo el sistema.
  template: '<router-outlet /><app-confirmacion />',
})
export class App {}
