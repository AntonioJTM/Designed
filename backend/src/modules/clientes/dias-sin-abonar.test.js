'use strict';

// La cuenta atrasada se mide por su NOTA MÁS VIEJA sin pagar (2026-10-20; el
// usuario eligió "por la nota más vieja"). Antes cualquier abono reiniciaba el reloj.
const test = require('node:test');
const assert = require('node:assert/strict');
const { deudaMasVieja, diasDeLaMasVieja } = require('./model');

const m = (tipo, monto, dia, pedido_id = null) => ({ tipo, monto, dia, pedido_id });

test('nunca ha abonado: desde su nota más vieja', () => {
  assert.equal(deudaMasVieja([m('cargo', 1000, '2026-09-01', 1), m('cargo', 500, '2026-10-10', 2)]).dia, '2026-09-01');
});

test('un abono chiquito NO reinicia el reloj: la nota vieja sigue debiéndose', () => {
  const d = deudaMasVieja([m('cargo', 1000, '2026-09-01', 1), m('abono', 200, '2026-10-01'), m('cargo', 300, '2026-10-12', 2)]);
  assert.equal(d.dia, '2026-09-01');
  assert.equal(d.porPagar, 800);
});

test('si los abonos cubren la nota vieja, cuenta desde la siguiente', () => {
  const d = deudaMasVieja([m('cargo', 1000, '2026-09-01', 1), m('abono', 1200, '2026-10-01'), m('cargo', 300, '2026-10-12', 2)]);
  assert.equal(d.dia, '2026-10-12');
  assert.equal(d.porPagar, 100);
});

test('el abono A UNA NOTA paga esa nota, no la más vieja', () => {
  const d = deudaMasVieja([m('cargo', 1000, '2026-09-01', 1), m('cargo', 300, '2026-10-12', 2), m('abono', 300, '2026-10-15', 2)]);
  assert.equal(d.dia, '2026-09-01');
  assert.equal(d.porPagar, 1000);
});

test('lo pagó todo y se le fió otra vez: desde el nuevo cargo', () => {
  assert.equal(deudaMasVieja([m('cargo', 1000, '2026-01-10', 1), m('abono', 1000, '2026-01-20'), m('cargo', 400, '2026-10-14', 2)]).dia, '2026-10-14');
});

test('no debe: null (también con un ajuste que lo deja en cero)', () => {
  assert.equal(deudaMasVieja([]), null);
  assert.equal(deudaMasVieja([m('cargo', 500, '2026-09-01', 1), m('ajuste', -500, '2026-09-05')]), null);
});

test('los días cuentan desde la nota más vieja hasta hoy', () => {
  const a = diasDeLaMasVieja([m('cargo', 1000, '2026-09-01', 1), m('abono', 200, '2026-10-01')], '2026-10-20');
  assert.deepEqual(a, { dias: 49, porPagar: 800 });
});
