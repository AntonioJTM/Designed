'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pistasDelCambio, juntarAlmacenes, DESCONOCIDO } = require('./almacenes');

const vacio = { almacenes: [], sesiones: [], pedido: null, caja: null, traspaso: null, remesa: null, bulto: null };

test('una venta en la caja: la tienda sale del turno', () => {
  assert.deepEqual(pistasDelCambio('/pedidos', { sesion_caja_id: 9, items: [] }), { ...vacio, sesiones: [9] });
});

test('lo que se hace sobre una venta, un turno, un traspaso o una carga: su id', () => {
  assert.equal(pistasDelCambio('/pedidos/12/estado', {}).pedido, 12);
  assert.deepEqual(pistasDelCambio('/caja/sesiones/4/cerrar', {}).sesiones, [4]);
  assert.equal(pistasDelCambio('/inventario/traspasos/7/enviar', {}).traspaso, 7);
  assert.equal(pistasDelCambio('/remesas/3', {}).remesa, 3);
  assert.equal(pistasDelCambio('/variantes/codigos/55', {}).bulto, 55);
  assert.equal(pistasDelCambio('/caja/sesiones', { caja_id: 2 }).caja, 2);
});

test('los almacenes del formulario, sin repetir', () => {
  assert.deepEqual(
    pistasDelCambio('/inventario/desarmes', { almacen_origen_id: 2, almacen_destino_id: 2 }).almacenes, [2]);
  assert.deepEqual(
    pistasDelCambio('/inventario/traspasos', { almacen_origen_id: 1, almacen_destino_id: 3 }).almacenes, [1, 3]);
});

test('lo que no es de ninguna tienda no trae pistas (catálogo, clientes)', () => {
  assert.deepEqual(pistasDelCambio('/productos/5', { precio_kg: 140 }), vacio);
  assert.deepEqual(pistasDelCambio('/clientes/8/abonos', { monto: 100 }), vacio);
  assert.deepEqual(pistasDelCambio('/remesas/lista/previa', Buffer.from('xlsx')), vacio);
});

test('una diagonal al final o un id codificado no se escapan del filtro', () => {
  assert.equal(pistasDelCambio('/caja/cajas/5/', {}).caja, 5);
  assert.equal(pistasDelCambio('/remesas/3/', {}).remesa, 3);
  assert.equal(pistasDelCambio('/variantes/codigos/55/', {}).bulto, 55);
});

test('las tiendas del aviso: antes, después y lo anotado; sin ninguna, a todos', () => {
  assert.deepEqual(juntarAlmacenes([1], [1], [3]), [1, 3]);
  assert.deepEqual(juntarAlmacenes([2], [4], []), [2, 4]); // una caja que cambió de tienda
  assert.equal(juntarAlmacenes(null, null, []), null);
  assert.equal(juntarAlmacenes(null, DESCONOCIDO, [1]), DESCONOCIDO);
  assert.equal(juntarAlmacenes(DESCONOCIDO, [1], []), DESCONOCIDO);
});
