'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rastrearPagos, repartirAbonos } = require('./model');

// DE DÓNDE SALIÓ LO PAGADO (2026-10-26): al cancelar una nota a crédito solo el
// DINERO se puede regresar; lo pagado con su saldo a favor regresa a su saldo y
// lo condonado («Corregir deuda») se va con la venta.
const ef = (monto, pedido_id = null) => ({ tipo: 'abono', monto, pedido_id, metodo: 'Efectivo', interno: 0 });
const tr = (monto, pedido_id = null) => ({ tipo: 'abono', monto, pedido_id, metodo: 'Transferencia', interno: 0 });
const sf = (monto, pedido_id = null) => ({ tipo: 'abono', monto, pedido_id, metodo: 'Saldo a favor', interno: 1 });
const condona = (monto) => ({ tipo: 'ajuste', monto: -monto, pedido_id: null });
const cargo = (monto, pedido_id) => ({ tipo: 'cargo', monto, pedido_id });
const cancela = (monto, pedido_id) => ({ tipo: 'ajuste', monto: -monto, pedido_id });

test('reparte igual que repartirAbonos (lo pagado y lo que falta de cada nota)', () => {
  const movs = [cargo(1000, 1), cargo(800, 5), ef(300, 5), tr(1200), condona(100), cargo(500, 10), sf(200)];
  const viejo = repartirAbonos(movs);
  const nuevo = rastrearPagos(movs).deudas;
  assert.deepEqual(
    nuevo.map(({ pedidoId, monto, pagado, porPagar }) => ({ pedidoId, monto, pagado, porPagar })),
    viejo.map(({ pedidoId, monto, pagado, porPagar }) => ({ pedidoId, monto, pagado, porPagar })),
  );
});

test('el ejemplo: $1,000 a crédito, abona $700 en efectivo y se le condonan $300; al cancelar solo se liberan los $700', () => {
  const r = rastrearPagos([cargo(1000, 1), ef(700), condona(300), cancela(1000, 1)]);
  assert.deepEqual(r.sobrante, { efectivo: 700, transferencia: 0, saldo: 0, ajuste: 300, total: 1000 });
});

test('el caso de C-0007 (POS-7B03): de $345 solo $45 entraron por transferencia; $300 son un ajuste', () => {
  const movs = [cargo(155, 61), cargo(345, 73), tr(155, 61), tr(45, 73), condona(300)];
  const antes = rastrearPagos(movs).deudas.find((d) => d.pedidoId === 73);
  assert.deepEqual(antes.porOrigen, { efectivo: 0, transferencia: 45, saldo: 0, ajuste: 300 });
  const r = rastrearPagos([...movs, cancela(345, 73)]);
  assert.deepEqual(r.sobrante, { efectivo: 0, transferencia: 45, saldo: 0, ajuste: 300, total: 345 });
});

test('lo pagado con su saldo a favor sale como saldo, no como dinero', () => {
  const r = rastrearPagos([cargo(500, 2), sf(500), cancela(500, 2)]);
  assert.deepEqual(r.sobrante, { efectivo: 0, transferencia: 0, saldo: 500, ajuste: 0, total: 500 });
});

test('lo que sobra es lo ÚLTIMO que pagó: si debe otras notas, lo viejo las paga', () => {
  // Nota A $300 (vieja) y B $1,000. Pagó $1,000 en efectivo y después se le condonaron $300.
  const r = rastrearPagos([cargo(300, 1), cargo(1000, 2), ef(1000), condona(300), cancela(1000, 2)]);
  // A se queda pagada con los primeros $300 del efectivo; sobran $700 de efectivo y los $300 condonados.
  assert.deepEqual(r.sobrante, { efectivo: 700, transferencia: 0, saldo: 0, ajuste: 300, total: 1000 });
  assert.equal(r.deudas.find((d) => d.pedidoId === 1).porPagar, 0);
});

test('lo abonado a una nota cancelada pasa al fondo y paga la que sigue debiendo', () => {
  const r = rastrearPagos([cargo(400, 1), cargo(600, 2), ef(400, 1), cancela(400, 1)]);
  assert.equal(r.deudas.find((d) => d.pedidoId === 2).pagado, 400);
  assert.equal(r.sobrante.total, 0);
});

test('sin pagos no sobra nada', () => {
  assert.deepEqual(rastrearPagos([cargo(100, 1)]).sobrante, { efectivo: 0, transferencia: 0, saldo: 0, ajuste: 0, total: 0 });
});
