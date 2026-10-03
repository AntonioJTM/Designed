import { domingoDe, rangoCorto, rangoLargo, sumarDias } from './semana';

/**
 * La semana de nómina va de DOMINGO a SÁBADO. Estas cuentas arman el selector y
 * los textos; si se corrieran un día, la pantalla ofrecería semanas que el
 * backend no reconoce.
 */
describe('semana de nómina', () => {
  it('cualquier día cae en el domingo de su semana', () => {
    expect(domingoDe('2026-10-02')).toBe('2026-09-27'); // viernes
    expect(domingoDe('2026-09-27')).toBe('2026-09-27'); // domingo
    expect(domingoDe('2026-10-03')).toBe('2026-09-27'); // sábado: aún es la misma semana
  });

  it('suma días cruzando de mes y de año', () => {
    expect(sumarDias('2026-09-27', 6)).toBe('2026-10-03');
    expect(sumarDias('2026-12-27', 7)).toBe('2027-01-03');
    expect(sumarDias('2026-10-04', -7)).toBe('2026-09-27');
  });

  it('nombra la semana como la dice la tienda', () => {
    const hoy = '2026-10-02';
    expect(rangoCorto('2026-09-27', '2026-10-03', hoy)).toBe('Semana del 27 sep al 3 oct');
    expect(rangoCorto('2026-09-13', '2026-09-19', hoy)).toBe('Semana del 13 al 19 sep');
    expect(rangoLargo('2026-09-20', '2026-09-26', hoy)).toBe('20 al 26 de septiembre');
    expect(rangoLargo('2026-09-27', '2026-10-03', hoy)).toBe('27 de septiembre al 3 de octubre');
    // Otro año: se dice cuál.
    expect(rangoLargo('2025-12-28', '2026-01-03', '2026-10-02')).toBe('28 de diciembre de 2025 al 3 de enero');
  });
});
