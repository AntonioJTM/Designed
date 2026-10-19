import { DESTINO_AVISO, urlDe } from './avisos';

describe('A dónde lleva cada aviso', () => {
  it('las existencias en su mínimo abren Inventario ya filtrado', () => {
    expect(urlDe(DESTINO_AVISO.existenciasBajas)).toBe('/admin/inventario?ver=minimo');
  });

  it('los hilos sin precio abren Productos con ese filtro, y sin filtro no agrega nada', () => {
    expect(urlDe(DESTINO_AVISO.sinPrecio)).toBe('/admin/productos?falta=precio');
    expect(urlDe(DESTINO_AVISO.cobranza)).toBe('/admin/clientes/deuda');
  });
});
