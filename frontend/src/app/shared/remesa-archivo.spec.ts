import { cotejarArchivo, hiloDelArchivo, textoAviso } from './remesa-archivo';

/**
 * Los casos son los archivos REALES del proveedor y los tres errores que de
 * verdad se cargaron el 2026-07-28.
 */
describe('cotejo del nombre del archivo de la remesa', () => {
  it('lee color y calibre de los nombres del proveedor', () => {
    expect(hiloDelArchivo('MARINO OSCURO 2-30.xlsx')).toEqual({
      color: 'MARINO OSCURO',
      calibre: '2/30',
    });
    expect(hiloDelArchivo('ROJO 1-30.xlsx')).toEqual({ color: 'ROJO', calibre: '1/30' });
    expect(hiloDelArchivo('GRIS PERLA 2-30.xlsx')).toEqual({
      color: 'GRIS PERLA',
      calibre: '2/30',
    });
    // Y con la ruta completa, que es lo que manda el navegador en algunos casos.
    // (En el nombre el calibre siempre va con guion: la diagonal no se puede.)
    expect(hiloDelArchivo('C:\\bajados\\NEGRO 2-30.xlsx')).toEqual({
      color: 'NEGRO',
      calibre: '2/30',
    });
  });

  it('sin calibre en el nombre, al menos saca el color', () => {
    expect(hiloDelArchivo('ROSA MEXICANO.xlsx')).toEqual({
      color: 'ROSA MEXICANO',
      calibre: null,
    });
  });

  it('un nombre que no sigue la convención no opina nada', () => {
    expect(hiloDelArchivo('.xlsx')).toBeNull();
    expect(cotejarArchivo('lista de empaque final.xlsx', { producto: 'NEGRO', calibre: '2/30' })
      .map((a) => a.campo)).toEqual(['color']);
  });

  it('cuando cuadra, no avisa nada', () => {
    expect(cotejarArchivo('NEGRO 2-30.xlsx', { producto: 'NEGRO', calibre: '2/30' })).toEqual([]);
    // Acentos y minúsculas no son un desacuerdo.
    expect(cotejarArchivo('marino oscuro 2-30.xlsx', {
      producto: 'MARINO OSCÜRO',
      calibre: '2/30',
    })).toEqual([]);
  });

  it('cacha el color equivocado: ROJO 1-30 sobre AMARILLO', () => {
    const avisos = cotejarArchivo('ROJO 1-30.xlsx', { producto: 'AMARILLO', calibre: '1/30' });
    expect(avisos.length).toBe(1);
    expect(avisos[0]).toEqual({ campo: 'color', delArchivo: 'ROJO', delProducto: 'AMARILLO' });
    expect(textoAviso(avisos)).toContain('«ROJO»');
  });

  it('cacha el CALIBRE equivocado, que es el que no se ve a ojo', () => {
    // El caso real: MARINO OSCURO 2-30.xlsx entró a MARINO OSCURO 1/30.
    const avisos = cotejarArchivo('MARINO OSCURO 2-30.xlsx', {
      producto: 'MARINO OSCURO',
      calibre: '1/30',
    });
    expect(avisos.length).toBe(1);
    expect(avisos[0]).toEqual({ campo: 'calibre', delArchivo: '2/30', delProducto: '1/30' });
  });

  it('cacha los dos a la vez: ROSA MEXICANO 2-30 sobre DEV_2 1/30', () => {
    const avisos = cotejarArchivo('ROSA MEXICANO 2-30.xlsx', {
      producto: 'DEV_2',
      calibre: '1/30',
    });
    expect(avisos.map((a) => a.campo)).toEqual(['color', 'calibre']);
    expect(textoAviso(avisos)).toContain(', y ');
  });

  it('sin calibre capturado en el producto no inventa un desacuerdo', () => {
    expect(cotejarArchivo('NEGRO 2-30.xlsx', { producto: 'NEGRO', calibre: null })).toEqual([]);
  });

  it('sin archivo no hay nada que cotejar', () => {
    expect(cotejarArchivo(null, { producto: 'NEGRO', calibre: '2/30' })).toEqual([]);
    expect(textoAviso([])).toBeNull();
  });
});
