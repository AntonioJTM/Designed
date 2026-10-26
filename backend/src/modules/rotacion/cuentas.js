'use strict';

// ROTACIÓN DE INVENTARIO (2026-10-22): las CUENTAS, sin base de datos. Todo en
// KILOS: aquí no entra dinero. Las fechas van como 'YYYY-MM-DD' y se cuentan en
// días enteros (UTC, sin horas), así no se mueven con la zona horaria. Las
// reglas y los ejemplos son los de Documentos/rotacion-inventario/INSTRUCCIONES.md.

const MS_DIA = 86400000;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

const r1 = (n) => Math.round((Number(n) + Number.EPSILON) * 10) / 10;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// --------------------------------------------------------------- fechas

function aNum(dia) {
  const [a, m, d] = String(dia).slice(0, 10).split('-').map(Number);
  return Date.UTC(a, m - 1, d) / MS_DIA;
}
function aDia(n) {
  return new Date(n * MS_DIA).toISOString().slice(0, 10);
}
function sumarDias(dia, n) {
  return aDia(aNum(dia) + n);
}
/** Días de `a` a `b` (b − a). */
function diasEntre(a, b) {
  return aNum(b) - aNum(a);
}
/** Días del mes (1–12). */
function diasDelMes(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}
/** El mismo día `n` meses después (el 31 en un mes de 30 cae en el 30). */
function sumarMeses(dia, n) {
  const [a, m, d] = dia.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1 + n, 1));
  const y = t.getUTCFullYear();
  const mm = t.getUTCMonth() + 1;
  return `${y}-${String(mm).padStart(2, '0')}-${String(Math.min(d, diasDelMes(y, mm))).padStart(2, '0')}`;
}
/** 'YYYY-MM' de un año y un mes (1–12). */
function claveMes(anio, mes) {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}
/** [año, mes 1–12] de un día. */
function anioMes(dia) {
  const [a, m] = dia.split('-').map(Number);
  return [a, m];
}
function nombreMes(mes) {
  return MESES[mes - 1];
}

/**
 * "14 de enero" (o "11 de julio de 2027"): el año solo cuando cae en otro año y a
 * más de seis meses de hoy (lo cercano se entiende sin año, como en el diseño).
 */
function fechaLarga(dia, hoy) {
  if (!dia) return null;
  const [a, m, d] = dia.split('-').map(Number);
  const [ah] = anioMes(hoy);
  const lejos = Math.abs(diasEntre(hoy, dia)) > 183;
  return `${d} de ${MESES[m - 1]}${a !== ah && lejos ? ` de ${a}` : ''}`;
}

/** "Principios", "Mediados" o "Fines" del mes: días 1–10, 11–20 y 21 en adelante. */
function parteDelMes(dia) {
  const d = Number(dia.slice(8, 10));
  return d <= 10 ? 'Principios' : d <= 20 ? 'Mediados' : 'Fines';
}

// --------------------------------------------------------------- historia

/**
 * Cuánta historia hay (sección 5 de las instrucciones):
 *   · poca: menos de 28 días de ventas;
 *   · sin_temporada: menos de 12 meses completos;
 *   · completa: de 12 a menos de 24 meses completos;
 *   · confiable: 24 o más.
 * `mesesCompletos`: los meses enteros con ventas conocidas antes del mes en curso.
 */
function nivelHistoria(dias, mesesCompletos) {
  if (!(dias >= 28)) return 'poca';
  if (mesesCompletos < 12) return 'sin_temporada';
  if (mesesCompletos < 24) return 'completa';
  return 'confiable';
}

// --------------------------------------------------------------- rotación

/** «Se mueve»: 2 o más = rápido; de 1 a 2 = normal; menos de 1 = lento. */
function seMueve(veces) {
  if (veces == null) return null;
  return veces >= 2 ? 'rapido' : veces >= 1 ? 'normal' : 'lento';
}

