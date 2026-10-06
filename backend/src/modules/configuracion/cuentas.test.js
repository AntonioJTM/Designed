'use strict';

// node --test src/modules/configuracion/cuentas.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./cuentas');

test('el dígito de control de la CLABE', () => {
  // El ejemplo clásico de CLABE: 032 180 00011835971 9.
  assert.equal(c.digitoControlClabe('03218000011835971'), 9);
  assert.ok(c.clabeValida('032180000118359719'));
  assert.ok(!c.clabeValida('032180000118359718')); // un dígito mal
  assert.ok(!c.clabeValida('03218000011835971')); // le falta uno
  assert.ok(c.clabeValida('000000000000000000'));
});

test('limpia espacios y guiones de lo tecleado', () => {
  const r = c.normalizar({ banco: ' BBVA ', clabe: '032 180 00011835971 9', numero_cuenta: '0123-4567-89' });
  assert.equal(r.banco, 'BBVA');
  assert.equal(r.clabe, '032180000118359719');
  assert.equal(r.numero_cuenta, '0123456789');
  assert.equal(r.titular, null);
  assert.equal(r.activa, true);
});

test('pide el banco y al menos un dato para depositar', () => {
  assert.throws(() => c.normalizar({ banco: '', clabe: '032180000118359719' }), { code: 'FALTA_BANCO' });
  assert.throws(() => c.normalizar({ banco: 'BBVA' }), { code: 'FALTA_CUENTA' });
  assert.ok(c.normalizar({ banco: 'BBVA', numero_cuenta: '0123456789' }));
});

test('rechaza lo que no se puede usar', () => {
  assert.throws(() => c.normalizar({ banco: 'BBVA', clabe: '12345' }), { code: 'CLABE_INVALIDA' });
  assert.throws(() => c.normalizar({ banco: 'BBVA', clabe: '032180000118359718' }), /no cuadra/);
  assert.throws(() => c.normalizar({ banco: 'BBVA', numero_cuenta: '12AB' }), { code: 'NUMERO_CUENTA_INVALIDO' });
});
