'use strict';

// Desde cuándo corre el reloj "sin abonar" (2026-10-16): el aviso de la caja.
const test = require('node:test');
const assert = require('node:assert/strict');
const { desdeSinAbonar } = require('./model');

const m = (tipo, monto, dia) => ({ tipo, monto, dia });

test('nunca ha abonado: desde que empezó a deber', () => {
  assert.equal(desdeSinAbonar([m('cargo', 1000, '2026-09-01'), m('cargo', 500, '2026-10-10')]), '2026-09-01');
});

test('abonó después: desde su último abono', () => {
  assert.equal(desdeSinAbonar([m('cargo', 1000, '2026-09-01'), m('abono', 200, '2026-10-01'), m('cargo', 300, '2026-10-12')]), '2026-10-01');
});

test('lo pagó todo y se le fió otra vez: desde el nuevo cargo, no desde el abono viejo', () => {
  assert.equal(desdeSinAbonar([m('cargo', 1000, '2026-01-10'), m('abono', 1000, '2026-01-20'), m('cargo', 400, '2026-10-14')]), '2026-10-14');
});

test('no debe: null (también con un ajuste que lo deja en cero)', () => {
  assert.equal(desdeSinAbonar([]), null);
  assert.equal(desdeSinAbonar([m('cargo', 500, '2026-09-01'), m('ajuste', -500, '2026-09-05')]), null);
});
