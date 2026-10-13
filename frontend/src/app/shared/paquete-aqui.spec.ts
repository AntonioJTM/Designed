import { paqueteFueraDeAqui } from './paquete-aqui';

/** 2026-10-07: la caja solo vende los paquetes de su tienda. */
describe('paqueteFueraDeAqui', () => {
  it('el de otro almacén dice dónde está y pide otro', () => {
    expect(paqueteFueraDeAqui({ codigo: '00633586', almacen_id: 2, almacen: 'Almacen General' }, 1, 'Tienda Principal'))
      .toBe('El paquete 00633586 sí existe, pero está en «Almacen General», no en «Tienda Principal»: toma uno que esté en esta tienda.');
  });
  it('el que viene en camino no se vende hasta recibirlo', () => {
    expect(paqueteFueraDeAqui({ codigo: 'X', almacen_id: 1, almacen: 'Tienda', en_camino_folio: 'TRA-1-B464' }, 1))
      .toContain('viene en camino (TRA-1-B464)');
  });
  it('el de aquí, y el capturado a mano sin almacén, sí', () => {
    expect(paqueteFueraDeAqui({ codigo: 'X', almacen_id: 1, almacen: 'Tienda' }, 1)).toBeNull();
    expect(paqueteFueraDeAqui({ codigo: 'X', almacen_id: null }, 1)).toBeNull();
  });
});
