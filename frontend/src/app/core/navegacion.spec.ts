import { MENU, rutaDeInicio } from './navegacion';

/** A dónde entra cada quien (sin "Pregúntame" desde el 2026-10-13). */
describe('rutaDeInicio', () => {
  it('con Hoy, entra a Hoy; si no, el cajero al punto de venta', () => {
    expect(rutaDeInicio((p) => p === 'ver:hoy' || p === 'ver:pos')).toBe('/admin/hoy');
    expect(rutaDeInicio((p) => p === 'ver:pos')).toBe('/admin/pos');
  });

  it('si no, la primera pantalla que sí puede abrir', () => {
    expect(rutaDeInicio((p) => p === 'ver:nomina')).toBe('/admin/nomina');
  });

  it('un puesto sin ninguna pantalla va a "Sin acceso", no a una que se le niega', () => {
    expect(rutaDeInicio(() => false)).toBe('/admin/sin-acceso');
  });

  it('el menú ya no tiene Pregúntame', () => {
    const rutas = MENU.flatMap((g) => g.opciones.map((o) => o.ruta));
    expect(rutas).not.toContain('/admin/asistente');
  });
});