/**
 * Rotación (veces al año) = kilos vendidos ÷ existencia promedio diaria. Con
 * menos de 365 días se anualiza con los que haya. Ej.: 6,799 ÷ 2,615 = 2.6
 * veces; «se renueva cada» 365 ÷ 2.6 = 140 días. Sin existencia promedio: null.
 */
function rotacion(kg, existenciaPromedio, dias = 365) {
  if (!(existenciaPromedio > 0) || !(dias > 0)) return null;
  const anual = dias < 365 ? (kg * 365) / dias : kg;
  const veces = r1(anual / existenciaPromedio);
  return { veces, cada_dias: veces > 0 ? Math.round(365 / veces) : null, se_mueve: seMueve(veces) };
}

// --------------------------------------------------------------- temporada

/** Qué tan fuerte es un mes = kilos del mes ÷ (kilos del año ÷ meses). Ej.: 851 ÷ 517 = 1.65. */
function indice(kgMes, kgAnio, meses = 12) {
  if (kgMes == null || !(kgAnio > 0) || !(meses > 0)) return null;
  return r2(kgMes / (kgAnio / meses));
}

/** Los cinco tramos del mapa de calor (1 = 30% menos o más abajo … 5 = 40% más o arriba). */
function tramoCalor(i) {
  if (i == null) return null;
  if (i < 0.7) return 1;
  if (i < 0.9) return 2;
  if (i < 1.1) return 3;
  if (i < 1.4) return 4;
  return 5;
}

/**
 * Su TEMPORADA: los meses SEGUIDOS con índice de 1.3 o más (puede cruzar de
 * diciembre a enero). Si hay varias rachas, la más fuerte. `indices`: 12 valores
 * (enero = 0; null = sin dato). Devuelve { meses: [0–11…], inicio, fin } o null
 * ("Parejo todo el año").
 */
function temporadaDe(indices, umbral = 1.3) {
  const altos = indices.map((i) => i != null && i >= umbral);
  if (!altos.some(Boolean) || altos.every(Boolean)) return null;
  const corte = altos.findIndex((a) => !a);
  const rachas = [];
  let actual = null;
  for (let k = 1; k <= 12; k++) {
    const m = (corte + k) % 12;
    if (altos[m]) (actual ??= []).push(m);
    else if (actual) {
      rachas.push(actual);
      actual = null;
    }
  }
  if (actual) rachas.push(actual);
  const fuerza = (r) => r.reduce((s, m) => s + indices[m], 0);
  const mejor = rachas.reduce((a, b) => (fuerza(b) > fuerza(a) ? b : a));
  return { meses: mejor, inicio: mejor[0], fin: mejor[mejor.length - 1] };
}

/** "Agosto a octubre", "Septiembre" o "Parejo todo el año". */
function textoTemporada(t) {
  if (!t) return 'Parejo todo el año';
  return t.meses.length > 1 ? `${cap(MESES[t.inicio])} a ${MESES[t.fin]}` : cap(MESES[t.inicio]);
}

/**
 * Los N meses SEGUIDOS (vuelta de año incluida) con el índice promedio más
 * alto o más bajo: la temporada alta y la baja de todo junto.
 */
function rachaDe(indices, n = 3, alta = true) {
  let mejor = null;
  for (let i = 0; i < 12; i++) {
    const meses = Array.from({ length: n }, (_, k) => (i + k) % 12);
    if (meses.some((m) => indices[m] == null)) continue;
    const prom = meses.reduce((s, m) => s + indices[m], 0) / n;
    if (!mejor || (alta ? prom > mejor.promedio : prom < mejor.promedio)) mejor = { meses, inicio: meses[0], fin: meses[n - 1], promedio: prom };
  }
  return mejor;
}

// --------------------------------------------------------------- pronóstico

/**
 * TENDENCIA = kilos del año en curso ÷ los del año anterior, de enero al último
 * mes completo, redondeada a 2 decimales (la misma cifra que se enseña). Con
 * menos de 3 meses comparables vale 1; nunca baja de 0.5 ni pasa de 2.
 * Ej.: 4,824 ÷ 4,304 = 1.12.
 */
