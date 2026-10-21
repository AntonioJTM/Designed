import { nombreLote, paquetes, porLote } from './lotes';

/** Los paquetes de una venta por lote (2026-10-20): la caja, el ticket y el detalle dicen lo mismo. */
describe('porLote', () => {
  it('agrupa por lote, en el orden en que se escaneó el primero de cada uno, con cuántos y sus kilos', () => {
    const g = porLote([
      { codigo: 'A1', peso_kg: 19.1, lote: '0094853' },
      { codigo: 'B1', peso_kg: '18.4', lote: '0094860' },
      { codigo: 'A2', peso_kg: 19.45, lote: '0094853' },
      { codigo: 'C1', peso_kg: 10, lote: null },
    ]);
    expect(g.map((x) => x.lote)).toEqual(['0094853', '0094860', null]);
    expect(g[0].bultos.map((b) => b.codigo)).toEqual(['A1', 'A2']);
    expect(g[0].kg).toBe(38.55);
    expect(g[1].kg).toBe(18.4);
  });

  it('sin paquetes, nada; y los textos', () => {
    expect(porLote(undefined)).toEqual([]);
    expect(nombreLote('0094853')).toBe('Lote 0094853');
    expect(nombreLote(null)).toBe('Sin lote');
    expect(paquetes(1)).toBe('1 paquete');
    expect(paquetes(3)).toBe('3 paquetes');
  });
});
