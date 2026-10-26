'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { soloConTodas, notaTiendas, SOLO_TODAS_LAS_TIENDAS } = require('./catalogo');

// Lo que NO ve ni hace quien trabaja en una sola tienda (2026-10-22: Contabilidad
// tenía Transferencias y su persona, de la Matriz, no la veía sin saber por qué).

test('las pantallas de todas las tiendas de un puesto, con su nombre', () => {
  const r = soloConTodas(['ver:transferencias', 'ver:reportes', 'ver:inventario', 'ver:kardex']);
  assert.deepEqual(r.pantallas, ['Reportes', 'Transferencias']);
  assert.deepEqual(r.acciones, []);
});

test('también las miradas de Clientes y cambiar los tipos de gasto', () => {
  const r = soloConTodas(['ver:clientes', 'hacer:tipos_gasto', 'ver:pos']);
  assert.deepEqual(r.pantallas, ['las miradas de Clientes']);
  assert.deepEqual(r.acciones, ['cambiar los tipos de gasto']);
});

test('un puesto sin nada de eso no pierde nada', () => {
  assert.deepEqual(soloConTodas(['ver:pos', 'ver:caja']), { pantallas: [], acciones: [] });
});

test('la etiqueta de Permisos', () => {
  for (const c of SOLO_TODAS_LAS_TIENDAS) assert.equal(notaTiendas(c), 'Solo con todas las tiendas');
  assert.match(notaTiendas('ver:clientes'), /miradas/);
  assert.equal(notaTiendas('ver:pos'), null);
});
