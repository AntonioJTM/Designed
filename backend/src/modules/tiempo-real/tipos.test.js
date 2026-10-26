'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tiposDeRuta } = require('./tipos');

test('una venta avisa a ventas, inventario, caja, clientes y la campana', () => {
  assert.deepEqual(tiposDeRuta('POST', '/pedidos'), ['ventas', 'inventario', 'caja', 'clientes', 'avisos']);
  assert.deepEqual(tiposDeRuta('PATCH', '/pedidos/12/estado'), ['ventas', 'inventario', 'caja', 'clientes', 'avisos']);
});

test('un traspaso es traspaso e inventario; el resto de inventario, solo inventario', () => {
  assert.deepEqual(tiposDeRuta('POST', '/inventario/traspasos/4/enviar'), ['traspasos', 'inventario', 'avisos']);
  assert.deepEqual(tiposDeRuta('POST', '/inventario/desarmes'), ['inventario', 'avisos']);
});

test('lo que no escribe no avisa: leer, cotizar, la vista previa, entrar, mandar por WhatsApp', () => {
  assert.deepEqual(tiposDeRuta('GET', '/pedidos'), []);
  assert.deepEqual(tiposDeRuta('POST', '/pedidos/cotizacion'), []);
  assert.deepEqual(tiposDeRuta('POST', '/remesas/lista/previa'), []);
  assert.deepEqual(tiposDeRuta('POST', '/usuarios/login'), []);
  assert.deepEqual(tiposDeRuta('POST', '/whatsapp/enviar'), []);
});

test('la vista previa de "Mínimo para varios" no avisa; guardarlo, sí', () => {
  assert.deepEqual(tiposDeRuta('POST', '/inventario/configuracion/minimos', { paquetes: 5 }), []);
  assert.deepEqual(tiposDeRuta('POST', '/inventario/configuracion/minimos', { paquetes: 5, guardar: true }), ['inventario', 'avisos']);
});

test('nómina no avisa: nadie la escucha', () => {
  assert.deepEqual(tiposDeRuta('POST', '/nomina/periodos'), []);
});

test('personal y permisos avisan "sesion": el menú abierto se pone al día (2026-10-22)', () => {
  assert.deepEqual(tiposDeRuta('PUT', '/usuarios/3'), ['sesion']);
  assert.deepEqual(tiposDeRuta('PUT', '/permisos/roles/5'), ['sesion']);
  assert.deepEqual(tiposDeRuta('POST', '/usuarios/login'), []);
  // Poner «Mi clave para autorizar» no recarga el menú de todos.
  assert.deepEqual(tiposDeRuta('PUT', '/usuarios/perfil/clave-autorizacion'), []);
});

test('un prefijo parecido no se confunde, y una ruta desconocida no avisa', () => {
  assert.deepEqual(tiposDeRuta('POST', '/cajas-raras'), []);
  assert.deepEqual(tiposDeRuta('POST', '/algo'), []);
  assert.deepEqual(tiposDeRuta('POST', '/clientes/7/abonos'), ['clientes', 'caja', 'avisos']);
});
