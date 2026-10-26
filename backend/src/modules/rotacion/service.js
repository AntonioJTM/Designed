'use strict';

const { AppError } = require('../../middlewares/error');
const { hoyLocal } = require('../../utils/fechas');
const model = require('./model');
const c = require('./cuentas');

// ROTACIÓN DE INVENTARIO (2026-10-22): arma las cuatro pestañas con las cuentas
// de `cuentas.js`. Todo se calcula al momento con lo que hay en la base (sin
// tablas de resumen). SOLO KILOS.
//
// LA VENTA DE CADA HILO, DÍA POR DÍA: la del sistema (la fecha de entrega, o la de
// la venta) más las VENTAS ANTERIORES cargadas por mes (repartidas entre sus
// días). En un mes donde el sistema ya tiene ventas de ese hilo, mandan las del
// sistema. Un día "se conoce" si cae en la época del sistema o en un mes cargado.
//
// UN ALMACÉN SIN MOSTRADOR no vende: su "venta" es lo que SURTE a las tiendas
// (las salidas por envío). En hitex la matriz sí vende (es tienda): cuenta sus ventas.

const UMBRAL_TEMPORADA = 1.3;
const SEMANAS_PROYECCION = 26;
const DIAS_REPARTO_TIENDAS = 90;

// --------------------------------------------------------------- datos

async function _datos() {
  const [hilos, almacenes, ventas, surtido, kardex, existencias, enCamino, paquetes, anteriores, ajustes] = await Promise.all([
    model.hilos(), model.almacenes(), model.ventasPorDia(), model.surtidoPorDia(), model.kardexPorDia(),
    model.existencias(), model.enCamino(), model.paquetes(), model.ventasAnteriores(), model.ajustes(),
  ]);
  const hoy = hoyLocal();
  const d = { hoy, hilos, almacenes, ventas, surtido, kardex, existencias, enCamino, paquetes, anteriores, ajustes };
  d.historia = _historia(d);
  return d;
}

/**
 * La HISTORIA: desde cuándo hay ventas y qué meses se conocen completos.
 *   · época del sistema: desde su primera venta;
 *   · meses cargados de años anteriores (cualquier hilo).
 */
function _historia(d) {
  const { hoy } = d;
  const primeraVenta = d.ventas.reduce((m, v) => (!m || v.dia < m ? v.dia : m), null);
  const cargados = new Set(d.anteriores.map((a) => c.claveMes(a.anio, a.mes)));
  const primeroCargado = [...cargados].sort()[0] ?? null;
  const candidatos = [primeraVenta, primeroCargado ? `${primeroCargado}-01` : null].filter(Boolean).sort();
  const desde = candidatos[0] ?? null;
  const [ah, mh] = c.anioMes(hoy);
  const inicioMesHoy = `${c.claveMes(ah, mh)}-01`;

  /** ¿Se conoce la venta de ese día? */
  const cubreDia = (dia) => (primeraVenta && dia >= primeraVenta) || cargados.has(dia.slice(0, 7));
  /** ¿Se conoce COMPLETO ese mes (y ya terminó)? */
  const cubreMes = (anio, mes) => {
    const ini = `${c.claveMes(anio, mes)}-01`;
    if (ini >= inicioMesHoy) return false;
    return cargados.has(c.claveMes(anio, mes)) || (!!primeraVenta && ini >= primeraVenta);
  };
  // Meses completos conocidos entre los últimos 12 y los últimos 24.
  let ultimos12 = 0;
  let ultimos24 = 0;
  for (let k = 1; k <= 24; k++) {
    const t = new Date(Date.UTC(ah, mh - 1 - k, 1));
    if (cubreMes(t.getUTCFullYear(), t.getUTCMonth() + 1)) {
      ultimos24++;
      if (k <= 12) ultimos12++;
    }
  }
  const dias = desde ? c.diasEntre(desde, hoy) + 1 : 0;
  const meses = ultimos12 < 12 ? ultimos12 : ultimos24 < 24 ? 12 : 24;
  return {
    desde,
    dias,
    semanas: Math.floor(dias / 7),
    nivel: c.nivelHistoria(dias, meses),
    meses_completos: ultimos24,
    sistema_desde: primeraVenta,
    hay_anteriores: cargados.size > 0,
    cubreDia,
    cubreMes,
  };
}

/** Lo que se manda de la historia (sin las funciones). */
function _historiaPublica(h) {
  const faltan = Math.max(0, Math.ceil((28 - h.dias) / 7));
  return {
    desde: h.desde, dias: h.dias, semanas: h.semanas, nivel: h.nivel, meses_completos: h.meses_completos,
    sistema_desde: h.sistema_desde, hay_anteriores: h.hay_anteriores, faltan_semanas: h.nivel === 'poca' ? faltan : 0,
  };
}

const nombreHilo = (h) => `${h.color}${h.calibre ? ' ' + h.calibre : ''}`;

/**
 * El ALCANCE: todos los almacenes, o uno. En uno sin mostrador la "venta" es lo
 * que surte. `almacenId` vacío = todos.
 */
function _alcance(d, almacenId) {
  if (!almacenId) return { almacenId: null, almacen: null, surte: false };
  const almacen = d.almacenes.find((a) => a.id === Number(almacenId));
  if (!almacen) throw new AppError(404, 'NO_ENCONTRADO', 'Ese almacén no existe');
  return { almacenId: almacen.id, almacen, surte: !almacen.vende };
}

/** La venta de cada hilo, día por día, en el alcance (Map hilo → Map día → kg). */
function _ventaDiaria(d, alcance) {
  const porHilo = new Map();
  const sumar = (hilo, dia, kg) => {
    if (!porHilo.has(hilo)) porHilo.set(hilo, new Map());
    const m = porHilo.get(hilo);
    m.set(dia, (m.get(dia) ?? 0) + kg);
  };
  const delSistema = alcance.surte ? d.surtido : d.ventas;
  for (const v of delSistema) {
    if (alcance.almacenId && v.almacen !== alcance.almacenId) continue;
    sumar(v.hilo, v.dia, v.kg);
  }
  // Las ventas de años anteriores, solo en los meses en que el sistema no tiene
  // ventas de ese hilo (en ninguna tienda). Un almacén que solo surte no tiene.
  if (!alcance.surte) {
    const conSistema = new Set(d.ventas.map((v) => `${v.hilo}|${v.dia.slice(0, 7)}`));
    const [ah, mh] = c.anioMes(d.hoy);
    for (const a of d.anteriores) {
      if (alcance.almacenId && a.almacen !== alcance.almacenId) continue;
      if (a.anio * 12 + a.mes >= ah * 12 + mh) continue;
      if (conSistema.has(`${a.hilo}|${c.claveMes(a.anio, a.mes)}`)) continue;
      const dm = c.diasDelMes(a.anio, a.mes);
      for (let dia = 1; dia <= dm; dia++) sumar(a.hilo, `${c.claveMes(a.anio, a.mes)}-${String(dia).padStart(2, '0')}`, a.kg / dm);
    }
  }
  return porHilo;
}

