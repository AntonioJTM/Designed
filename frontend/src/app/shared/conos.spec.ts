import { textoConos } from './conos';

describe('textoConos', () => {
  it('cuenta los conos con el peso real de uno (con su tubo)', () => {
    // 13.28 kg ÷ 1.66 kg = 8 conos.
    expect(textoConos(13.28, 1.66)).toBe('≈ 8 conos');
    expect(textoConos('1.700', '1.660')).toBe('≈ 1 cono');
  });

  it('lo que no llega a un cono lo dice así', () => {
    expect(textoConos(0.5, 1.66)).toBe('menos de 1 cono');
  });

  it('sin peso o sin kilos no inventa nada', () => {
    expect(textoConos(10, null)).toBe('');
    expect(textoConos(0, 1.66)).toBe('');
  });
});
