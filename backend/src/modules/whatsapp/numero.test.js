'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { numeroWhatsapp, numeroLegible } = require('./numero');

test('un celular de México lleva el 52; con el 52 o el 521 de antes, se respeta', () => {
  assert.strictEqual(numeroWhatsapp('775 165 9032'), '527751659032');
  assert.strictEqual(numeroWhatsapp('(775) 165-9032'), '527751659032');
  assert.strictEqual(numeroWhatsapp('+52 775 165 9032'), '527751659032');
  assert.strictEqual(numeroWhatsapp('521 775 165 9032'), '527751659032');
});

test('incompleto, vacío o raro no sirve; otro país, con + y su clave', () => {
  assert.strictEqual(numeroWhatsapp('775 165'), null);
  assert.strictEqual(numeroWhatsapp(''), null);
  assert.strictEqual(numeroWhatsapp(null), null);
  assert.strictEqual(numeroWhatsapp('1 555 123 4567 8'), null);
  assert.strictEqual(numeroWhatsapp('+1 555 123 4567'), '15551234567');
});

test('el número enlazado se enseña como se lee', () => {
  assert.strictEqual(numeroLegible('5217751659032@s.whatsapp.net'), '+52 775 165 9032');
  assert.strictEqual(numeroLegible('527751659032:12@s.whatsapp.net'), '+52 775 165 9032');
  assert.strictEqual(numeroLegible('15551234567@s.whatsapp.net'), '+15551234567');
  assert.strictEqual(numeroLegible(null), null);
});