/** Los kilos de un mes de una serie diaria (null si el mes no se conoce completo). */
function _kgMes(serie, anio, mes, historia) {
  if (!historia.cubreMes(anio, mes)) return null;
  const pref = c.claveMes(anio, mes);
  let s = 0;
  for (const [dia, kg] of serie ?? []) if (dia.startsWith(pref)) s += kg;
  return s;
}

/** Los kilos de un rango de días [desde, hasta) de una serie diaria. */
function _kgRango(serie, desde, hasta) {
  let s = 0;
  for (const [dia, kg] of serie ?? []) if (dia >= desde && dia < hasta) s += kg;
  return s;
}

/** Suma varias series diarias en una. */
function _sumarSeries(series) {
  const t = new Map();
  for (const s of series) for (const [dia, kg] of s ?? []) t.set(dia, (t.get(dia) ?? 0) + kg);
  return t;
}

// --------------------------------------------------------------- el modelo de un hilo

/** Para cada mes (1–12), lo de su vez más reciente COMPLETA antes del mes en curso. */
function _base(serie, d) {
  const [ah, mh] = c.anioMes(d.hoy);
  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    for (let anio = ah; anio >= ah - 4; anio--) {
      if (anio * 12 + mes >= ah * 12 + mh) continue;
      const kg = _kgMes(serie, anio, mes, d.historia);
      if (kg != null) return { anio, kg };
    }
    return null;
  });
}

/** La tendencia: enero al último mes completo, este año contra el anterior (meses conocidos de los dos). */
function _tendencia(serie, d) {
  const [ah, mh] = c.anioMes(d.hoy);
  let actual = 0;
  let anterior = 0;
  let meses = 0;
  for (let mes = 1; mes < mh; mes++) {
    const a = _kgMes(serie, ah, mes, d.historia);
    const b = _kgMes(serie, ah - 1, mes, d.historia);
    if (a == null || b == null) continue;
    actual += a;
    anterior += b;
    meses++;
  }
  const valor = c.tendencia(actual, anterior, meses);
  return {
    valor,
    // Lo que se enseña como "contra el año pasado" (null si no hay con qué comparar).
    comparable: meses >= 3 && anterior > 0,
    actual: Math.round(actual),
    anterior: Math.round(anterior),
    meses,
    hasta_mes: mh - 1,
    anio: ah,
  };
}

/** El promedio diario de las últimas 8 semanas conocidas (o las que haya, desde 4). */
function _promedioDiario(serie, d) {
  let kg = 0;
  let dias = 0;
  for (let i = 1; i <= 56; i++) {
    const dia = c.sumarDias(d.hoy, -i);
    if (!d.historia.cubreDia(dia)) continue;
    kg += serie?.get(dia) ?? 0;
    dias++;
  }
  return dias >= 28 ? kg / dias : null;
}

/** El modelo de venta: con temporada si hay un año completo; si no, el promedio reciente. */
function _modelo(serie, d) {
  const base = _base(serie, d);
  const tend = _tendencia(serie, d);
  const conTemporada = ['completa', 'confiable'].includes(d.historia.nivel) && base.every((b) => b);
  const modelo = c.modeloDeVenta(conTemporada
    ? { base: base.map((b) => b.kg), tendencia: tend.valor }
    : { promedioDiario: _promedioDiario(serie, d) });
  return { modelo, base, tendencia: tend, conTemporada };
}

/** Índices y temporada de la base (los últimos 12 meses completos). */
function _temporadaBase(base, conTemporada) {
  if (!conTemporada) return { indices: null, temporada: null };
  const total = base.reduce((s, b) => s + b.kg, 0);
  const indices = base.map((b) => c.indice(b.kg, total));
  const t = total > 0 ? c.temporadaDe(indices, UMBRAL_TEMPORADA) : null;
  return { indices, total, temporada: t };
}

// --------------------------------------------------------------- existencias

/** Lo que hay hoy de cada hilo en el alcance: kg (con lo que viene en camino) y paquetes. */
function _hayHoy(d, alcance) {
  const kg = new Map();
  const enCamino = new Map();
  const almacenesCon = new Map();
  for (const e of d.existencias) {
    if (alcance.almacenId && e.almacen !== alcance.almacenId) continue;
    kg.set(e.hilo, (kg.get(e.hilo) ?? 0) + e.kg);
    if (e.kg > 0.004) {
      if (!almacenesCon.has(e.hilo)) almacenesCon.set(e.hilo, new Set());
      almacenesCon.get(e.hilo).add(e.almacen);
    }
  }
  // Lo que viaja entre almacenes cuenta, para que el hilo no "desaparezca" mientras va.
  for (const t of d.enCamino) {
    if (alcance.almacenId && t.almacen !== alcance.almacenId) continue;
    enCamino.set(t.hilo, (enCamino.get(t.hilo) ?? 0) + t.kg);
  }
  const paq = new Map();
  const pesoTodos = new Map();
  for (const p of d.paquetes.porAlmacen) {
    const t = pesoTodos.get(p.hilo) ?? { n: 0, kg: 0 };
    pesoTodos.set(p.hilo, { n: t.n + p.n, kg: t.kg + p.kg });
    if (alcance.almacenId && p.almacen !== alcance.almacenId) continue;
    const x = paq.get(p.hilo) ?? { n: 0, kg: 0 };
    paq.set(p.hilo, { n: x.n + p.n, kg: x.kg + p.kg });
  }
  return (hilo) => {
    const p = paq.get(hilo);
    const todos = pesoTodos.get(hilo);
    // El peso promedio REAL de los paquetes; si no hay ninguno, el del catálogo.
    const peso = p?.n ? p.kg / p.n : todos?.n ? todos.kg / todos.n : d.paquetes.catalogo.get(hilo) ?? null;
    return {
      kg: c.r3((kg.get(hilo) ?? 0) + (enCamino.get(hilo) ?? 0)),
      en_camino: c.r3(enCamino.get(hilo) ?? 0),
      paquetes: p?.n ?? 0,
      peso_paquete: peso != null ? c.r1(peso) : null,
      almacenes: almacenesCon.get(hilo)?.size ?? 0,
    };
  };
}

/**
 * La existencia promedio diaria de cada hilo en una ventana (de la época del
 * kardex). Se arma con el kardex día por día; si la suma de hoy no cuadra con
 * Inventario, la diferencia se toma como el saldo con que empezó (y se avisa).
 */
