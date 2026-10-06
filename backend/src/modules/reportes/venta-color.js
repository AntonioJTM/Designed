'use strict';

/**
 * "Venta por color": las cuentas del reporte, aparte del SQL para poder
 * probarlas sin base (venta-color.test.js).
 *
 * La pregunta de la tienda: "en cierto rango de tiempo cuántos kg se han
 * vendido de cierto color y qué porcentaje lo representa, y ver qué porcentaje
 * del color ya se vendió y cuánto queda en inventario".
 *
 *   · `pct_del_periodo`: los kilos del hilo contra TODO lo vendido en el rango
 *     (todos los hilos, aunque se haya buscado uno): buscar "rojo" tiene que
 *     decir qué parte de la venta fue el rojo, no "100%".
 *   · `pct_vendido`: lo vendido desde siempre contra eso MÁS lo que queda hoy.
 *     No es "de lo que entró": una merma o el destare del cono mueven el
 *     inventario sin ser venta. En null cuando no hay ni venta ni existencia.
 */

const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** a ÷ b en porcentaje con dos decimales, o null si no hay contra qué medir. */
function pct(a, b) {
  return Number(b) > 0 ? r2((100 * Number(a)) / Number(b)) : null;
}

/** Lo vendido contra lo vendido más lo que queda; null si las dos son cero. */
function pctVendido(vendido, existencia) {
  return pct(vendido, Number(vendido) + Math.max(0, Number(existencia)));
}

/**
 * Arma la respuesta a partir de los renglones crudos (uno por hilo, con los
 * DECIMAL como texto) y de lo vendido en el periodo por TODOS los hilos.
 */
function armarVentaPorColor(filas, periodo, { rango, q } = {}) {
  const kgPeriodo = r3(periodo?.kg_vendidos ?? 0);

  const hilos = filas.map((f) => {
    const kg = r3(f.kg_vendidos);
    const vendidoTotal = r3(f.vendido_total);
    const existencia = r3(f.existencia);
    return {
      producto_id: Number(f.producto_id),
      color: f.color,
      calibre: f.calibre ?? null,
      material: f.material ?? null,
      linea: f.linea ?? null,
      kg_vendidos: kg,
      importe: r2(f.importe),
      pct_del_periodo: pct(kg, kgPeriodo),
      vendido_total: vendidoTotal,
      existencia,
      pct_vendido: pctVendido(vendidoTotal, existencia),
      ultima_venta: f.ultima_venta ?? null,
    };
  });

  // Primero lo que se vendió en el rango (más kilos arriba); después lo que
  // no se vendió pero hay, del que más hay al que menos: 0% del periodo
  // también es una respuesta, y es la que dice qué no se está moviendo.
  hilos.sort((a, b) =>
    b.kg_vendidos - a.kg_vendidos ||
    b.existencia - a.existencia ||
    String(a.color).localeCompare(String(b.color), 'es') ||
    String(a.calibre ?? '').localeCompare(String(b.calibre ?? ''), 'es'));

  const suma = (campo) => hilos.reduce((s, h) => s + h[campo], 0);
  const kg = r3(suma('kg_vendidos'));
  const vendidoTotal = r3(suma('vendido_total'));
  const existencia = r3(suma('existencia'));

  return {
    rango: rango ?? null,
    q: q || null,
    // TODOS los hilos del periodo, sin el filtro: contra esto se mide el %.
    periodo: { kg_vendidos: kgPeriodo, importe: r2(periodo?.importe ?? 0) },
    // Los hilos de la lista (con el filtro, si lo hay).
    totales: {
      kg_vendidos: kg,
      importe: r2(suma('importe')),
      pct_del_periodo: pct(kg, kgPeriodo),
      vendido_total: vendidoTotal,
      existencia,
      pct_vendido: pctVendido(vendidoTotal, existencia),
      num_hilos: hilos.length,
      num_con_venta: hilos.filter((h) => h.kg_vendidos > 0).length,
    },
    hilos,
  };
}

module.exports = { armarVentaPorColor, pct, pctVendido };