function tendencia(actual, anterior, meses) {
  if (!(meses >= 3) || !(anterior > 0)) return 1;
  return Math.min(2, Math.max(0.5, r2(actual / anterior)));
}

/** Pronóstico de un mes = lo del mismo mes del año anterior × tendencia. Ej.: 626 × 1.12 = 701. */
function pronosticoMes(kgMismoMesAnterior, t) {
  return kgMismoMesAnterior == null ? null : Math.round(kgMismoMesAnterior * t);
}

/**
 * El MODELO de venta de un hilo: cuánto se espera vender cada día.
 *   · `base` (12 valores, kg del mismo mes del año pasado) y `tendencia`: el
 *     pronóstico del mes repartido entre sus días (con temporada);
 *   · si no, `promedioDiario` (las últimas semanas, sin temporada);
 *   · sin nada, null (poca historia).
 */
function modeloDeVenta({ base = null, tendencia: t = 1, promedioDiario = null }) {
  if (base && base.every((x) => x != null)) {
    const porMes = base.map((kg) => kg * t);
    return {
      tipo: 'temporada',
      porDia: (dia) => {
        const [a, m] = anioMes(dia);
        return porMes[m - 1] / diasDelMes(a, m);
      },
    };
  }
  if (promedioDiario != null) return { tipo: 'promedio', porDia: () => promedioDiario };
  return null;
}

/** Lo que se espera vender de `desde` a `hasta` (sin incluirlo). */
function sumaPronostico(modelo, desde, hasta) {
  if (!modelo) return 0;
  let s = 0;
  for (let n = aNum(desde), fin = aNum(hasta); n < fin; n++) s += modelo.porDia(aDia(n));
  return s;
}

/** «Se vende ahora» (kg por semana) = el pronóstico de los próximos 28 días ÷ 4. */
function seVendeAhora(modelo, hoy) {
  return modelo ? sumaPronostico(modelo, hoy, sumarDias(hoy, 28)) / 4 : null;
}

/** «Alcanza para» (semanas) = existencia ÷ lo que se vende por semana. Sin venta: null. */
function alcanzaSemanas(existencia, porSemana) {
  return porSemana > 0 ? existencia / porSemana : null;
}

/**
 * «Le alcanza hasta»: se descuenta el pronóstico día por día desde hoy hasta que
 * la existencia llega a 0. Cuenta la temporada. null = no se acaba en `max` días.
 */
function seAcabaEl(existencia, modelo, hoy, max = 365 * 5) {
  if (!modelo) return null;
  let queda = existencia;
  if (queda <= 0) return hoy;
  for (let i = 0; i < max; i++) {
    const dia = sumarDias(hoy, i);
    queda -= modelo.porDia(dia);
    if (queda <= 0) return dia;
  }
  return null;
}

/** «Pedir a más tardar» = le alcanza hasta − (semanas del proveedor + colchón) × 7. */
function pedirAMasTardar(seAcaba, semanasProveedor, semanasColchon) {
  return seAcaba ? sumarDias(seAcaba, -(semanasProveedor + semanasColchon) * 7) : null;
}

/** Redondeo a 10 kg. */
const a10 = (kg) => Math.round(kg / 10) * 10;

/**
 * «Cuánto pedir» = lo que se espera vender desde que llegaría (la fecha de pedir,
 * o hoy si ya pasó, más las semanas del proveedor) hasta `mesesCubre` meses
 * después más el colchón, menos lo que quede al llegar (nunca menos de 0). En
 * kilos redondeados a 10; los paquetes, con el peso promedio del paquete.
 * Ej.: se esperan unos 1,800 kg y quedan 221 al llegar → 1,580 kg ≈ 96 paquetes de 16.4 kg.
 */