function _existenciaPromedio(d, alcance, desde, hasta) {
  const movs = new Map();
  for (const k of d.kardex) {
    if (alcance.almacenId && k.almacen !== alcance.almacenId) continue;
    if (!movs.has(k.hilo)) movs.set(k.hilo, []);
    movs.get(k.hilo).push(k);
  }
  const hoyKg = new Map();
  for (const e of d.existencias) {
    if (alcance.almacenId && e.almacen !== alcance.almacenId) continue;
    hoyKg.set(e.hilo, (hoyKg.get(e.hilo) ?? 0) + e.kg);
  }
  const dias = c.diasEntre(desde, hasta);
  return (hilo) => {
    const lista = movs.get(hilo) ?? [];
    const kardexHoy = lista.reduce((s, m) => s + m.kg, 0);
    const delta = (hoyKg.get(hilo) ?? 0) - kardexHoy;
    let saldo = delta + lista.filter((m) => m.dia < desde).reduce((s, m) => s + m.kg, 0);
    const porDia = new Map();
    for (const m of lista) if (m.dia >= desde) porDia.set(m.dia, (porDia.get(m.dia) ?? 0) + m.kg);
    let suma = 0;
    for (let i = 0; i < dias; i++) {
      const dia = c.sumarDias(desde, i);
      saldo += porDia.get(dia) ?? 0;
      suma += Math.max(0, saldo);
    }
    return { promedio: dias > 0 ? suma / dias : 0, cuadra: Math.abs(delta) <= 0.5 };
  };
}

// --------------------------------------------------------------- un hilo, completo

/** El análisis de todos los hilos en un alcance (cada uno con su pronóstico y su pedido). */
function _analizar(d, alcance) {
  const { hoy, historia, ajustes } = d;
  const serie = _ventaDiaria(d, alcance);
  const hay = _hayHoy(d, alcance);

  // Ventana de la rotación: los últimos 365 días de la época del kardex (sin las
  // ventas anteriores: de esos días no se sabe cuánto había).
  const primerKardex = d.kardex[0]?.dia ?? null;
  const iniRot = primerKardex ? [primerKardex, c.sumarDias(hoy, -364)].sort()[1] : null;
  const finRot = c.sumarDias(hoy, 1);
  const diasRot = iniRot ? c.diasEntre(iniRot, finRot) : 0;
  const existProm = iniRot ? _existenciaPromedio(d, alcance, iniRot, finRot) : null;
  const delSistema = new Map();
  for (const v of alcance.surte ? d.surtido : d.ventas) {
    if (alcance.almacenId && v.almacen !== alcance.almacenId) continue;
    if (!iniRot || v.dia < iniRot) continue;
    delSistema.set(v.hilo, (delSistema.get(v.hilo) ?? 0) + v.kg);
  }
  // Paquete contra cono, en los últimos 12 meses (solo el sistema sabe la presentación).
  const hace12 = c.sumarDias(hoy, -364);
  const porTipo = new Map();
  for (const v of d.ventas) {
    if (alcance.almacenId && v.almacen !== alcance.almacenId) continue;
    if (v.dia < hace12) continue;
    const x = porTipo.get(v.hilo) ?? { paquete: 0, cono: 0, otro: 0 };
    x[v.tipo === 'paquete' ? 'paquete' : v.tipo === 'cono' ? 'cono' : 'otro'] += v.kg;
    porTipo.set(v.hilo, x);
  }

  const filas = d.hilos.map((h) => {
    const s = serie.get(h.id) ?? new Map();
    const { modelo, base, tendencia, conTemporada } = _modelo(s, d);
    const { indices, temporada } = _temporadaBase(base, conTemporada);
    const hoyHay = hay(h.id);
    const vendido12 = _kgRango(s, hace12, finRot);
    const ex = existProm ? existProm(h.id) : null;
    const rot = ex ? c.rotacion(delSistema.get(h.id) ?? 0, ex.promedio, diasRot) : null;
    const semana = c.seVendeAhora(modelo, hoy);
    const alcanza = semana != null ? c.alcanzaSemanas(hoyHay.kg, semana) : null;
    const seAcaba = semana > 0 ? c.seAcabaEl(hoyHay.kg, modelo, hoy) : null;
    const pedir = c.pedirAMasTardar(seAcaba, ajustes.semanas_proveedor, ajustes.semanas_colchon);
    const estado = c.estadoPedido({ pedir, hoy, semanas: semana > 0 ? alcanza : null, existencia: hoyHay.kg, conModelo: !!modelo });
    const pedido = modelo && ['ya', 'pronto', 'calma'].includes(estado)
      ? c.cuantoPedir({
          existencia: hoyHay.kg, modelo, hoy, pedir,
          semanasProveedor: ajustes.semanas_proveedor, semanasColchon: ajustes.semanas_colchon,
          mesesCubre: ajustes.meses_cubre, pesoPaquete: hoyHay.peso_paquete,
        })
      : null;
    return {
      id: h.id,
      hilo: nombreHilo(h),
      color: h.color,
      calibre: h.calibre,
      material: h.material,
      activo: h.activo,
      serie: s,
      modelo,
      base,
      indices,
      temporada: temporada ? { ...temporada, texto: c.textoTemporada(temporada) } : null,
      tendencia,
      vendido_12m: c.r3(vendido12),
      por_tipo: porTipo.get(h.id) ?? { paquete: 0, cono: 0, otro: 0 },
      rotacion: rot ? {
        ...rot, existencia_promedio: Math.round(ex.promedio), dias: diasRot, kardex_cuadra: ex.cuadra,
        kg_ventana: Math.round(delSistema.get(h.id) ?? 0),
      } : null,
      hay: hoyHay,
      se_vende_semana: semana != null ? c.r1(semana) : null,
      alcanza_semanas: alcanza != null ? c.r1(alcanza) : null,
      se_acaba: seAcaba,
      pedir,
      estado,
      pedido,
    };
  });
  // Solo los hilos con algo que decir: con ventas conocidas o con existencia.
  return filas.filter((f) => f.serie.size > 0 || f.hay.kg > 0.004 || f.vendido_12m > 0);
}

// --------------------------------------------------------------- textos

const VECES = (r) => (r >= 3.4 ? 'más del triple' : r >= 3 ? 'el triple' : r >= 2.6 ? 'casi el triple'
  : r >= 2.2 ? 'más del doble' : r >= 1.8 ? 'el doble' : `${Math.round((r - 1) * 100)}% más`);

/** Lo que se espera vender en el mes de un día, por semana. */
function _semanaDelMes(modelo, dia) {
  const [a, m] = c.anioMes(dia);
  const dm = c.diasDelMes(a, m);
  return (c.sumaPronostico(modelo, `${c.claveMes(a, m)}-01`, c.sumarDias(`${c.claveMes(a, m)}-01`, dm)) / dm) * 7;
}

/** La siguiente vez que empieza su temporada (o el día de hoy si ya está en ella). */
function _inicioTemporada(t, hoy) {
  const [ah, mh] = c.anioMes(hoy);
  if (t.meses.includes(mh - 1)) return hoy;
  const anio = t.inicio + 1 >= mh ? ah : ah + 1;
  return `${c.claveMes(anio, t.inicio + 1)}-01`;
}

