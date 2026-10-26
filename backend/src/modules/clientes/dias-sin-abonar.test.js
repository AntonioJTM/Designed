'use strict';

// La cuenta atrasada se mide por su NOTA MÁS VIEJA sin pagar (2026-10-20; el
// usuario eligió "por la nota más vieja"). Antes cualquier abono reiniciaba el reloj.
const test = require('node:test');
const assert = require('node:assert/strict');
const { deudaMasVieja, diasDeLaMasVieja } = require('./model');

const m = (tipo, monto, dia, pedido_id = null) => ({ tipo, monto, dia, pedido_id });

test('nunca ha abonado: desde su nota más vieja', () => {
  assert.equal(deudaMasVieja([m('cargo', 1000, '2026-09-01', 1), m('cargo', 500, '2026-10-10', 2)]).dia, '2026-09-01');
});

test('un abono chiquito NO reinicia el reloj: la nota vieja sigue debiéndose', () => {
  const d = deudaMasVieja([m('cargo', 1000, '2026-09-01', 1), m('abono', 200, '2026-10-01'), m('cargo', 300, '2026-10-12', 2)]);
  assert.equal(d.dia, '2026-09-01');
  assert.equal(d.porPagar, 800);
});

test('si los abonos cubren la nota vieja, cuenta desde la siguiente', () => {
  const d = deudaMasVieja([m('cargo', 1000, '2026-09-01', 1), m('abono', 1200, '2026-10-01'), m('cargo', 300, '2026-10-12', 2)]);
  assert.equal(d.dia, '2026-10-12');
  assert.equal(d.porPagar, 100);
});

test('el abono A UNA NOTA paga esa nota, no la más vieja', () => {
  const d = deudaMasVieja([m('cargo', 1000, '2026-09-01', 1), m('cargo', 300, '2026-10-12', 2), m('abono', 300, '2026-10-15', 2)]);
  assert.equal(d.dia, '2026-09-01');
  assert.equal(d.porPagar, 1000);
});

test('lo pagó todo y se le fió otra vez: desde el nuevo cargo', () => {
  assert.equal(deudaMasVieja([m('cargo', 1000, '2026-01-10', 1), m('abono', 1000, '2026-01-20'), m('cargo', 400, '2026-10-14', 2)]).dia, '2026-10-14');
});

test('no debe: null (también con un ajuste que lo deja en cero)', () => {
  assert.equal(deudaMasVieja([]), null);
  assert.equal(deudaMasVieja([m('cargo', 500, '2026-09-01', 1), m('ajuste', -500, '2026-09-05')]), null);
});

test('los días cuentan desde la nota más vieja hasta hoy', () => {
  const a = diasDeLaMasVieja([m('cargo', 1000, '2026-09-01', 1), m('abono', 200, '2026-10-01')], '2026-10-20');
  assert.deepEqual(a, { dias: 49, porPagar: 800 });
});

// DÍAS DE CRÉDITO DE CADA NOTA (2026-10-20): la nota vence el día en que se fió
// más sus días; sin decirlos, 15 (lo de antes da igual).
const { vencimientoDe } = require('./model');
const c = (monto, dia, pedido_id, dias_credito) => ({ tipo: 'cargo', monto, dia, pedido_id, dias_credito });

test('a 30 días: el 20 de octubre una nota del 1 todavía no vence (vence el 31)', () => {
  const v = vencimientoDe([c(1000, '2026-10-01', 1, 30)], '2026-10-20', 15);
  assert.equal(v.vencida, null);
  assert.equal(v.proxima.venceEl, '2026-10-31');
  assert.equal(v.proxima.diasVencida, -11);
});

test('sin decir sus días: 15, como antes (del 1 de octubre vence el 16; al 20, hace 4 días)', () => {
  const v = vencimientoDe([c(1000, '2026-10-01', 1, null)], '2026-10-20', 15);
  assert.equal(v.vencida.venceEl, '2026-10-16');
  assert.equal(v.vencida.diasVencida, 4);
  assert.equal(v.vencida.plazo, 15);
});

test('la más vieja a 60 días no ha vencido, pero una más nueva a 8 sí: está atrasado por la nueva', () => {
  const v = vencimientoDe([c(1000, '2026-09-01', 1, 60), c(300, '2026-10-05', 2, 8)], '2026-10-20', 15);
  assert.equal(v.vencida.pedidoId, 2);
  assert.equal(v.vencida.diasVencida, 7);
  assert.equal(v.vencidas.length, 1);
  assert.equal(v.dias, 49); // los de su nota más vieja, como antes
});

test('el día que vence todavía no está vencida; al día siguiente, sí', () => {
  assert.equal(vencimientoDe([c(100, '2026-10-01', 1, 10)], '2026-10-11', 15).vencida, null);
  assert.equal(vencimientoDe([c(100, '2026-10-01', 1, 10)], '2026-10-12', 15).vencida.diasVencida, 1);
});

test('la nota que ya se pagó no vence; no debe: null', () => {
  const v = vencimientoDe([c(500, '2026-08-01', 1, 8), { tipo: 'abono', monto: 500, dia: '2026-08-05', pedido_id: 1 }, c(200, '2026-10-15', 2, 15)], '2026-10-20', 15);
  assert.equal(v.vencida, null);
  assert.equal(v.proxima.pedidoId, 2);
  assert.equal(vencimientoDe([], '2026-10-20', 15), null);
});

// CRÉDITO POR COBRAR ESTE MES (2026-10-22): lo vencido + lo que vence hasta el
// último día del mes. El ejemplo con que lo eligió el usuario, al 22 de octubre.
test('por cobrar este mes: las vencidas y las que vencen hasta el 31, no las de noviembre', () => {
  const { porCobrarHasta, finDeMes } = require('./model');
  const v = vencimientoDe([
    c(500, '2026-09-05', 1, 15),   // A: venció el 20 de septiembre
    c(2000, '2026-09-30', 2, 15),  // B: venció el 15 de octubre
    c(3000, '2026-10-14', 3, 15),  // C: vence el 29 de octubre
    c(1000, '2026-10-21', 4, 15),  // D: vence el 5 de noviembre
  ], '2026-10-22', 15);
  assert.equal(finDeMes('2026-10-22'), '2026-10-31');
  assert.equal(porCobrarHasta(v, finDeMes('2026-10-22')), 5500);
  // Con un abono de $700 (paga A y $200 de B) quedan $4,800.
  const v2 = vencimientoDe([
    c(500, '2026-09-05', 1, 15), c(2000, '2026-09-30', 2, 15), c(3000, '2026-10-14', 3, 15), c(1000, '2026-10-21', 4, 15),
    { tipo: 'abono', monto: 700, dia: '2026-10-20', pedido_id: null },
  ], '2026-10-22', 15);
  assert.equal(porCobrarHasta(v2, '2026-10-31'), 4800);
  assert.equal(porCobrarHasta(null, '2026-10-31'), 0);
  assert.equal(finDeMes('2026-02-10'), '2026-02-28');
  assert.equal(finDeMes('2028-02-10'), '2028-02-29');
  assert.equal(finDeMes('2026-12-31'), '2026-12-31');
});
