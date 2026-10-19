'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { repartirAbonos, ajusteDeCancelacion } = require('./model');

// El ejemplo del usuario (2026-10-19): tres notas a crédito, la del 1 por
// $1,000, la del 5 por $800 y la del 10 por $500. Debe $2,300.
const CARGOS = [
  { tipo: 'cargo', monto: 1000, pedido_id: 1 },
  { tipo: 'cargo', monto: 800, pedido_id: 5 },
  { tipo: 'cargo', monto: 500, pedido_id: 10 },
];
const de = (reparto, id) => reparto.find((d) => d.pedidoId === id);

test('a la cuenta, como siempre: paga primero la más vieja', () => {
  const r = repartirAbonos([...CARGOS, { tipo: 'abono', monto: 500, pedido_id: null }]);
  assert.deepEqual([de(r, 1).porPagar, de(r, 5).porPagar, de(r, 10).porPagar], [500, 800, 500]);
});

test('a una nota: "te pago la del 10" la deja pagada y no toca las demás', () => {
  const r = repartirAbonos([...CARGOS, { tipo: 'abono', monto: 500, pedido_id: 10 }]);
  assert.deepEqual(de(r, 10), { pedidoId: 10, monto: 500, pagado: 500, porPagar: 0 });
  assert.equal(de(r, 1).porPagar, 1000);
  assert.equal(de(r, 5).porPagar, 800);
});

test('a notas y a la cuenta juntos: la cuenta cubre lo que la nota todavía debe, de lo más viejo', () => {
  const r = repartirAbonos([
    ...CARGOS,
    { tipo: 'abono', monto: 300, pedido_id: 5 },
    { tipo: 'abono', monto: 1200, pedido_id: null },
  ]);
  // La del 1 se lleva $1,000 de la cuenta; a la del 5 le quedan $200 de la cuenta + $300 propios.
  assert.equal(de(r, 1).porPagar, 0);
  assert.deepEqual([de(r, 5).pagado, de(r, 5).porPagar], [500, 300]);
  assert.equal(de(r, 10).porPagar, 500);
});

test('se cancela la nota que ya tenía su abono: ese dinero pasa a la cuenta, no se pierde', () => {
  const r = repartirAbonos([
    ...CARGOS,
    { tipo: 'abono', monto: 500, pedido_id: 10 },
    { tipo: 'ajuste', monto: -500, pedido_id: 10 }, // la cancelación quita su deuda
  ]);
  assert.deepEqual([de(r, 10).monto, de(r, 10).porPagar], [0, 0]);
  // Los $500 que había pagado a la del 10 pagan ahora la del 1.
  assert.deepEqual([de(r, 1).pagado, de(r, 1).porPagar], [500, 500]);
});

test('sin otra deuda, lo que pagó a la nota cancelada le queda a favor (nadie lo absorbe)', () => {
  const r = repartirAbonos([
    { tipo: 'cargo', monto: 500, pedido_id: 10 },
    { tipo: 'abono', monto: 300, pedido_id: 10 },
    { tipo: 'ajuste', monto: -500, pedido_id: 10 },
  ]);
  assert.deepEqual(de(r, 10), { pedidoId: 10, monto: 0, pagado: 0, porPagar: 0 });
});

test('cancelar quita la DEUDA de la nota (no lo que se le abonó), una sola vez', () => {
  const movs = [{ tipo: 'cargo', monto: 500 }, { tipo: 'abono', monto: 300 }];
  assert.equal(ajusteDeCancelacion(movs, true), -500);
  const cancelada = [...movs, { tipo: 'ajuste', monto: -500 }];
  assert.equal(ajusteDeCancelacion(cancelada, true), null); // cancelar dos veces no perdona dos veces
});

test('reactivar REGRESA la deuda (antes no regresaba nada), una sola vez', () => {
  const cancelada = [{ tipo: 'cargo', monto: 500 }, { tipo: 'ajuste', monto: -500 }];
  assert.equal(ajusteDeCancelacion(cancelada, false), 500);
  const reactivada = [...cancelada, { tipo: 'ajuste', monto: 500 }];
  assert.equal(ajusteDeCancelacion(reactivada, false), null);
  // Una venta vigente no se "reactiva": no hay nada que reponer.
  assert.equal(ajusteDeCancelacion([{ tipo: 'cargo', monto: 500 }], false), null);
});

test('una venta que no fue a crédito no se ajusta', () => {
  assert.equal(ajusteDeCancelacion([], true), null);
});
