import { RAMPA_AZUL, colorReal, contraste, tintaSobre } from './contraste';

describe('tintaSobre', () => {
  it('elige la letra de mayor contraste, y pasa 4.5:1 en la rampa azul', () => {
    // El caso de la auditoría: sobre el azul medio la blanca daba 3.64:1.
    expect(tintaSobre('#3987e5')).toBe('#161A23');
    expect(tintaSobre('#86b6ef')).toBe('#161A23');
    expect(tintaSobre('#1c5cab')).toBe('#FFFFFF');
    expect(tintaSobre('#0d366b')).toBe('#FFFFFF');
    for (const c of RAMPA_AZUL) expect(contraste(c, tintaSobre(c))).toBeGreaterThanOrEqual(4.5);
  });

  it('el naranja de alerta lleva blanca; un var() se lee de la hoja', () => {
    expect(tintaSobre('#C2410C')).toBe('#FFFFFF');
    expect(colorReal('var(--viz-rampa-2)').toLowerCase()).toBe('#3987e5');
    expect(tintaSobre('var(--viz-rampa-2)')).toBe('#161A23');
    expect(tintaSobre('var(--viz-series-1)')).toBe('#FFFFFF');
  });

  it('un color que no se puede leer se trata como oscuro', () => {
    expect(tintaSobre('var(--no-existe)')).toBe('#FFFFFF');
  });
});
