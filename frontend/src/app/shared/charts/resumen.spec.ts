import { resumenGrafica } from './resumen';

/** Lo que el lector de pantalla dice de una gráfica (auditoría 2026-10-13). */
describe('resumenGrafica', () => {
  it('dice qué mide y luego cada dato', () => {
    expect(resumenGrafica('Quién debe más', ['Doña Mari: $3,200', 'Tejidos JC: $1,500'])).toBe(
      'Quién debe más. Doña Mari: $3,200; Tejidos JC: $1,500.'
    );
  });

  it('con muchos datos dice cuántos faltan (el detalle está en la tabla)', () => {
    const datos = Array.from({ length: 13 }, (_, i) => `H${i}: ${i}`);
    expect(resumenGrafica('X', datos)).toMatch(/H9: 9; y 3 más\.$/);
  });

  it('sin datos lo dice, en vez de quedarse mudo', () => {
    expect(resumenGrafica('Quién debe más', [])).toBe('Quién debe más. Sin datos.');
    expect(resumenGrafica('', [])).toBe('Gráfica sin datos.');
  });
});
