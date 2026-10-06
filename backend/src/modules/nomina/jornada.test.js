'use strict';

// node --test src/modules/nomina/jornada.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const j = require('./jornada');

// Lunes a viernes de 9:00 a 18:00 y el sábado de 10:00 a 14:00 (descansa el domingo).
const HORARIO = [
  { dia_semana: 1, hora_entrada: '09:00', hora_salida: '18:00' },
  { dia_semana: 2, hora_entrada: '09:00', hora_salida: '18:00' },
  { dia_semana: 3, hora_entrada: '09:00', hora_salida: '18:00' },
  { dia_semana: 4, hora_entrada: '09:00', hora_salida: '18:00' },
  { dia_semana: 5, hora_entrada: '09:00', hora_salida: '18:00' },
  { dia_semana: 6, hora_entrada: '10:00:00', hora_salida: '14:00:00' },
];

test('días que trabaja y horas de su semana, con y sin comida', () => {
  assert.equal(j.diasLaborales(HORARIO), 6);
  assert.equal(j.horasSemana(HORARIO), 49); // 5 × 9 + 4
  assert.equal(j.horasSemana(HORARIO, 60), 43); // una hora de comida cada día
  assert.equal(j.diasLaborales([]), 0);
});

test('el día vale sueldo ÷ días que trabaja; la hora, sueldo ÷ horas de su semana', () => {
  assert.equal(j.salarioDiario(1800, HORARIO), 300);
  assert.equal(j.valorHora(1960, HORARIO), 40); // 1960 / 49
  assert.equal(j.salarioDiario(1800, []), null);
  assert.equal(j.valorHora(1800, []), null);
});

test('pagar por días: 6 de 6 da el sueldo exacto, aunque el día no sea redondo', () => {
  assert.equal(j.pagoPorDias(1000, HORARIO, 6), 1000); // 166.666… × 6
  assert.equal(j.pagoPorDias(1000, HORARIO, 5), 833.33);
  assert.equal(j.pagoPorDias(1800, HORARIO, 4.5), 1350);
});

test('horas extra contra su horario de ese día', () => {
  const martes = HORARIO[1];
  assert.deepEqual(j.minutosExtra(martes, null, '20:00'), { minutos: 120 });
  assert.deepEqual(j.minutosExtra(martes, '07:30', null), { minutos: 90 });
  assert.deepEqual(j.minutosExtra(martes, '08:00', '19:30'), { minutos: 150 });
  // Salir temprano o llegar tarde no resta: solo cuenta lo que pasa del horario.
  assert.deepEqual(j.minutosExtra(martes, '10:00', '17:00'), { minutos: 0 });
  // El sábado sale a las 14:00: quedarse a las 16:00 son 2 horas.
  assert.deepEqual(j.minutosExtra(HORARIO[5], null, '16:00'), { minutos: 120 });
});

test('en su día de descanso todo lo trabajado es extra, y pide las dos horas', () => {
  assert.deepEqual(j.minutosExtra(null, '10:00', '14:30'), { minutos: 270 });
  assert.ok(j.minutosExtra(null, null, '14:00').error);
  assert.ok(j.minutosExtra(null, '14:00', '10:00').error);
});

test('horas mal escritas dan un motivo, no un número', () => {
  assert.ok(j.minutosExtra(HORARIO[1], null, '25:00').error);
  assert.ok(j.minutosExtra(HORARIO[1], 'ocho', null).error);
  assert.ok(j.minutosExtra(HORARIO[1], null, null).error);
});

test('la hora extra se paga al doble', () => {
  assert.equal(j.FACTOR_HORA_EXTRA, 2);
  assert.equal(j.importeExtra(120, 40), 160); // 2 h × $40 × 2
  assert.equal(j.importeExtra(90, 35.29), 105.87); // 1.5 h × 35.29 × 2
});

test('días de trabajo en un rango de fechas, según su horario', () => {
  // 2026-10-04 es domingo; del domingo al sábado trabaja 6 días.
  assert.equal(j.diaSemana('2026-10-04'), 0);
  assert.equal(j.diasHabilesEnRango(HORARIO, '2026-10-04', '2026-10-10'), 6);
  assert.equal(j.diasHabilesEnRango(HORARIO, '2026-10-05', '2026-10-07'), 3);
  assert.equal(j.diasHabilesEnRango(HORARIO, '2026-10-11', '2026-10-11'), 0); // domingo
  assert.equal(j.diasHabilesEnRango(HORARIO, '2026-10-10', '2026-10-05'), 0);
});

test('vacaciones por ley (reforma 2023)', () => {
  const esperado = { 0: 0, 1: 12, 2: 14, 3: 16, 4: 18, 5: 20, 6: 22, 10: 22, 11: 24, 15: 24, 16: 26, 21: 28, 26: 30, 31: 32 };
  for (const [anios, dias] of Object.entries(esperado)) {
    assert.equal(j.diasVacacionesPorLey(Number(anios)), dias, `${anios} años`);
  }
});

test('antigüedad y año de vacaciones desde la fecha de ingreso', () => {
  assert.equal(j.aniosCumplidos('2023-03-15', '2026-03-14'), 2);
  assert.equal(j.aniosCumplidos('2023-03-15', '2026-03-15'), 3);
  assert.equal(j.aniosCumplidos('2026-03-15', '2026-10-06'), 0);
  assert.deepEqual(j.periodoVacacional('2023-03-15', '2026-10-06'), {
    anios: 3, desde: '2026-03-15', hasta: '2027-03-15', corresponden: 16,
  });
});

test('saldo: le tocan, lleva y le quedan, solo dentro de su año vigente', () => {
  const registros = [
    { fecha_inicio: '2025-12-01', dias: 5 }, // del año anterior: no cuenta
    { fecha_inicio: '2026-04-06', dias: 6 },
    { fecha_inicio: '2026-08-10', dias: '3.0' },
  ];
  const s = j.saldoVacaciones('2023-03-15', '2026-10-06', registros);
  assert.equal(s.corresponden, 16);
  assert.equal(s.tomados, 9);
  assert.equal(s.restan, 7);
  assert.equal(s.proximo_aniversario, '2027-03-15');
  assert.equal(s.dias_proximo_anio, 18);
  assert.equal(j.saldoVacaciones(null, '2026-10-06', registros), null);
  // Antes del primer año no le toca nada todavía.
  const nuevo = j.saldoVacaciones('2026-06-01', '2026-10-06', []);
  assert.equal(nuevo.corresponden, 0);
  assert.equal(nuevo.dias_proximo_anio, 12);
});