function cuantoPedir({ existencia, modelo, hoy, pedir, semanasProveedor, semanasColchon, mesesCubre, pesoPaquete }) {
  if (!modelo) return null;
  const desde = pedir && pedir > hoy ? pedir : hoy;
  const llega = sumarDias(desde, semanasProveedor * 7);
  const quedan = Math.max(0, existencia - sumaPronostico(modelo, hoy, llega));
  const hasta = sumarDias(sumarMeses(llega, mesesCubre), semanasColchon * 7);
  const seVendera = sumaPronostico(modelo, llega, hasta);
  const kg = Math.max(0, a10(seVendera - quedan));
  return {
    kg,
    paquetes: pesoPaquete > 0 ? Math.round(kg / pesoPaquete) : null,
    llega,
    quedan_al_llegar: Math.round(quedan),
    se_vendera: Math.round(seVendera),
  };
}

/**
 * El ESTADO de cada hilo en «Qué pedir»:
 *   · sobra: alcanza para más de 52 semanas (o no se vende y hay);
 *   · ya: la fecha para pedir ya pasó o cae en los próximos 7 días;
 *   · pronto («En <mes>»): cae en los próximos 90 días;
 *   · calma: más adelante.
 * Sin ventas ni existencia: 'sin_ventas'; sin historia para calcular: 'sin_datos'.
 */
function estadoPedido({ pedir, hoy, semanas, existencia, conModelo = true }) {
  if (!conModelo) return 'sin_datos';
  if (semanas == null) return existencia > 0 ? 'sobra' : 'sin_ventas';
  if (semanas > 52 || !pedir) return 'sobra';
  const d = diasEntre(hoy, pedir);
  if (d <= 7) return 'ya';
  if (d <= 90) return 'pronto';
  return 'calma';
}

/**
 * El CALENDARIO de compras de un hilo con temporada: que llegue 3 semanas antes
 * de que empiece. «Pedir» = inicio − semanas del proveedor − 3 semanas; «Llega»
 * = inicio − 3 semanas. Con la siguiente vez que empieza su temporada.
 */
function calendarioDeCompra(inicioMes, hoy, semanasProveedor) {
  const [a] = anioMes(hoy);
  let inicio = `${a}-${String(inicioMes + 1).padStart(2, '0')}-01`;
  if (inicio < hoy) inicio = `${a + 1}-${String(inicioMes + 1).padStart(2, '0')}-01`;
  const pedir = sumarDias(inicio, -(semanasProveedor * 7 + 21));
  const llega = sumarDias(inicio, -21);
  return {
    inicio,
    pedir,
    llega,
    mes_pedir: anioMes(pedir)[1],
    mes_llega: anioMes(llega)[1],
    texto: `${parteDelMes(pedir)} de ${nombreMes(anioMes(pedir)[1])}, para ${nombreMes(inicioMes + 1)}`,
  };
}

// --------------------------------------------------------------- unidades

/** "1,720 kg", o de 1,000 kg en adelante "31.3 t" (hasta 2 decimales, sin ceros de relleno). */
function kgOToneladas(kg, conToneladas = true) {
  const n = Number(kg) || 0;
  if (conToneladas && Math.abs(n) >= 1000) {
    return `${(Math.round((n / 1000) * 100) / 100).toLocaleString('es-MX', { maximumFractionDigits: 2 })} t`;
  }
  return `${Math.round(n).toLocaleString('es-MX')} kg`;
}

module.exports = {
  MESES, r1, r2, r3, cap,
  aNum, aDia, sumarDias, diasEntre, diasDelMes, sumarMeses, claveMes, anioMes, nombreMes, fechaLarga, parteDelMes,
  nivelHistoria,
  seMueve, rotacion,
  indice, tramoCalor, temporadaDe, textoTemporada, rachaDe,
  tendencia, pronosticoMes, modeloDeVenta, sumaPronostico, seVendeAhora, alcanzaSemanas, seAcabaEl,
  pedirAMasTardar, cuantoPedir, estadoPedido, calendarioDeCompra, a10,
  kgOToneladas,
};