/**
 * La nota corta de «Le alcanza hasta» ("En marzo vende casi el triple", "Su
 * temporada es marzo a mayo", "Aguanta su temporada de septiembre a diciembre").
 */
function _nota(f, hoy) {
  if (!f.temporada || !f.se_acaba || !f.modelo || !(f.se_vende_semana > 0)) return null;
  const t = f.temporada;
  const mesAcaba = c.anioMes(f.se_acaba)[1] - 1;
  const texto = t.texto.toLowerCase();
  if (t.meses.includes(mesAcaba)) {
    const r = _semanaDelMes(f.modelo, f.se_acaba) / f.se_vende_semana;
    return r >= 1.8 ? `En ${c.nombreMes(mesAcaba + 1)} vende ${VECES(r)}` : `Su temporada es ${texto}`;
  }
  const inicio = _inicioTemporada(t, hoy);
  if (inicio <= f.se_acaba) return `Aguanta su temporada de ${texto}`;
  return null;
}

/** El texto de «Hay que pedir pronto» (Resumen). */
function _textoPedir(f, hoy) {
  const acaba = c.fechaLarga(f.se_acaba, hoy);
  if (f.estado === 'ya' && f.pedir < hoy) return `Había que pedirlo el ${c.fechaLarga(f.pedir, hoy)}. Se acaba hacia el ${acaba}.`;
  if (f.temporada) {
    const inicio = _inicioTemporada(f.temporada, hoy);
    if (inicio > hoy && inicio > f.pedir && inicio <= f.se_acaba) {
      return `Pedir antes del ${c.fechaLarga(f.pedir, hoy)}: en ${c.nombreMes(c.anioMes(inicio)[1])} empieza su temporada.`;
    }
  }
  return `Pedir antes del ${c.fechaLarga(f.pedir, hoy)}. Se acaba hacia el ${acaba}.`;
}

/** "más de 3 años", "más de un año", o las semanas. */
function _cuantoAlcanza(semanas) {
  if (semanas == null) return 'mucho tiempo';
  const anios = Math.floor(semanas / 52);
  return anios >= 2 ? `más de ${anios} años` : anios === 1 ? 'más de un año' : `${Math.round(semanas)} semanas`;
}

// --------------------------------------------------------------- piezas comunes

/** Los meses de los dos años (el anterior y el en curso), con su origen. */
function _mesesDosAnios(serie, modelo, d) {
  const [ah, mh] = c.anioMes(d.hoy);
  const anterior = Array.from({ length: 12 }, (_, i) => {
    const kg = _kgMes(serie, ah - 1, i + 1, d.historia);
    return { mes: i + 1, kg: kg == null ? null : Math.round(kg), origen: kg == null ? null : 'real' };
  });
  const actual = Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    if (mes < mh) {
      const kg = _kgMes(serie, ah, mes, d.historia);
      return { mes, kg: kg == null ? null : Math.round(kg), origen: kg == null ? null : 'real' };
    }
    if (mes === mh) {
      const kg = _kgRango(serie, `${c.claveMes(ah, mh)}-01`, c.sumarDias(d.hoy, 1));
      return { mes, kg: Math.round(kg), origen: 'en_curso' };
    }
    const ini = `${c.claveMes(ah, mes)}-01`;
    const kg = modelo ? c.sumaPronostico(modelo, ini, c.sumarDias(ini, c.diasDelMes(ah, mes))) : null;
    return { mes, kg: kg == null ? null : Math.round(kg), origen: kg == null ? null : 'pronostico' };
  });
  return {
    anio_anterior: ah - 1,
    anio_actual: ah,
    corte: Number(d.hoy.slice(8, 10)),
    mes_actual: mh,
    anterior,
    actual,
  };
}

/** Temporada alta y baja de todo junto (3 meses seguidos), con su %. */
function _altaBaja(filas) {
  if (!filas.length || !filas.every((f) => f.indices)) return null;
  const total = Array.from({ length: 12 }, (_, i) => filas.reduce((s, f) => s + (f.base[i]?.kg ?? 0), 0));
  const anual = total.reduce((s, x) => s + x, 0);
  if (!(anual > 0)) return null;
  const idx = total.map((x) => c.indice(x, anual));
  const pieza = (r) => r && {
    meses: r.meses,
    texto: c.textoTemporada({ meses: r.meses, inicio: r.inicio, fin: r.fin }),
    pct: Math.round((r.promedio - 1) * 100),
    kg_mes: Math.round(r.meses.reduce((s, m) => s + total[m], 0) / r.meses.length),
  };
  return { alta: pieza(c.rachaDe(idx, 3, true)), baja: pieza(c.rachaDe(idx, 3, false)), kg_mes_normal: Math.round(anual / 12) };
}

/** Un hilo para la tabla o la lista (sin la serie ni el modelo). */
function _renglon(f, hoy) {
  return {
    producto_id: f.id,
    hilo: f.hilo,
    color: f.color,
    calibre: f.calibre,
    material: f.material,
    vendido_12m: Math.round(f.vendido_12m),
    rotacion: f.rotacion,
    contra_anio_pasado: f.tendencia.comparable ? c.r2(f.tendencia.actual / f.tendencia.anterior) : null,
    temporada: f.temporada ? f.temporada.texto : null,
    hay: f.hay,
    se_vende_semana: f.se_vende_semana,
    alcanza_semanas: f.alcanza_semanas,
    se_acaba: f.se_acaba,
    pedir: f.pedir,
    estado: f.estado,
    pedido: f.pedido ? { kg: f.pedido.kg, paquetes: f.pedido.paquetes, llega: f.pedido.llega } : null,
    nota: _nota(f, hoy),
  };
}

const ORDEN_ESTADO = { ya: 0, pronto: 1, calma: 2, sobra: 3, sin_ventas: 4, sin_datos: 5 };
const porUrgencia = (a, b) => (ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado])
  || String(a.pedir ?? '9999').localeCompare(String(b.pedir ?? '9999'))
  || b.vendido_12m - a.vendido_12m;

/** Los almacenes para los filtros. */
const _almacenesPublicos = (d) => d.almacenes.filter((a) => a.activo).map((a) => ({ id: a.id, nombre: a.nombre, vende: a.vende, es_matriz: a.es_matriz }));
const _hilosPublicos = (filas) => [...filas].sort((a, b) => b.vendido_12m - a.vendido_12m || a.hilo.localeCompare(b.hilo))
  .map((f) => ({ producto_id: f.id, hilo: f.hilo }));

/** Totales de un grupo de hilos: kg, paquetes, cuántos. */
function _sumaPedido(lista) {
  return {
    hilos: lista.length,
    kg: lista.reduce((s, f) => s + (f.pedido?.kg ?? 0), 0),
    paquetes: lista.reduce((s, f) => s + (f.pedido?.paquetes ?? 0), 0),
  };
}

