import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { TitleStrategy, provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { autorizacionInterceptor } from './core/interceptors/autorizacion.interceptor';
import { TituloPorPantalla } from './core/titulos';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // Cada pestaña dice qué pantalla es: "Inventario · Hitex".
    { provide: TitleStrategy, useClass: TituloPorPantalla },
    // Autorizaciones (2026-10-19): si una operación necesita autorización, pregunta y la vuelve a mandar.
    provideHttpClient(withInterceptors([authInterceptor, autorizacionInterceptor])),
  ],
};
