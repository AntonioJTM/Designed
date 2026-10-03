import { CuandoPipe } from './cuando.pipe';

/** "hoy 13:42", "ayer 17:10", "28 sep 11:30": como se dice en la tienda. */
describe('CuandoPipe', () => {
  const p = new CuandoPipe();
  const ahora = new Date(2026, 9, 2, 18, 0); // 2 oct 2026, 18:00

  it('hoy y ayer con su hora, sin cero de relleno', () => {
    expect(p.transform('2026-10-02 08:15:00', false, ahora)).toBe('hoy 8:15');
    expect(p.transform('2026-10-01 17:10:09', false, ahora)).toBe('ayer 17:10');
  });

  it('otro día del año con el mes abreviado; otro año, con el año y sin hora', () => {
    expect(p.transform('2026-09-28 11:30:00', false, ahora)).toBe('28 sep 11:30');
    expect(p.transform('2025-09-28 11:30:00', false, ahora)).toBe('28 sep 2025');
  });

  it('solo la fecha, y un guion cuando no hay', () => {
    expect(p.transform('2026-10-02 08:15:00', true, ahora)).toBe('hoy');
    expect(p.transform(null)).toBe('—');
  });
});
