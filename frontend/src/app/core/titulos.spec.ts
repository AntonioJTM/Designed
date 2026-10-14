import { Route } from '@angular/router';
import { tituloCompleto } from './titulos';
import { MENU, nombreDe } from './navegacion';
import { ADMIN_ROUTES } from '../features/admin/admin.routes';

/**
 * El título de la pestaña dice qué pantalla es (auditoría 2026-10-13): antes
 * todas decían "Hitex" y con tres pestañas abiertas no se sabía cuál era cuál.
 */
describe('Títulos de las pantallas', () => {
  it('pega el nombre del sistema detrás de la pantalla', () => {
    expect(tituloCompleto('Inventario', 'Hitex')).toBe('Inventario · Hitex');
    expect(tituloCompleto('Cuánto debe · Clientes', 'Hitex')).toBe('Cuánto debe · Clientes · Hitex');
  });

  it('en el sistema de pruebas el aviso va primero', () => {
    expect(tituloCompleto('Inventario', 'PRUEBAS · Hitex')).toBe('PRUEBAS · Inventario · Hitex');
  });

  it('sin título de pantalla queda el del sistema', () => {
    expect(tituloCompleto(undefined, 'Hitex')).toBe('Hitex');
  });

  it('el nombre sale del menú, así la pestaña y el menú nunca se contradicen', () => {
    expect(nombreDe('remesa')).toBe('Surtir inventario');
    expect(() => nombreDe('no-existe')).toThrow();
  });

  it('toda pantalla del panel lleva título, y las del menú el mismo nombre que el menú', () => {
    const hijas = (ADMIN_ROUTES[0].children ?? []) as Route[];
    const pantallas = hijas.filter((r) => r.loadComponent);
    expect(pantallas.length).toBeGreaterThan(20);
    for (const r of pantallas) expect(r.title).withContext(r.path ?? '').toBeTruthy();
    for (const g of MENU) {
      for (const o of g.opciones) {
        const ruta = pantallas.find((r) => '/admin/' + r.path === o.ruta);
        if (ruta) expect(ruta.title).withContext(o.ruta).toBe(o.nombre);
      }
    }
  });
});