// --------------------------------------------------------------- RESUMEN

async function resumen({ almacenId = null, productoId = null } = {}) {
  const d = await _datos();
  const alcance = _alcance(d, almacenId);
  const filas = _analizar(d, alcance);
  const global = alcance.almacenId ? _analizar(d, _alcance(d, null)) : filas;
  const elegidos = productoId ? filas.filter((f) => f.id === Number(productoId)) : filas;
  if (productoId && !elegidos.length) throw new AppError(404, 'NO_ENCONTRADO', 'Ese hilo no tiene ventas ni existencias');

  // Lo de todos los hilos elegidos, junto.
  const serie = _sumarSeries(elegidos.map((f) => f.serie));
  const juntos = _modelo(serie, d);
  const vendido12 = elegidos.reduce((s, f) => s + f.vendido_12m, 0);
  const hay = elegidos.reduce((s, f) => s + f.hay.kg, 0);
  const paquetes = elegidos.reduce((s, f) => s + f.hay.paquetes, 0);
  const almacenesCon = new Set(d.existencias.filter((e) => e.kg > 0.004 && (!alcance.almacenId || e.almacen === alcance.almacenId)
    && (!productoId || e.hilo === Number(productoId))).map((e) => e.almacen)).size;
  // La rotación de todos juntos: lo vendido en la ventana ÷ la suma de sus existencias promedio.
  const conRot = elegidos.filter((f) => f.rotacion);
  const vendidoRot = conRot.reduce((s, f) => s + f.rotacion.kg_ventana, 0);
  const existRot = conRot.reduce((s, f) => s + f.rotacion.existencia_promedio, 0);
  const rotTotal = existRot > 0 ? c.rotacion(vendidoRot, existRot, conRot[0].rotacion.dias) : null;
  const semana = c.seVendeAhora(juntos.modelo, d.hoy);
  const totalVendido = filas.reduce((s, f) => s + f.vendido_12m, 0);

  // El ranking: todos los hilos del alcance.
  const ranking = [...filas].sort((a, b) => b.vendido_12m - a.vendido_12m).map((f) => ({
    ..._renglon(f, d.hoy),
    pct_del_total: totalVendido > 0 ? c.r1((100 * f.vendido_12m) / totalVendido) : 0,
  }));
  // Hay que pedir pronto: de todos los almacenes (pedir es de la empresa).
  const urgentes = global.filter((f) => ['ya', 'pronto'].includes(f.estado)).sort(porUrgencia);
  return {
    hoy: d.hoy,
    historia: _historiaPublica(d.historia),
    ajustes: d.ajustes,
    almacenes: _almacenesPublicos(d),
    hilos: _hilosPublicos(filas),
    alcance: { almacen_id: alcance.almacenId, surte: alcance.surte, producto_id: productoId ? Number(productoId) : null },
    cifras: {
      vendido_12m: Math.round(vendido12),
      contra_anio_pasado: juntos.tendencia.comparable ? c.r2(juntos.tendencia.actual / juntos.tendencia.anterior) : null,
      tendencia: juntos.tendencia,
      hay_kg: Math.round(hay),
      hay_paquetes: paquetes,
      almacenes_con: almacenesCon,
      rotacion: rotTotal,
      rotacion_dias: conRot[0]?.rotacion?.dias ?? null,
      se_vende_semana: semana != null ? Math.round(semana) : null,
      alcanza_semanas: semana > 0 ? c.r1(hay / semana) : null,
    },
    meses: _mesesDosAnios(serie, juntos.modelo, d),
    temporadas: juntos.conTemporada ? _altaBaja(elegidos) : null,
    // Hasta 5, y el total de los que se ven (la tarjeta dice "Los cuatro juntos").
    pedir_pronto: (() => {
      const lista = urgentes.slice(0, 5);
      return {
        lista: lista.map((f) => ({ ..._renglon(f, d.hoy), texto: _textoPedir(f, d.hoy) })),
        total: _sumaPedido(lista),
        cuantos: urgentes.length,
      };
    })(),
    ranking,
    // Lo que hay en cada almacén (de los hilos elegidos): con poca historia es lo único que se ve.
    por_almacen: d.almacenes.filter((a) => a.activo && (!alcance.almacenId || a.id === alcance.almacenId)).map((a) => {
      const h = _hayHoy(d, _alcance(d, a.id));
      const ids = elegidos.map((f) => f.id);
      return {
        almacen_id: a.id, nombre: a.nombre, vende: a.vende,
        kg: Math.round(ids.reduce((s, id) => s + h(id).kg, 0)),
        paquetes: ids.reduce((s, id) => s + h(id).paquetes, 0),
      };
    }).filter((a) => a.kg > 0),
    sobran: filas.filter((f) => f.estado === 'sobra' && f.se_vende_semana > 0).map((f) => ({
      producto_id: f.id, hilo: f.hilo, hay_kg: Math.round(f.hay.kg), se_vende_semana: f.se_vende_semana,
      alcanza: _cuantoAlcanza(f.alcanza_semanas),
    })),
  };
}

// --------------------------------------------------------------- TEMPORADAS

/** Nombre de una temporada por sus meses ("Primavera", "Antes del frío", "Fin de año"…). */
function _nombreTemporada(t) {
  if ([10, 11, 0].includes(t.fin)) return 'Fin de año';
  if ([1, 2, 3].includes(t.inicio)) return 'Primavera';
  if ([4, 5].includes(t.inicio)) return 'Verano';
  if ([6, 7, 8].includes(t.inicio)) return 'Antes del frío';
  return 'Invierno';
}

/** "A", "A y B", "A, B y C". */
const _lista = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

