'use strict';

// Las cuentas de la rotación con los ejemplos de INSTRUCCIONES.md (sección 9) y
// los meses del diseño (MARINO, ROJO, HUESO y OPTIK de 2025).
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./cuentas');

test('rotación: 6,799 ÷ 2,615 = 2.6 veces al año, se renueva cada 140 días, rápido', () => {
  const r = c.rotacion(6799, 2615, 365);
  assert.equal(r.veces, 2.6);
  assert.equal(r.cada_dias, 140);
  assert.equal(r.se_mueve, 'rapido');
  assert.equal(c.seMueve(1.8), 'normal');
  assert.equal(c.seMueve(0.4), 'lento');
  // Con menos de un año se anualiza: 9 semanas (63 días) con 1,000 kg y 2,000 en promedio.
  assert.equal(c.rotacion(1000, 2000, 63).veces, 2.9);
  assert.equal(c.rotacion(1000, 0, 365), null);
});

test('qué tan fuerte es un mes: 851 ÷ (6,205 ÷ 12 = 517) = 1.65, y sus cinco tramos', () => {
  assert.equal(c.indice(851, 6205), 1.65);
  assert.deepEqual([0.5, 0.75, 1, 1.2, 1.65].map(c.tramoCalor), [1, 2, 3, 4, 5]);
  assert.equal(c.tramoCalor(0.7), 2);
  assert.equal(c.tramoCalor(1.4), 5);
});

const indices = (meses) => {
  const total = meses.reduce((s, x) => s + x, 0);
  return meses.map((m) => c.indice(m, total));
};

test('su temporada: los meses seguidos con 1.3 o más (los del diseño)', () => {
  const marino = c.temporadaDe(indices([395, 326, 319, 307, 376, 422, 574, 734, 851, 827, 626, 448]));
  assert.deepEqual(marino.meses, [7, 8, 9]);
  assert.equal(c.textoTemporada(marino), 'Agosto a octubre');
  assert.equal(c.textoTemporada(c.temporadaDe(indices([270, 300, 273, 262, 322, 297, 357, 433, 591, 707, 771, 721]))), 'Septiembre a diciembre');
  assert.equal(c.textoTemporada(c.temporadaDe(indices([260, 302, 409, 421, 413, 354, 315, 250, 204, 170, 137, 173]))), 'Marzo a mayo');
  assert.equal(c.temporadaDe(indices([162, 154, 179, 188, 198, 167, 160, 155, 147, 142, 123, 129])), null);
  assert.equal(c.textoTemporada(null), 'Parejo todo el año');
});

test('la temporada que cruza el año: noviembre, diciembre y enero', () => {
  const t = c.temporadaDe(indices([700, 300, 300, 300, 300, 300, 300, 300, 300, 300, 700, 800]));
  assert.deepEqual(t.meses, [10, 11, 0]);
  assert.equal(c.textoTemporada(t), 'Noviembre a enero');
});

test('tendencia: 4,824 ÷ 4,304 = 1.12; con menos de 3 meses, 1; entre 0.5 y 2', () => {
  assert.equal(c.tendencia(4824, 4304, 9), 1.12);
  assert.equal(c.tendencia(4824, 4304, 2), 1);
  assert.equal(c.tendencia(100, 1000, 6), 0.5);
  assert.equal(c.tendencia(5000, 1000, 6), 2);
  assert.equal(c.tendencia(100, 0, 6), 1);
});

test('pronóstico de un mes: 626 × 1.12 = 701 kg', () => {
  assert.equal(c.pronosticoMes(626, 1.12), 701);
  // Y el modelo lo reparte entre los días de noviembre (30).
  const base = Array(12).fill(300);
  base[10] = 626;
  const m = c.modeloDeVenta({ base, tendencia: 1.12 });
  assert.equal(m.tipo, 'temporada');
  assert.equal(Math.round(c.sumaPronostico(m, '2026-11-01', '2026-12-01')), 701);
});

test('pedir a más tardar: 14 de enero de 2027 − 91 días = 15 de octubre de 2026', () => {
  assert.equal(c.pedirAMasTardar('2027-01-14', 10, 3), '2026-10-15');
  assert.equal(c.fechaLarga('2026-10-15', '2026-10-21'), '15 de octubre');
  assert.equal(c.fechaLarga('2027-07-11', '2026-10-21'), '11 de julio de 2027');
  assert.equal(c.fechaLarga('2027-01-14', '2026-10-21'), '14 de enero');
});

