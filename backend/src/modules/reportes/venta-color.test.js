'use strict';

// node --test src/modules/reportes/venta-color.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { armarVentaPorColor, pct, pctVendido } = require('./venta-color');

// Como llegan de MySQL: los DECIMAL en texto.
const fila = (o) => ({
  producto_id: 1, color: 'ROJO', calibre: '2/30', material: 'ACRILAN', linea: 'TURCA',
  kg_vendidos: '0.000', importe: '0.00', vendido_total: '0.000', existencia: '0.000',
  ultima_venta: null, ...o,
});

test('el % del periodo se mide contra TODO lo vendido, aunque la lista venga filtrada', () => {
  // Se buscó "rojo": la lista trae solo el rojo, pero en el periodo salieron 200 kg.
  const r = armarVentaPorColor(
    [fila({ kg_vendidos: '50.000', importe: '4500.00', vendido_total: '120.000', existencia: '80.000' })],
    { kg_vendidos: '200.000', importe: '18000.00' },
    { rango: { desde: '2026-09-01', hasta: '2026-09-30' }, q: 'rojo' }
  );
  assert.equal(r.hilos[0].pct_del_periodo, 25);
  assert.equal(r.totales.pct_del_periodo, 25);
  assert.equal(r.periodo.kg_vendidos, 200);
  assert.equal(r.q, 'rojo');
  // Lo vendido desde siempre contra eso más lo que queda: 120 / 200.
  assert.equal(r.hilos[0].pct_vendido, 60);
});

test('lo que vendió va primero; lo que no vendió pero hay, después, del que más hay', () => {
  const r = armarVentaPorColor(
    [
      fila({ producto_id: 3, color: 'AZUL', existencia: '10.000' }),
      fila({ producto_id: 2, color: 'NEGRO', kg_vendidos: '5.500', vendido_total: '5.500' }),
      fila({ producto_id: 4, color: 'BLANCO', existencia: '40.000' }),
      fila({ producto_id: 1, color: 'ROJO', kg_vendidos: '19.250', vendido_total: '30.000', existencia: '1.000' }),
    ],
    { kg_vendidos: '24.750', importe: '0' }
  );
  assert.deepEqual(r.hilos.map((h) => h.color), ['ROJO', 'NEGRO', 'BLANCO', 'AZUL']);
  // Sin venta en el periodo: 0%, no null (sí hubo ventas contra qué medir).
  assert.equal(r.hilos[2].pct_del_periodo, 0);
  // Nunca se ha vendido y hay existencias: 0% vendido.
  assert.equal(r.hilos[2].pct_vendido, 0);
  // Vendido todo lo que hubo: 100%.
  assert.equal(r.hilos[1].pct_vendido, 100);
  assert.equal(r.totales.num_hilos, 4);
  assert.equal(r.totales.num_con_venta, 2);
  assert.equal(r.totales.kg_vendidos, 24.75);
  assert.equal(r.totales.existencia, 51);
});

test('redondea: kilos a 3 decimales; dinero y porcentajes a 2', () => {
  const r = armarVentaPorColor(
    [fila({ kg_vendidos: '1.234', importe: '10.005', vendido_total: '1.234', existencia: '2.000' })],
    { kg_vendidos: '3.000', importe: '30' }
  );
  const h = r.hilos[0];
  assert.equal(h.kg_vendidos, 1.234);
  assert.equal(h.importe, 10.01);
  assert.equal(h.pct_del_periodo, 41.13); // 1.234 / 3
  assert.equal(h.pct_vendido, 38.16); // 1.234 / 3.234
});

test('sin nada contra qué medir el porcentaje es null, no 0 ni NaN', () => {
  assert.equal(pct(5, 0), null);
  assert.equal(pctVendido(0, 0), null);
  assert.equal(pctVendido(5, -1), 100); // una existencia negativa no suma
  const r = armarVentaPorColor([fila({ existencia: '12.000' })], { kg_vendidos: '0.000', importe: '0.00' });
  assert.equal(r.hilos[0].pct_del_periodo, null);
  assert.equal(r.totales.pct_del_periodo, null);
  assert.equal(r.q, null);
});