async function temporadas({ almacenId = null, anio = null } = {}) {
  const d = await _datos();
  const alcance = _alcance(d, almacenId);
  if (alcance.surte) throw new AppError(422, 'SOLO_TIENDAS', 'Las temporadas se ven por tienda: ese almacén no vende.');
  const filas = _analizar(d, alcance);
  const [ah, mh] = c.anioMes(d.hoy);
  const h = d.historia;

  // Los años que se pueden ver: con algún mes conocido, o el en curso.
  const anios = [];
  for (let a = ah; a >= ah - 6; a--) {
    const meses = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => h.cubreMes(a, m));
    if (meses.length || a === ah) anios.push({ anio: a, meses: meses.length, completo: meses.length === 12 });
  }
  const completos = anios.filter((x) => x.completo);
  const elegido = anio === 'promedio' ? 'promedio' : Number(anio) || completos[0]?.anio || ah;
  const ultimos2 = anios.filter((x) => x.meses > 0).slice(0, 2).map((x) => x.anio);

  /** Los kg de un mes de una serie en la vista elegida (null = no se conoce). */
  const kgVista = (serie, mes) => {
    if (elegido === 'promedio') {
      const vals = ultimos2.map((a) => _kgMes(serie, a, mes, h)).filter((x) => x != null);
      return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
    }
    if (elegido === ah && mes === mh) return _kgRango(serie, `${c.claveMes(ah, mh)}-01`, c.sumarDias(d.hoy, 1));
    return _kgMes(serie, elegido, mes, h);
  };
  const enCurso = (mes) => elegido === ah && mes === mh;

  const conTemporadas = ['completa', 'confiable'].includes(h.nivel);
  const renglones = [...filas].sort((a, b) => b.vendido_12m - a.vendido_12m).map((f) => {
    const meses = Array.from({ length: 12 }, (_, i) => {
      const kg = kgVista(f.serie, i + 1);
      return { mes: i + 1, kg: kg == null ? null : Math.round(kg), en_curso: enCurso(i + 1) };
    });
    const completosM = meses.filter((m) => m.kg != null && !m.en_curso);
    const totalCompletos = completosM.reduce((s, m) => s + m.kg, 0);
    const total = meses.reduce((s, m) => s + (m.kg ?? 0), 0);
    for (const m of meses) {
      m.indice = conTemporadas && m.kg != null && !m.en_curso ? c.indice(m.kg, totalCompletos, completosM.length) : null;
      m.tramo = c.tramoCalor(m.indice);
    }
    const idx12 = meses.map((m) => m.indice);
    const temporada = conTemporadas && completosM.length === 12 && totalCompletos > 0 ? c.temporadaDe(idx12, UMBRAL_TEMPORADA) : null;
    const mejor = completosM.length ? completosM.reduce((a, b) => (b.kg > a.kg ? b : a)).mes : null;
    return {
      producto_id: f.id, hilo: f.hilo, meses, total: Math.round(total), mejor_mes: mejor,
      temporada: completosM.length === 12 && conTemporadas ? c.textoTemporada(temporada) : null,
    };
  });
  const totalMes = Array.from({ length: 12 }, (_, i) => {
    const vals = renglones.map((r) => r.meses[i].kg).filter((x) => x != null);
    return vals.length ? vals.reduce((s, x) => s + x, 0) : null;
  });
  const completosTot = totalMes.filter((x, i) => x != null && !enCurso(i + 1));
  const totTemporada = conTemporadas && completosTot.length === 12
    ? c.textoTemporada(c.temporadaDe(totalMes.map((x) => c.indice(x, completosTot.reduce((s, y) => s + y, 0))), UMBRAL_TEMPORADA))
    : null;

  // El calendario de compras y las tarjetas: con la temporada de los últimos 12
  // meses completos (es para planear), de todos los almacenes.
  const global = alcance.almacenId ? _analizar(d, _alcance(d, null)) : filas;
  const conTemp = global.filter((f) => f.temporada);
  const grupos = new Map();
  for (const f of conTemp) {
    const k = c.calendarioDeCompra(f.temporada.inicio, d.hoy, d.ajustes.semanas_proveedor);
    const clave = `${k.texto}|${f.temporada.meses.join(',')}`;
    if (!grupos.has(clave)) grupos.set(clave, { ...k, temporada: f.temporada.meses, texto_temporada: f.temporada.texto, hilos: [] });
    grupos.get(clave).hilos.push(f.hilo);
  }
  const calendario = [...grupos.values()].sort((a, b) => a.pedir.localeCompare(b.pedir)).map((g) => ({
    hilos: g.hilos, nombre: _lista(g.hilos), mes_pedir: g.mes_pedir, mes_llega: g.mes_llega, temporada: g.temporada,
    texto: g.texto, texto_temporada: g.texto_temporada,
  }));
  const sinTemporada = conTemporadas ? global.filter((f) => !f.temporada && f.vendido_12m > 0).map((f) => ({
    hilo: f.hilo,
    estado: f.estado,
    hoy: f.estado === 'sobra' ? `Hoy le sobran ${_cuantoAlcanza(f.alcanza_semanas)}.`
      : f.estado === 'ya' ? 'Hoy: hay que pedirlo ya.'
        : f.pedir ? `Hoy: pedirlo antes del ${c.fechaLarga(f.pedir, d.hoy)}.` : '',
    derecha: f.estado === 'sobra' ? 'Ahora no hace falta' : f.estado === 'ya' ? 'Pedir ya' : f.pedir ? `Antes del ${c.fechaLarga(f.pedir, d.hoy)}` : '—',
  })) : [];

  // Las tarjetas por temporada: qué se mueve en cada una y qué parte de su año es.
  const porTemp = new Map();
  for (const f of conTemp) {
    const k = f.temporada.texto;
    if (!porTemp.has(k)) porTemp.set(k, { temporada: f.temporada, hilos: [] });
    const enTemp = f.temporada.meses.reduce((s, m) => s + (f.base[m]?.kg ?? 0), 0);
    const anual = f.base.reduce((s, b) => s + (b?.kg ?? 0), 0);
    porTemp.get(k).hilos.push({ hilo: f.hilo, kg: Math.round(enTemp), anual, mejor: f.indices.indexOf(Math.max(...f.indices)) + 1 });
  }
  const tarjetas = [...porTemp.values()].sort((a, b) => a.temporada.inicio - b.temporada.inicio).map((g) => {
    const kg = g.hilos.reduce((s, x) => s + x.kg, 0);
    const anual = g.hilos.reduce((s, x) => s + x.anual, 0);
    return {
      nombre: _nombreTemporada(g.temporada),
      meses: g.temporada.texto.toLowerCase(),
      num_meses: g.temporada.meses.length,
      hilos: g.hilos.sort((a, b) => b.kg - a.kg).map(({ hilo, kg: k }) => ({ hilo, kg: k })),
      pct: anual > 0 ? Math.round((100 * kg) / anual) : null,
      mejor_mes: g.hilos.length === 1 ? g.hilos[0].mejor : null,
    };
  });
  const parejos = conTemporadas ? global.filter((f) => !f.temporada && f.indices && f.base.every((b) => b)).map((f) => {
    const anual = f.base.reduce((s, b) => s + b.kg, 0);
    const lejos = Math.max(...f.indices.map((i) => Math.abs(i - 1)));
    return { hilo: f.hilo, kg_mes: Math.round(anual / 12), se_aleja: Math.ceil((lejos * 100) / 5) * 5 };
  }).filter((p) => p.kg_mes > 0) : [];

  return {
    hoy: d.hoy,
    historia: _historiaPublica(h),
    ajustes: d.ajustes,
    almacenes: _almacenesPublicos(d).filter((a) => a.vende),
    alcance: { almacen_id: alcance.almacenId },
    anios: anios.map((x) => ({ anio: x.anio, completo: x.completo, meses: x.meses, en_curso: x.anio === ah, hasta_mes: x.anio === ah ? mh : null })),
    hay_promedio: ultimos2.length >= 2,
    elegido,
    con_temporadas: conTemporadas,
    hilos: renglones,
    total: { meses: totalMes.map((x) => (x == null ? null : Math.round(x))), total: Math.round(totalMes.reduce((s, x) => s + (x ?? 0), 0)), temporada: totTemporada },
    calendario,
    sin_temporada: sinTemporada,
    tarjetas,
    parejos,
  };
}

