import { DiaHorario } from '../../../core/models/nomina.models';
import {
  diaSemana,
  diasLaborales,
  horasSemana,
  horasTexto,
  importeExtra,
  minutosExtra,
  salarioDiario,
  turno,
  valorHora,
} from './jornada';

/**
 * La vista previa de la nómina tiene que dar lo mismo que el backend
 * (`modules/nomina/jornada.js` y su prueba). Mismo horario, mismas cifras.
 */
const HORARIO: DiaHorario[] = [
  ...[1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, hora_entrada: '09:00', hora_salida: '18:00' })),
  { dia_semana: 6, hora_entrada: '10:00', hora_salida: '14:00' },
];

describe('jornada de nómina', () => {
  it('días, horas, día y hora como en el backend', () => {
    expect(diasLaborales(HORARIO)).toBe(6);
    expect(horasSemana(HORARIO)).toBe(49);
    expect(horasSemana(HORARIO, 60)).toBe(43);
    expect(salarioDiario(1800, HORARIO)).toBe(300);
    expect(valorHora(1800, HORARIO, 60)).toBe(41.86);
    expect(salarioDiario(1800, [])).toBeNull();
  });

  it('horas extra contra su horario de ese día', () => {
    expect(minutosExtra(HORARIO[3], null, '20:00')).toEqual({ minutos: 120 });
    expect(minutosExtra(HORARIO[4], '07:30', null)).toEqual({ minutos: 90 });
    expect(minutosExtra(HORARIO[4], '10:00', '17:00')).toEqual({ minutos: 0 });
    expect(minutosExtra(null, '10:00', '14:30')).toEqual({ minutos: 270 });
    expect(minutosExtra(null, null, '14:30').error).toBeTruthy();
  });

  it('al doble, con los mismos centavos que el backend', () => {
    expect(importeExtra(120, 41.86)).toBe(167.44);
    expect(importeExtra(90, 41.86)).toBe(125.58);
    expect(importeExtra(270, 41.86)).toBe(376.74);
  });

  it('textos', () => {
    expect(turno(HORARIO[5])).toBe('10:00 a 14:00');
    expect(horasTexto(90)).toBe('1.5 h');
    expect(diaSemana('2031-03-09')).toBe(0);
  });
});
