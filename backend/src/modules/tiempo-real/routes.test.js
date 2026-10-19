'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { tiposPara } = require('./routes');
const { avisarAlTerminar, escuchar } = require('./bus');
const { anotarAlmacen, anotarCompartido } = require('./contexto');
const { DESCONOCIDO } = require('./almacenes');

const ev = (almacenes, compartidos = []) => ({ tipos: ['ventas', 'clientes', 'caja'], almacenes, compartidos });

test('CADA QUIEN, SUS TIENDAS: lo de su tienda completo; lo de otra, solo lo compartido', () => {
  assert.deepEqual(tiposPara(ev([2]), [2]), ['ventas', 'clientes', 'caja']);
  assert.deepEqual(tiposPara(ev([1, 3]), [3]), ['ventas', 'clientes', 'caja']); // un traspaso de 1 a 3
  assert.deepEqual(tiposPara(ev([1]), [2]), []);
  // Un abono en Principal (1) que liquidó una venta de Moroleón (2): la cuenta del cliente sí.
  assert.deepEqual(tiposPara(ev([1], ['clientes']), [2]), ['clientes']);
});

test('quien ve todas lo recibe todo; lo que no es de ninguna tienda, todos; lo desconocido, solo quien ve todas', () => {
  assert.deepEqual(tiposPara(ev([1]), null), ['ventas', 'clientes', 'caja']);
  assert.deepEqual(tiposPara(ev(null), [2]), ['ventas', 'clientes', 'caja']);
  assert.deepEqual(tiposPara(ev(DESCONOCIDO), [2]), []);
  assert.deepEqual(tiposPara(ev(DESCONOCIDO), null), ['ventas', 'clientes', 'caja']);
});

function peticion(metodo, ruta, status = 200) {
  const res = new EventEmitter();
  res.statusCode = status;
  const req = { method: metodo, originalUrl: '/api/v1' + ruta, body: {}, get: () => undefined };
  return { req, res };
}

const pausa = () => new Promise((r) => setTimeout(r, 5));

test('el aviso suma lo que la petición anotó por dentro (la tienda de rebote y lo compartido)', async () => {
  const avisos = [];
  const soltar = escuchar((e) => avisos.push(e));
  const { req, res } = peticion('POST', '/clientes/8/abonos');
  let termino;
  const listo = new Promise((r) => { termino = r; });
  avisarAlTerminar(req, res, async () => {
    await pausa();
    anotarAlmacen(5); // la venta que liquidó era de otra tienda
    anotarCompartido('clientes');
    termino();
  });
  await listo;
  res.emit('finish');
  await pausa();
  soltar();
  assert.equal(avisos.length, 1);
  assert.deepEqual(avisos[0].almacenes, [5]);
  assert.deepEqual(avisos[0].compartidos, ['clientes']);
});

test('lo que solo lee o sale con error no avisa', async () => {
  const avisos = [];
  const soltar = escuchar((e) => avisos.push(e));
  const lee = peticion('GET', '/pedidos');
  avisarAlTerminar(lee.req, lee.res, () => {});
  lee.res.emit('finish');
  const falla = peticion('POST', '/pedidos', 422);
  avisarAlTerminar(falla.req, falla.res, () => {});
  falla.res.emit('finish');
  await pausa();
  soltar();
  assert.equal(avisos.length, 0);
});