// --------------------------------------------------------------- POR HILO

/** La proyección semanal: lo que habría al empezar cada semana, con y sin el pedido. */
function _proyeccion(f, d) {
  const { hoy, ajustes } = d;
  const pedido = f.modelo ? c.cuantoPedir({
    existencia: f.hay.kg, modelo: f.modelo, hoy, pedir: hoy,
    semanasProveedor: ajustes.semanas_proveedor, semanasColchon: ajustes.semanas_colchon,
    mesesCubre: ajustes.meses_cubre, pesoPaquete: f.hay.peso_paquete,
  }) : null;
  if (!f.modelo) return { pedido: null, semanas: [] };
  const semanas = [];
  let sin = f.hay.kg;
  let con = f.hay.kg;
  let llegaSemana = null;
  for (let k = 0; k <= SEMANAS_PROYECCION; k++) {
    const ini = c.sumarDias(hoy, k * 7);
    const sig = c.sumarDias(ini, 7);
    const venta3 = c.sumaPronostico(f.modelo, ini, c.sumarDias(ini, 21));
    if (pedido && pedido.kg > 0 && llegaSemana == null && pedido.llega < sig) {
      llegaSemana = k;
      con += pedido.kg;
    }
    semanas.push({
      inicio: ini,
      sin_pedido: Math.round(sin),
      con_pedido: Math.round(con),
      poco_sin: sin < venta3,
      poco_con: con < venta3,
    });
    // Lo que no hay no se vende: sin existencia la venta se pierde, no se le «debe» al pedido que llega.
    const venta = c.sumaPronostico(f.modelo, ini, sig);
    sin = Math.max(0, sin - venta);
    con = Math.max(0, con - venta);
  }
  // El siguiente pedido, si se pide hoy: cuándo se acaba otra vez.
  let siguiente = null;
  if (pedido && pedido.kg > 0) {
    let queda = f.hay.kg;
    let acaba = null;
    for (let i = 0; i < 365 * 3; i++) {
      const dia = c.sumarDias(hoy, i);
      if (dia === pedido.llega) queda += pedido.kg;
      queda = Math.max(0, queda - f.modelo.porDia(dia));
      if (queda <= 0 && dia >= pedido.llega) {
        acaba = dia;
        break;
      }
    }
    const pedir2 = c.pedirAMasTardar(acaba, ajustes.semanas_proveedor, ajustes.semanas_colchon);
    if (pedir2) {
      const [a2, m2] = c.anioMes(pedir2);
      siguiente = {
        pedir: pedir2,
        texto: `${c.parteDelMes(pedir2).toLowerCase()} de ${c.nombreMes(m2)}${a2 !== c.anioMes(hoy)[0] && c.diasEntre(hoy, pedir2) > 183 ? ` de ${a2}` : ''}`,
      };
    }
  }
  return { pedido, semanas, llega_semana: llegaSemana, siguiente };
}

