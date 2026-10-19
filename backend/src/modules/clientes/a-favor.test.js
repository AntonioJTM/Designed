'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { aFavorDe } = require('./a-favor');

const m = (tipo, monto, dia) => ({ tipo, monto: String(monto), dia });

test('un anticipo queda a favor desde el día que lo dejó', () => {
  assert.deepEqual(aFavorDe([m('anticipo', 500, '2026-10-15')]), { saldo: 500, desde: '2026-10-15', ultimo: '2026-10-15' });
});

test('usar una parte no cambia desde cuándo lo tiene', () => {
  const r = aFavorDe([m('anticipo', 500, '2026-10-15'), m('uso', 200, '2026-10-18')]);
  assert.deepEqual(r, { saldo: 300, desde: '2026-10-15', ultimo: '2026-10-18' });
});

test('si lo gastó todo y luego regresó mercancía, cuenta desde la devolución', () => {
  const r = aFavorDe([m('anticipo', 500, '2026-10-01'), m('uso', 500, '2026-10-05'), m('devolucion', 120, '2026-10-12')]);
  assert.deepEqual(r, { saldo: 120, desde: '2026-10-12', ultimo: '2026-10-12' });
});

test('sin nada a favor da cero; un ajuste en negativo resta', () => {
  assert.equal(aFavorDe([m('anticipo', 100, '2026-10-01'), m('ajuste', -100, '2026-10-02')]).saldo, 0);
  assert.equal(aFavorDe([]).saldo, 0);
});
