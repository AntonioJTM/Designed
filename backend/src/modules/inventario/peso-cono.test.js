'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pesoPorCono } = require('./peso-cono');

const b = (kg, destare, conos) => ({ kg_consumidos: String(kg), destare_kg: destare == null ? null : String(destare), piezas_generadas: String(conos) });

test('un cono pesa lo del paquete escaneado más su destare, entre los conos que salieron', () => {
  // 19.5 kg + 12 conos × 0.035 kg de tubo = 19.92 kg ÷ 12 = 1.66 kg.
  assert.equal(pesoPorCono([b(19.5, 0.42, 12)]), 1.66);
});

test('junta todas las bajadas: un paquete chico de 7 conos no manda solo', () => {
  // (19.5 + 0.42) + (10.75 + 0.245) = 30.915 kg ÷ 19 conos = 1.627 kg.
  assert.equal(pesoPorCono([b(19.5, 0.42, 12), b(10.75, 0.245, 7)]), 1.627);
});

test('sin destare cuenta solo el hilo; sin bajadas no hay peso', () => {
  assert.equal(pesoPorCono([b(19.2, null, 12)]), 1.6);
  assert.equal(pesoPorCono([]), null);
  assert.equal(pesoPorCono([b(19.2, 0, 0)]), null);
});
