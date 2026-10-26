import { alcanzaHasta, celdaCsv, cuandoPedir, estadoTexto, fechaLarga, semanas, toneladas } from './rotacion-ui';

/**
 * Lo que comparten las pestañas de Rotación: fechas en palabras (el año solo si
 * está lejos), toneladas, semanas, el estado y la celda del archivo para Excel.
 */
describe('rotacion-ui', () => {
  it('fechas en palabras: el año solo si cae en otro y a más de 6 meses', () => {
    expect(fechaLarga('2027-01-14', '2026-10-22')).toBe('14 de enero');
    expect(fechaLarga('2027-07-11', '2026-10-22')).toBe('11 de julio de 2027');
    expect(alcanzaHasta(null, '2026-10-22')).toBe('Más de 5 años');
    expect(alcanzaHasta('2030-02-03', '2026-10-22')).toBe('Febrero de 2030');
  });

  it('cuándo pedir: ya pasó, hoy, mañana, en N días', () => {
    expect(cuandoPedir('2026-10-15', '2026-10-22')).toBe('ya pasó');
    expect(cuandoPedir('2026-10-22', '2026-10-22')).toBe('hoy');
    expect(cuandoPedir('2026-10-29', '2026-10-22')).toBe('en 7 días');
    expect(cuandoPedir('2026-12-01', '2026-10-22')).toBe('');
  });

  it('toneladas desde 1,000 kg, semanas y el estado', () => {
    expect(toneladas(5240)).toBe('5.24 t');
    expect(toneladas(744)).toBe('744 kg');
    expect(semanas(1)).toBe('1 semana');
    expect(semanas(9.46)).toBe('9.5 semanas');
    expect(estadoTexto('pronto', '2026-12-26')).toEqual({ texto: 'En diciembre', pill: 'ambar' });
  });

  it('la celda del CSV: comillas cuando hace falta y nunca una fórmula', () => {
    expect(celdaCsv('MARINO 2/30')).toBe('MARINO 2/30');
    expect(celdaCsv('ROJO, el bueno')).toBe('"ROJO, el bueno"');
    expect(celdaCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(celdaCsv('+52')).toBe("'+52");
    expect(celdaCsv(-5)).toBe('-5');
    expect(celdaCsv(null)).toBe('');
  });
});
