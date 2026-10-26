'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { leerHoja, leerLibro } = require('../../utils/xlsx');
const { plantillaLista, plantillaHilo } = require('./plantillas');
const { analizar } = require('./service');
const { analizarLista } = require('./lista');

// Las plantillas para llenar (2026-10-22): lo que la tienda escribe en ellas lo
// tiene que leer la carga tal cual, con los ceros del código y el calibre en texto.

test('la plantilla de un hilo vacía trae el encabezado que pide la carga', () => {
  const { hoja, filas } = leerHoja(plantillaHilo());
  assert.equal(hoja, 'Paquetes');
  assert.equal(filas.length, 1);
  assert.match(filas[0].celdas.A, /^Código presentación/);
  assert.match(filas[0].celdas.B, /^Cantidad/);
  assert.equal(filas[0].celdas.C, 'Lote');
  assert.match(filas[0].celdas.F, /^CONO/);
  // Vacía no se carga: dice que no trae renglones.
  assert.throws(() => analizar(plantillaHilo(), 'x.xlsx'), /no tiene renglones/);
});

test('lo escrito en la plantilla de un hilo se lee: código con ceros, peso, lote y conos', () => {
  const r = analizar(plantillaHilo([
    ['00633586', 19.25, '0096952', '', '', 12],
    ['00633587', 10.75, '0096952', '', '', 7],
  ]), 'ROJO 1-30.xlsx');
  assert.equal(r.bultos.length, 2);
  assert.deepEqual(r.bultos[0], { fila: 2, codigo: '00633586', peso_kg: 19.25, lote: '0096952', conos: 12 });
  assert.equal(r.resumen.kg_total, 30);
  assert.equal(r.avisos.length, 0);
});

test('la plantilla de la lista: GLOBAL primero, DOCUMENTO e INSTRUCCIONES', () => {
  const { hojas } = leerLibro(plantillaLista());
  assert.deepEqual(hojas.map((h) => h.nombre), ['GLOBAL', 'DOCUMENTO', 'INSTRUCCIONES']);
  assert.deepEqual(Object.values(hojas[0].filas[0].celdas),
    ['BOX NO', 'COLOR', 'CALIBRE', 'LOT', 'GROSS', 'TARE', 'NET', 'CONOS', 'ARTICULO', 'NOTA']);
});

test('lo escrito en la plantilla de la lista se lee por hilo, con el calibre como texto', () => {
  const r = analizarLista(plantillaLista([
    ['00633586', 'MARINO', '2/30', '0096952', 19.9, 0.65, 19.25, 12, '%100 ACRYLIC', ''],
    ['00633587', 'MARINO', '2/30', '0096953', '', '', 18.5, 12, '', ''],
    ['00700001', 'ROJO', '1-30', '0101', '', '', 10.75, 7, '', 'caja golpeada'],
  ]), 'Lista.xlsx');
  assert.equal(r.errores.length, 0, JSON.stringify(r.errores));
  assert.equal(r.hilos.length, 2);
  const marino = r.hilos.find((h) => h.nombre === 'MARINO');
  assert.equal(marino.calibre, '2/30');
  assert.equal(marino.bultos.length, 2);
  assert.equal(marino.bultos[0].codigo, '00633586');
  assert.equal(r.hilos.find((h) => h.nombre === 'ROJO').calibre, '1/30');
});