async function hilo(productoId) {
  const d = await _datos();
  const filas = _analizar(d, _alcance(d, null));
  if (!filas.length) throw new AppError(404, 'NO_ENCONTRADO', 'Todavía no hay hilos con ventas ni existencias');
  const f = productoId
    ? filas.find((x) => x.id === Number(productoId))
    : [...filas].sort((a, b) => b.vendido_12m - a.vendido_12m)[0];
  if (!f) throw new AppError(404, 'NO_ENCONTRADO', 'Ese hilo no tiene ventas ni existencias');
  const { hoy, historia } = d;
  const total = filas.reduce((s, x) => s + x.vendido_12m, 0);
  const lugar = [...filas].sort((a, b) => b.vendido_12m - a.vendido_12m).findIndex((x) => x.id === f.id) + 1;
  const proy = _proyeccion(f, d);

  // Su temporada, con sus números.
  let temporada = null;
  if (f.indices) {
    const anual = f.base.reduce((s, b) => s + b.kg, 0);
    const mejorI = f.indices.indexOf(Math.max(...f.indices));
    const peorI = f.indices.indexOf(Math.min(...f.indices));
    const [ah] = c.anioMes(hoy);
    const delMes = (m) => [ah - 1, ah].map((a) => ({ anio: a, kg: _kgMes(f.serie, a, m + 1, historia) }))
      .filter((x) => x.kg != null).map((x) => ({ anio: x.anio, kg: Math.round(x.kg) }));
    temporada = {
      texto: f.temporada?.texto ?? 'Parejo todo el año',
      num_meses: f.temporada?.meses.length ?? 0,
      pct_del_anio: f.temporada && anual > 0
        ? Math.round((100 * f.temporada.meses.reduce((s, m) => s + f.base[m].kg, 0)) / anual) : null,
      mejor: { mes: mejorI + 1, indice: f.indices[mejorI], kg: delMes(mejorI) },
      peor: { mes: peorI + 1, indice: f.indices[peorI], kg: delMes(peorI) },
      veces_mejor_peor: f.base[peorI].kg > 0 ? c.r1(f.base[mejorI].kg / f.base[peorI].kg) : null,
    };
  }

  // En cada almacén: lo que hay y, en las tiendas, lo que vende (el pronóstico del
  // hilo repartido según lo que vendió cada tienda en los últimos 90 días).
  const hace90 = c.sumarDias(hoy, -DIAS_REPARTO_TIENDAS);
  const vendio90 = new Map();
  for (const v of d.ventas) if (v.hilo === f.id && v.dia >= hace90) vendio90.set(v.almacen, (vendio90.get(v.almacen) ?? 0) + v.kg);
  const total90 = [...vendio90.values()].reduce((s, x) => s + x, 0);
  const matriz = d.almacenes.find((a) => a.es_matriz && a.activo);
  const hayEn = (id) => _hayHoy(d, _alcance(d, id))(f.id);
  const unPaquete = Math.max(1, f.hay.peso_paquete ?? 1);
  const almacenes = d.almacenes.filter((a) => a.activo).map((a) => {
    const hayA = hayEn(a.id);
    const parte = a.vende && total90 > 0 ? (vendio90.get(a.id) ?? 0) / total90 : a.vende ? null : 0;
    const semana = a.vende && parte != null && f.se_vende_semana != null ? f.se_vende_semana * parte : null;
    const alcanza = semana > 0 ? hayA.kg / semana : null;
    let seAcaba = null;
    if (semana > 0 && f.modelo) {
      seAcaba = c.seAcabaEl(hayA.kg, { porDia: (dia) => f.modelo.porDia(dia) * parte }, hoy);
    }
    return {
      almacen_id: a.id, nombre: a.nombre, vende: a.vende, es_matriz: a.es_matriz,
      hay_kg: Math.round(hayA.kg), paquetes: hayA.paquetes,
      vende_semana: semana != null ? c.r1(semana) : null,
      alcanza_semanas: alcanza != null ? c.r1(alcanza) : null,
      se_acaba: seAcaba,
      // Solo se surte en paquetes: la matriz tiene que tener al menos uno.
      surtirle: !!(a.vende && alcanza != null && alcanza < 4 && matriz && matriz.id !== a.id && hayEn(matriz.id).kg >= unPaquete),
    };
  }).filter((a) => a.hay_kg > 0 || a.vende_semana > 0);
  const avisos = almacenes.filter((a) => a.surtirle).map((a) => ({
    almacen_id: a.almacen_id,
    texto: `${a.nombre} se queda sin ${f.color} hacia el ${c.fechaLarga(a.se_acaba, hoy)}. ${matriz.nombre} tiene ${Math.round(hayEn(matriz.id).kg).toLocaleString('es-MX')} kg para surtirle.`,
  }));

  // Cargas del proveedor y cada cuánto llegan.
  const cargas = await model.cargas(f.id);
  let cadaCuanto = null;
  if (cargas.length >= 2) {
    const meses = c.diasEntre(cargas[cargas.length - 1].fecha, cargas[0].fecha) / (cargas.length - 1) / 30.4;
    const a = Math.floor(meses);
    const b = Math.ceil(meses);
    cadaCuanto = meses < 1 ? 'Llega más de una vez al mes.' : a === b || meses - a < 0.25 ? `Llega cada ${a === 1 ? 'mes' : a + ' meses'}.`
      : b - meses < 0.25 ? `Llega cada ${b} meses.` : `Llega cada ${a} o ${b} meses.`;
  }

  // «¿Cómo se calcula?»: los números con que salió cada paso, de este hilo.
  const [ahE, mhE] = c.anioMes(hoy);
  const sig = mhE === 12 ? { anio: ahE + 1, mes: 1 } : { anio: ahE, mes: mhE + 1 };
  const baseSig = f.base[sig.mes - 1];
  const anualBase = f.indices ? f.base.reduce((s, b) => s + b.kg, 0) : null;
  const baseMejor = temporada ? f.base[temporada.mejor.mes - 1] : null;
  const explica = {
    modelo: f.modelo?.tipo ?? null,
    anual: anualBase != null ? Math.round(anualBase) : null,
    mes_normal: anualBase != null ? Math.round(anualBase / 12) : null,
    mejor: baseMejor ? { mes: temporada.mejor.mes, anio: baseMejor.anio, kg: Math.round(baseMejor.kg) } : null,
    siguiente: f.modelo?.tipo === 'temporada' && baseSig
      ? { mes: sig.mes, anio: sig.anio, base_anio: baseSig.anio, base_kg: Math.round(baseSig.kg), kg: Math.round(baseSig.kg * f.tendencia.valor) }
      : null,
    promedio_semana: f.modelo?.tipo === 'promedio' ? c.r1(f.modelo.porDia(hoy) * 7) : null,
  };

  return {
    hoy,
    historia: _historiaPublica(historia),
    ajustes: d.ajustes,
    hilos: _hilosPublicos(filas),
    explica,
    hilo: {
      ..._renglon(f, hoy),
      presentaciones: [f.por_tipo.paquete > 0 ? 'paquete' : null, f.por_tipo.cono > 0 ? 'cono' : null].filter(Boolean),
      pct_del_total: total > 0 ? c.r1((100 * f.vendido_12m) / total) : 0,
      lugar,
      tendencia: f.tendencia,
    },
    pedido_hoy: proy.pedido,
    meses: _mesesDosAnios(f.serie, f.modelo, d),
    temporada,
    proyeccion: { semanas: proy.semanas, llega_semana: proy.llega_semana, siguiente: proy.siguiente },
    almacenes,
    hay_sin_mostrador: d.almacenes.some((a) => a.activo && !a.vende),
    avisos,
    como_se_vende: {
      paquete: Math.round(f.por_tipo.paquete), cono: Math.round(f.por_tipo.cono), otro: Math.round(f.por_tipo.otro),
    },
    cargas: cargas.slice(0, 3).map(({ fecha, kg, almacen }) => ({ fecha, kg: Math.round(kg), almacen })),
    cada_cuanto: cadaCuanto,
  };
}

// --------------------------------------------------------------- QUÉ PEDIR

async function quePedir() {
  const d = await _datos();
  const filas = _analizar(d, _alcance(d, null)).filter((f) => f.estado !== 'sin_ventas').sort(porUrgencia);
  const ya = filas.filter((f) => f.estado === 'ya');
  const proximos = filas.filter((f) => ['ya', 'pronto'].includes(f.estado));
  const calma = filas.filter((f) => f.estado === 'calma');
  const sobra = filas.filter((f) => f.estado === 'sobra');
  return {
    hoy: d.hoy,
    historia: _historiaPublica(d.historia),
    ajustes: d.ajustes,
    hilos: filas.map((f) => _renglon(f, d.hoy)),
    totales: {
      ya: _sumaPedido(ya),
      proximos: _sumaPedido(proximos),
      calma: { hilos: calma.length, desde: calma[0]?.pedir ?? null, hasta: calma[calma.length - 1]?.pedir ?? null },
      sobra: {
        hilos: sobra.length,
        kg: Math.round(sobra.reduce((s, f) => s + f.hay.kg, 0)),
        uno: sobra.length === 1 ? { hilo: sobra[0].hilo, alcanza: _cuantoAlcanza(sobra[0].alcanza_semanas) } : null,
      },
    },
  };
}

/** El CSV para el proveedor (con BOM UTF-8: Excel lo abre directo). Sin precios. */
async function quePedirCsv(ids) {
  const r = await quePedir();
  const quiero = new Set(ids.map(Number));
  const filas = r.hilos.filter((h) => quiero.has(h.producto_id) && h.pedido && h.pedido.kg > 0);
  const celda = (v) => {
    // Un texto que empieza con = + - @ Excel lo tomaría como fórmula: va con ' delante.
    const s = v == null ? '' : typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [
    ['Hilo', 'Calibre', 'Material', 'Kilos a pedir', 'Paquetes aprox.', 'Pedir a más tardar'],
    ...filas.map((h) => [h.color, h.calibre, h.material ?? '', h.pedido.kg, h.pedido.paquetes ?? '', h.pedir ?? '']),
  ];
  return '﻿' + lineas.map((l) => l.map(celda).join(',')).join('\r\n') + '\r\n';
}

// --------------------------------------------------------------- AJUSTES

async function ajustes() {
  return model.ajustes();
}

async function guardarAjustes(a) {
  await model.guardarAjustes(a);
  return model.ajustes();
}

module.exports = { resumen, temporadas, hilo, quePedir, quePedirCsv, ajustes, guardarAjustes, _historia, _analizar };
