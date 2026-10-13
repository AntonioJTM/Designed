'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { pesos } = require('./letras');

test('la cantidad con letra, como va en un recibo', () => {
  assert.strictEqual(pesos(0), 'Cero pesos 00/100 M.N.');
  assert.strictEqual(pesos(1), 'Un peso 00/100 M.N.');
  assert.strictEqual(pesos(21), 'Veintiún pesos 00/100 M.N.');
  assert.strictEqual(pesos(31.5), 'Treinta y un pesos 50/100 M.N.');
  assert.strictEqual(pesos(100), 'Cien pesos 00/100 M.N.');
  assert.strictEqual(pesos(101), 'Ciento un pesos 00/100 M.N.');
  assert.strictEqual(pesos(1000), 'Mil pesos 00/100 M.N.');
  assert.strictEqual(pesos(1230.5), 'Mil doscientos treinta pesos 50/100 M.N.');
  assert.strictEqual(pesos(2016.07), 'Dos mil dieciséis pesos 07/100 M.N.');
  assert.strictEqual(pesos(21000), 'Veintiún mil pesos 00/100 M.N.');
  assert.strictEqual(pesos(101000), 'Ciento un mil pesos 00/100 M.N.');
  assert.strictEqual(pesos(1000000), 'Un millón de pesos 00/100 M.N.');
  assert.strictEqual(pesos(2500000), 'Dos millones quinientos mil pesos 00/100 M.N.');
  assert.strictEqual(pesos(4999.999), 'Cinco mil pesos 00/100 M.N.');
});
