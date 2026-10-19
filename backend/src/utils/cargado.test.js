'use strict';

// Lo que tiene cargado un hilo o una presentación, en palabras de tienda (2026-10-16).
const test = require('node:test');
const assert = require('node:assert/strict');
const { motivosCarga, enLista } = require('./cargado');

test('dice lo cargado en palabras de tienda, en singular y en plural', () => {
  const c = { cargas: 1, bultos: 80, kg: 1527.5, saldos: 2, movimientos: 3, ventas: 0, traspasos: 0, desarmes: 0, compras: 0, carritos: 0 };
  assert.deepEqual(motivosCarga(c), ['1 carga de mercancía', '80 bultos', '1,527.5 kg en existencia', '3 movimientos en el kardex']);
});

test('una presentación vacía no tiene motivos', () => {
  assert.deepEqual(motivosCarga({ cargas: 0, bultos: 0, kg: 0, saldos: 0, movimientos: 0 }), []);
});

test('"a, b y c"', () => {
  assert.equal(enLista(['a', 'b', 'c']), 'a, b y c');
  assert.equal(enLista(['a']), 'a');
  assert.equal(enLista([]), '');
});