test('cuánto alcanza, cuándo se acaba y cuánto pedir (10 kg al día)', () => {
  const m = c.modeloDeVenta({ promedioDiario: 10 });
  assert.equal(c.seVendeAhora(m, '2026-10-21'), 70);
  assert.equal(c.alcanzaSemanas(1000, 70).toFixed(2), '14.29');
  assert.equal(c.seAcabaEl(1000, m, '2026-10-21'), '2027-01-28');
  // Se pide hoy (la fecha ya pasó): llega en 10 semanas (30 de diciembre) con 300 kg;
  // de ahí a 4 meses y 3 semanas (21 de mayo) se venden 1,420 kg: 1,420 − 300 = 1,120 kg.
  const p = c.cuantoPedir({
    existencia: 1000, modelo: m, hoy: '2026-10-21', pedir: '2026-10-15',
    semanasProveedor: 10, semanasColchon: 3, mesesCubre: 4, pesoPaquete: 16.4,
  });
  assert.equal(p.llega, '2026-12-30');
  assert.equal(p.quedan_al_llegar, 300);
  assert.equal(p.kg, 1120);
  assert.equal(p.paquetes, 68);
  // El ejemplo del diseño: 1,800 − 221 ≈ 1,580 kg, unos 96 paquetes de 16.4 kg.
  assert.equal(c.a10(1800 - 221), 1580);
  assert.equal(Math.round(1580 / 16.4), 96);
});

test('los cuatro estados de «Qué pedir»', () => {
  const hoy = '2026-10-21';
  assert.equal(c.estadoPedido({ pedir: '2026-10-15', hoy, semanas: 9.5, existencia: 1720 }), 'ya');
  assert.equal(c.estadoPedido({ pedir: '2026-10-28', hoy, semanas: 10.6, existencia: 1300 }), 'ya');
  assert.equal(c.estadoPedido({ pedir: '2026-12-26', hoy, semanas: 37, existencia: 1250 }), 'pronto');
  assert.equal(c.estadoPedido({ pedir: '2027-04-11', hoy, semanas: 23, existencia: 2400 }), 'calma');
  assert.equal(c.estadoPedido({ pedir: '2030-02-01', hoy, semanas: 204, existencia: 5100 }), 'sobra');
  assert.equal(c.estadoPedido({ pedir: null, hoy, semanas: null, existencia: 0 }), 'sin_ventas');
  assert.equal(c.estadoPedido({ pedir: null, hoy, semanas: null, existencia: 10, conModelo: false }), 'sin_datos');
});

test('los cuatro niveles de historia', () => {
  assert.equal(c.nivelHistoria(8, 0), 'poca');
  assert.equal(c.nivelHistoria(63, 1), 'sin_temporada');
  assert.equal(c.nivelHistoria(400, 12), 'completa');
  assert.equal(c.nivelHistoria(800, 24), 'confiable');
});

test('calendario de compras: MARINO (agosto) se pide a principios de mayo', () => {
  const k = c.calendarioDeCompra(7, '2026-10-21', 10);
  assert.equal(k.inicio, '2027-08-01');
  assert.equal(k.pedir, '2027-05-02');
  assert.equal(k.mes_llega, 7);
  assert.equal(k.texto, 'Principios de mayo, para agosto');
});

test('kilos y toneladas: 31,298 kg = 31.3 t; 5,240 = 5.24 t; menos de mil, en kg', () => {
  assert.equal(c.kgOToneladas(31298), '31.3 t');
  assert.equal(c.kgOToneladas(5240), '5.24 t');
  assert.equal(c.kgOToneladas(1970), '1.97 t');
  assert.equal(c.kgOToneladas(744), '744 kg');
});

test('temporada alta y baja de todo junto: los 3 meses seguidos más fuertes y más flojos', () => {
  const total = [1970, 1880, 2050, 2040, 2280, 2240, 2630, 3020, 3400, 3380, 2830, 2370];
  const idx = indices(total);
  assert.deepEqual(c.rachaDe(idx, 3, true).meses, [7, 8, 9]);
  assert.deepEqual(c.rachaDe(idx, 3, false).meses, [0, 1, 2]);
});
