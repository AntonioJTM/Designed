import { TurnoAbierto, avisoOtraTienda, deOtraTienda, nombreTurno, turnoPropuesto, turnoUnicoAqui } from './turnos-de-la-nota';

// EL TURNO DONDE CAE EL EFECTIVO DE UNA NOTA (2026-10-26, auditoría): uno de otra
// tienda ya no se elige solo.
const turno = (id: number, caja_id: number, almacen_id: number, almacen: string, caja: string): TurnoAbierto =>
  ({ id, caja_id, caja, almacen_id, almacen, usuario_id: 1, monto_inicial: '0', estado: 'abierta', fecha_apertura: '' }) as TurnoAbierto;

describe('turnos de la nota', () => {
  const matriz = turno(70, 7, 1, 'MATRIZ', 'Caja Matriz');
  const moroleon = turno(80, 8, 2, 'MOROLEÓN', 'Caja Moroleón');

  afterEach(() => {
    try { localStorage.removeItem('caja_sel'); } catch { /* sin storage */ }
  });

  it('con un solo turno abierto y de la tienda de la nota, ese se elige solo', () => {
    expect(turnoPropuesto([moroleon], 2)).toBe(80);
    expect(turnoUnicoAqui([moroleon], 2)).toBe(true);
  });

  it('el único abierto es de OTRA tienda: no se elige solo y se avisa', () => {
    expect(turnoPropuesto([matriz], 2)).toBeNull();
    expect(turnoUnicoAqui([matriz], 2)).toBe(false);
    expect(deOtraTienda(matriz, 2)).toBe(true);
    expect(nombreTurno(matriz, 2)).toBe('Caja Matriz · otra tienda: MATRIZ');
    expect(avisoOtraTienda([matriz], 70, 2, 'MOROLEÓN')).toContain('Esta nota es de «MOROLEÓN»');
  });

  it('con varios, el de su tienda; y la caja con que se trabaja solo si es de esa tienda', () => {
    expect(turnoPropuesto([matriz, moroleon], 2)).toBe(80);
    try { localStorage.setItem('caja_sel', '7'); } catch { /* sin storage */ }
    expect(turnoPropuesto([matriz, moroleon], 2)).toBe(80);
  });

  it('una caja sin tienda conocida no se toma como de otra tienda', () => {
    const sinTienda = { ...matriz, almacen_id: null } as TurnoAbierto;
    expect(deOtraTienda(sinTienda, 2)).toBe(false);
    expect(avisoOtraTienda([moroleon], 80, 2, 'MOROLEÓN')).toBeNull();
  });
});
