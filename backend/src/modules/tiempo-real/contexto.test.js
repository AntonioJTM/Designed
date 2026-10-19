'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { conAnotaciones, anotarAlmacen, anotarCompartido } = require('./contexto');

const pausa = () => new Promise((r) => setTimeout(r, 5));

test('lo que se anota dentro de la petición, aunque sea después de esperar a la base', async () => {
  let listo;
  const termino = new Promise((r) => { listo = r; });
  const notas = conAnotaciones(async () => {
    anotarAlmacen(2);
    await pausa();
    anotarAlmacen('3');
    anotarCompartido('clientes');
    listo();
  });
  await termino;
  assert.deepEqual([...notas.almacenes], [2, 3]);
  assert.deepEqual([...notas.compartidos], ['clientes']);
});

test('dos peticiones a la vez no se mezclan, y fuera de una no se anota nada', async () => {
  const a = conAnotaciones(async () => { await pausa(); anotarAlmacen(1); });
  const b = conAnotaciones(async () => { anotarAlmacen(7); await pausa(); });
  anotarAlmacen(9); // fuera de toda petición
  await pausa(); await pausa();
  assert.deepEqual([...a.almacenes], [1]);
  assert.deepEqual([...b.almacenes], [7]);
});
