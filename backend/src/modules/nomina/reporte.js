'use strict';

/**
 * La NÓMINA de la semana en PDF (2026-10-07: "se requiere un reporte de nómina,
 * pero quiero un PDF con diseño"). Lleva:
 *
 *   · el RESUMEN de la semana: cuánto se paga en sueldos, comisiones, extras y
 *     descuentos, y la tabla de todos, con su total y dónde firman quien la
 *     hizo y quien la autorizó;
 *   · el REPORTE DE COMISIONES (2026-10-07: "qué se está pagando de cada
 *     venta, por semana"): por vendedor, cada venta cuya comisión paga esta
 *     nómina y lo que todavía tiene por liquidar;
 *   · un RECIBO por persona, en su hoja: lo que gana y lo que se le descuenta,
 *     lo que se le paga con número y con letra, su semana (horario, vacaciones,
 *     horas extra), su comisión por tipo de venta y la línea para firmar de
 *     recibido.
 *
 * Con `usuarioId` sale solo el recibo de esa persona. Se arma al momento con la
 * base, como los demás reportes: el recibo dice lo que quedó guardado (en una
 * semana pagada, congelado) y la tabla de ventas se lee viva, así que si alguna
 * venta cambió después de calcular la nómina, el recibo lo avisa.
 *
 * La comisión es sobre la VENTA NETA (subtotal − descuento): sin IVA ni envío,
 * y se paga la semana en que la venta queda LIQUIDADA (comisiones.js). El recibo
 * dice qué ventas paga y cuáles faltan por liquidar.
 */

const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const pdf = require('../../utils/pdf');
const { pesos } = require('../../utils/letras');
const jornada = require('./jornada');
const model = require('./model');
const comisiones = require('./comisiones');

const C = {
  ...pdf.COLOR,
  superficie: '#FAFBFC',
  acentoSuave: '#E8EEFB',
  okF: '#E6F4EC', okT: '#17663F',
  avisoF: '#FDF1DC', avisoT: '#7A4A00',
  peligroF: '#FBE4E2', peligroT: '#A12318',
  neutroF: '#EEF0F3',
  sobreOscuro: '#C9CDD6',
};
const M = 40;
const ALTO_PIE = 28;

const ESTADO = {
  borrador: { texto: 'BORRADOR', fondo: C.avisoF, tinta: C.avisoT },
  pagado: { texto: 'PAGADA', fondo: C.okF, tinta: C.okT },
  cancelado: { texto: 'CANCELADA', fondo: C.peligroF, tinta: C.peligroT },
};

const DIA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const n = (v) => Number(v ?? 0);
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// ------------------------------------------------------------------ fechas

const partes = (iso) => String(iso).slice(0, 10).split('-').map(Number);

/** '2026-10-06' → 'lun 6 oct'. */
function diaCorto(iso) {
  const [, m, d] = partes(iso);
  return `${DIA_CORTO[jornada.diaSemana(iso)].toLowerCase()} ${d} ${MES_CORTO[m - 1]}`;
}

/** "Del domingo 4 al sábado 10 de octubre de 2026" (o con los dos meses / años). */
function rangoLargo(ini, fin) {
  const [a1, m1, d1] = partes(ini);
  const [a2, m2, d2] = partes(fin);
  const desde = a1 !== a2 ? `${d1} de ${MES[m1 - 1]} de ${a1}` : m1 !== m2 ? `${d1} de ${MES[m1 - 1]}` : `${d1}`;
  return `Del domingo ${desde} al sábado ${d2} de ${MES[m2 - 1]} de ${a2}`;
}

/** "4 al 10 oct 2026": para el nombre del archivo y el pie. */
function rangoCorto(ini, fin) {
  const [, m1, d1] = partes(ini);
  const [a2, m2, d2] = partes(fin);
  return m1 === m2 ? `${d1} al ${d2} ${MES_CORTO[m2 - 1]} ${a2}` : `${d1} ${MES_CORTO[m1 - 1]} al ${d2} ${MES_CORTO[m2 - 1]} ${a2}`;
}

/** "sábado 10 de octubre de 2026". */
function diaLargo(iso) {
  const [a, m, d] = partes(iso);
  return `${jornada.DIAS[jornada.diaSemana(iso)]} ${d} de ${MES[m - 1]} de ${a}`;
}

/** 1.5 → "1 h 30 min". */
function horas(h) {
  const min = Math.round(n(h) * 60);
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return [hh ? `${hh} h` : '', mm ? `${mm} min` : ''].filter(Boolean).join(' ') || '0 h';
}

/** Lo que se resta, con su signo; sin nada, una raya. */
const menos = (v) => (n(v) > 0.004 ? `-${pdf.dinero(v)}` : '—');
/** "POS-1790864580000-79FA" → "POS-79FA", como en las listas de la pantalla. */
const folioCorto = (f) => String(f ?? '').replace(/^([A-Z]+)-\d{10,}-/, '$1-');
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const num = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });

// ------------------------------------------------------------------ dibujo

function ancho(doc) {
  return doc.page.width - M * 2;
}
function fondoUtil(doc) {
  return doc.page.height - M - ALTO_PIE;
}

/**
 * Texto en una posición fija y en UN renglón: lo que no cabe en `width` se corta
 * con "…" (si pdfkit lo partiera, el segundo renglón se encimaría en lo de abajo).
 */
function t(doc, texto, x, y, o = {}) {
  const { size = 10, bold = false, color = C.tinta, width, align = 'left', espacio = 0 } = o;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
  let s = String(texto ?? '');
  const mide = (v) => doc.widthOfString(v, { characterSpacing: espacio });
  if (width && mide(s) > width) {
    while (s.length > 1 && mide(`${s}…`) > width) s = s.slice(0, -1);
    s = `${s.trimEnd()}…`;
  }
  doc.text(s, x, y, { width, align, characterSpacing: espacio, lineBreak: false });
}

/** La franja de color de arriba: la marca de todas las hojas. */
function banda(doc) {
  doc.rect(0, 0, doc.page.width, 6).fill(C.acento);
}

function pastilla(doc, texto, derecha, y, fondo, tinta) {
  doc.font('Helvetica-Bold').fontSize(8);
  const w = doc.widthOfString(texto, { characterSpacing: 0.8 }) + 18;
  doc.roundedRect(derecha - w, y, w, 18, 9).fill(fondo);
  t(doc, texto, derecha - w, y + 5.2, { size: 8, bold: true, color: tinta, width: w, align: 'center', espacio: 0.8 });
}

/** Encabezado de una hoja: etiqueta, título, subtítulo y el estado de la nómina. */
function cabecera(doc, { etiqueta, titulo, subtitulo, estado }) {
  banda(doc);
  const w = ancho(doc);
  t(doc, `TIENDA DE HILOS  ·  ${etiqueta}`, M, M, { size: 8, color: C.tinta3, espacio: 1.2, width: w - 110 });
  const e = ESTADO[estado];
  if (e) pastilla(doc, e.texto, M + w, M - 4, e.fondo, e.tinta);
  t(doc, titulo, M, M + 16, { size: 22, bold: true, width: w });
  t(doc, subtitulo, M, M + 46, { size: 10.5, color: C.tinta3, width: w });
  const y = M + 68;
  doc.moveTo(M, y).lineTo(M + w, y).lineWidth(0.8).strokeColor(C.borde).stroke();
  doc.y = y + 16;
}

function tituloSeccion(doc, texto, derecha) {
  // Un título no se queda solo al pie de la hoja.
  if (doc.y + 70 > fondoUtil(doc)) {
    doc.addPage();
    banda(doc);
    doc.y = M;
  }
  const y = doc.y;
  t(doc, texto.toUpperCase(), M, y, { size: 8, bold: true, color: C.tinta2, espacio: 1 });
  if (derecha) t(doc, derecha, M, y, { size: 8.5, color: C.tinta3, width: ancho(doc), align: 'right' });
  doc.y = y + 15;
}

function nota(doc, texto, { color = C.tinta3, size = 8.5 } = {}) {
  doc.font('Helvetica').fontSize(size).fillColor(color)
    .text(texto, M, doc.y, { width: ancho(doc), lineGap: 1.5 });
  doc.y += 6;
}

/**
 * Cajas con una cifra grande. La última puede ir rellena (el total).
 * `lista`: [{ etiqueta, valor, pie, relleno }].
 */
function cifras(doc, lista) {
  const gap = 10;
  const w = (ancho(doc) - gap * (lista.length - 1)) / lista.length;
  const h = 66;
  const y = doc.y;
  lista.forEach((c, i) => {
    const x = M + i * (w + gap);
    if (c.relleno) {
      doc.roundedRect(x, y, w, h, 7).fill(C.acento);
    } else {
      doc.roundedRect(x, y, w, h, 7).lineWidth(0.8).strokeColor(C.borde).stroke();
    }
    const claro = c.relleno;
    t(doc, c.etiqueta.toUpperCase(), x + 12, y + 11, { size: 7.5, bold: true, color: claro ? C.acentoSuave : C.tinta3, width: w - 24, espacio: 0.8 });
    t(doc, c.valor, x + 12, y + 25, { size: 16, bold: true, color: claro ? '#FFFFFF' : C.tinta, width: w - 24 });
    if (c.pie) t(doc, c.pie, x + 12, y + 47, { size: 8, color: claro ? C.acentoSuave : C.tinta3, width: w - 24 });
  });
  doc.y = y + h + 18;
}

/**
 * Una tabla con celdas de uno o dos renglones. Cada celda es texto o
 * `{ t, sub, bold, color }`. Si no cabe sigue en la hoja siguiente con su
 * encabezado. `total` va al final en negritas, sobre una raya.
 */
function tabla(doc, columnas, filas, { total = null } = {}) {
  const w = ancho(doc);
  const suma = columnas.reduce((s, c) => s + c.ancho, 0);
  const anchos = columnas.map((c) => (c.ancho / suma) * w);
  const pad = 6;
  const celda = (v) => (v !== null && typeof v === 'object' ? v : { t: v });

  const encabezado = () => {
    const y = doc.y;
    doc.rect(M, y, w, 20).fill(C.fondo);
    let x = M;
    columnas.forEach((c, i) => {
      t(doc, c.titulo.toUpperCase(), x + pad, y + 6.5, {
        size: 7, bold: true, color: C.tinta2, width: anchos[i] - pad * 2, align: c.alin ?? 'left', espacio: 0.6,
      });
      x += anchos[i];
    });
    doc.y = y + 20;
  };

  const fila = (valores, { negrita = false, cebra = false } = {}) => {
    const cs = valores.map(celda);
    const conSub = cs.some((c) => c.sub);
    const alto = pad * 2 + 11 + (conSub ? 11 : 0);
    if (doc.y + alto > fondoUtil(doc)) {
      doc.addPage();
      banda(doc);
      doc.y = M;
      encabezado();
    }
    const y = doc.y;
    if (cebra) doc.rect(M, y, w, alto).fill(C.superficie);
    if (negrita) doc.moveTo(M, y).lineTo(M + w, y).lineWidth(1).strokeColor(C.tinta2).stroke();
    let x = M;
    cs.forEach((c, i) => {
      const o = { width: anchos[i] - pad * 2, align: columnas[i].alin ?? 'left' };
      t(doc, c.t, x + pad, y + pad, { ...o, size: 9, bold: negrita || c.bold, color: c.color ?? C.tinta });
      if (c.sub) t(doc, c.sub, x + pad, y + pad + 12, { ...o, size: 7.5, color: c.subColor ?? C.tinta3 });
      x += anchos[i];
    });
    doc.y = y + alto;
    if (!negrita) doc.moveTo(M, doc.y).lineTo(M + w, doc.y).lineWidth(0.5).strokeColor(C.bordeSuave).stroke();
  };

  encabezado();
  filas.forEach((f, i) => fila(f, { cebra: i % 2 === 1 }));
  if (total) fila(total, { negrita: true });
  doc.y += 12;
}

/** Una raya para firmar con el nombre abajo. */
function firma(doc, x, y, w, nombre, rol) {
  doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.8).strokeColor(C.tinta2).stroke();
  t(doc, nombre, x, y + 6, { size: 9.5, bold: true, width: w, align: 'center' });
  if (rol) t(doc, rol, x, y + 19, { size: 8, color: C.tinta3, width: w, align: 'center' });
}

// ------------------------------------------------------------------ datos

async function _datos(periodoId, usuarioId) {
  const periodo = await model.obtenerPeriodo(periodoId);
  if (!periodo) throw new AppError(404, 'NO_ENCONTRADO', 'Periodo de nómina no encontrado');
  let recibos = await model.listarRecibos(periodoId);
  if (usuarioId) {
    recibos = recibos.filter((r) => Number(r.usuario_id) === Number(usuarioId));
    if (!recibos.length) throw new AppError(404, 'NO_ENCONTRADO', 'Esa persona no tiene recibo en esta semana');
  }
  if (!recibos.length) {
    throw new AppError(409, 'SIN_RECIBOS', 'Esta nómina todavía no se calcula: calcúlala para sacar el PDF.');
  }
  const ids = recibos.map((r) => r.usuario_id);

  // Las ventas cuya comisión paga cada recibo, y lo que le falta por liquidar.
  const reporte = await comisiones.reporte(periodo, { usuarioId });
  const [vacaciones] = await pool.query(
    `SELECT usuario_id, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS desde, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS hasta
       FROM nomina_vacaciones
      WHERE usuario_id IN (:ids) AND fecha_inicio <= :fin AND fecha_fin >= :ini`,
    { ids, ini: periodo.fecha_inicio, fin: periodo.fecha_fin }
  );
  const [[quien]] = await pool.query(
    `SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS ahora, (SELECT nombre FROM usuarios WHERE id = :u) AS usuario`,
    { u: periodo.creado_por ?? 0 }
  );
  for (const r of recibos) {
    r.comisiones = reporte.vendedores.find((v) => v.usuario_id === Number(r.usuario_id)) ?? null;
    r.reglaAnterior = reporte.regla === 'anterior';
    r.vacaciones = vacaciones.filter((v) => Number(v.usuario_id) === Number(r.usuario_id));
  }
  return { periodo, recibos, ahora: quien.ahora, elaboro: quien.usuario };
}

// ------------------------------------------------------------------ resumen

/** La celda "Extras / desc.": lo que se suma arriba (verde) y lo que se descuenta abajo (rojo). */
function extrasYDescuentos(extras, descuentos) {
  const mas = n(extras) ? `+${pdf.dinero(extras)}` : '';
  const menos = n(descuentos) ? `-${pdf.dinero(descuentos)}` : '';
  if (!mas && !menos) return { t: '—', color: C.tinta3 };
  return mas
    ? { t: mas, color: C.okT, sub: menos, subColor: C.peligroT }
    : { t: menos, color: C.peligroT };
}

function hojaResumen(doc, periodo, recibos, elaboro) {
  const p = periodo;
  cabecera(doc, {
    etiqueta: 'NÓMINA SEMANAL',
    titulo: 'Nómina de la semana',
    subtitulo: `${rangoLargo(p.fecha_inicio, p.fecha_fin)}  ·  se paga el ${diaLargo(p.fecha_pago).replace(/ de \d{4}$/, '')}`,
    estado: p.estado,
  });

  const s = (f) => r2(recibos.reduce((a, r) => a + f(r), 0));
  const sueldos = s((r) => n(r.sueldo_base) + n(r.pago_vacaciones));
  const vac = s((r) => n(r.pago_vacaciones));
  const comisiones = s((r) => n(r.comision));
  const ventas = s((r) => n(r.ventas_netas));
  const extras = s((r) => n(r.otras_percepciones));
  const descuentos = s((r) => n(r.deducciones));
  const total = s((r) => n(r.total_pagar));

  cifras(doc, [
    { etiqueta: 'Sueldos', valor: pdf.dinero(sueldos), pie: vac > 0 ? `con ${pdf.dinero(vac)} de vacaciones` : `${recibos.length} ${recibos.length === 1 ? 'persona' : 'personas'}` },
    { etiqueta: 'Comisiones', valor: pdf.dinero(comisiones), pie: `sobre ${pdf.dinero(ventas)} netos` },
    { etiqueta: 'Extras - desc.', valor: `${extras - descuentos < 0 ? '-' : '+'}${pdf.dinero(Math.abs(extras - descuentos))}`, pie: `+${pdf.dinero(extras)} / -${pdf.dinero(descuentos)}` },
    { etiqueta: p.estado === 'cancelado' ? 'Total (no se paga)' : 'Total a pagar', valor: pdf.dinero(total), pie: p.estado === 'pagado' ? 'ya se pagó' : `el ${diaCorto(p.fecha_pago)}`, relleno: true },
  ]);

  tituloSeccion(doc, 'Recibos de la semana', `${recibos.length} ${recibos.length === 1 ? 'recibo' : 'recibos'}`);
  tabla(
    doc,
    [
      { titulo: 'Empleado', ancho: 3 },
      { titulo: 'Días', ancho: 1.5, alin: 'right' },
      { titulo: 'Sueldo', ancho: 1.5, alin: 'right' },
      { titulo: 'Comisión', ancho: 1.8, alin: 'right' },
      { titulo: 'Extras / desc.', ancho: 1.6, alin: 'right' },
      { titulo: 'A pagar', ancho: 1.6, alin: 'right' },
    ],
    recibos.map((r) => {
      const conHorario = r.dias_laborales !== null;
      const faltas = conHorario ? Math.max(0, n(r.dias_laborales) - n(r.dias_vacaciones) - n(r.dias_trabajados)) : 0;
      const pct = n(r.porcentaje_comision);
      return [
        { t: r.usuario, bold: true, sub: capital(r.rol) },
        conHorario
          ? { t: `${num(r.dias_trabajados)} de ${num(r.dias_laborales)}`, sub: n(r.dias_vacaciones) > 0 ? `${num(r.dias_vacaciones)} de vacaciones` : faltas > 0 ? `faltó ${num(faltas)}` : '' }
          : { t: 'semana', sub: 'sin horario' },
        { t: pdf.dinero(n(r.sueldo_base) + n(r.pago_vacaciones)), sub: n(r.pago_vacaciones) > 0 ? `vac. ${pdf.dinero(r.pago_vacaciones)}` : '' },
        pct > 0
          ? { t: pdf.dinero(r.comision), sub: `${num(pct)}% de ${pdf.dinero(r.ventas_netas)}` }
          : { t: '—', sub: 'sin comisión', color: C.tinta3 },
        extrasYDescuentos(r.otras_percepciones, r.deducciones),
        { t: pdf.dinero(r.total_pagar), bold: true },
      ];
    }),
    {
      total: ['Total', '', pdf.dinero(sueldos), pdf.dinero(comisiones), extrasYDescuentos(extras, descuentos), pdf.dinero(total)],
    }
  );

  nota(doc, 'La comisión es sobre la VENTA NETA (subtotal menos descuento): sin IVA ni envío —lo que se cobra por ' +
    'llevar un pedido no cuenta—, y sin lo cancelado ni lo devuelto. Cada venta paga su comisión UNA vez, la semana ' +
    'en que queda liquidada: la de contado, el día que se vende; la fiada, el apartado y el pedido, cuando se ' +
    'terminan de pagar. El sueldo se paga por los días que trabajó según su horario; las vacaciones, como días ' +
    'normales; la hora extra, al doble.');
  if (p.estado === 'borrador') {
    nota(doc, 'Borrador: las cifras pueden cambiar si se recalcula la nómina antes de pagarla.', { color: C.avisoT });
  }

  // Quién la hizo y quién la autoriza, abajo de la hoja.
  if (p.estado !== 'cancelado') {
    const y = Math.max(doc.y + 40, fondoUtil(doc) - 46);
    if (y + 34 <= fondoUtil(doc)) {
      const w = (ancho(doc) - 60) / 2;
      firma(doc, M, y, w, elaboro || ' ', 'Elaboró');
      firma(doc, M + w + 60, y, w, ' ', 'Autorizó');
    }
  }
}

// ------------------------------------------------------------------ comisiones

const COLS_PAGADAS = [
  { titulo: 'Venta', ancho: 2.3 },
  { titulo: 'Tipo', ancho: 1.5 },
  { titulo: 'Quedó pagada', ancho: 1.4 },
  { titulo: 'Total', ancho: 1.3, alin: 'right' },
  { titulo: 'Venta neta', ancho: 1.4, alin: 'right' },
  { titulo: 'Comisión', ancho: 1.3, alin: 'right' },
];
const COLS_PENDIENTES = [
  { titulo: 'Venta', ancho: 2.3 },
  { titulo: 'Tipo', ancho: 1.5 },
  { titulo: 'Total', ancho: 1.4, alin: 'right' },
  { titulo: 'Pagado', ancho: 1.3, alin: 'right' },
  { titulo: 'Debe', ancho: 1.4, alin: 'right' },
  { titulo: 'Comisión', ancho: 1.3, alin: 'right' },
];

/** El folio corto y el cliente; el tipo y cuándo se vendió. */
const ventaYTipo = (v) => [
  { t: folioCorto(v.numero_pedido), sub: v.cliente ?? 'sin cliente' },
  { t: comisiones.NOMBRE_TIPO[v.tipo] ?? v.tipo, sub: `vendida ${diaCorto(v.vendida_en)}` },
];

/**
 * Qué venta paga cada quien en esta nómina y qué le falta por liquidar, venta
 * por venta. En el PDF de la semana va después del resumen; en el de una
 * persona, detrás de su recibo.
 */
function hojaComisiones(doc, periodo, recibos, { reglaAnterior }) {
  const p = periodo;
  cabecera(doc, {
    etiqueta: 'REPORTE DE COMISIONES',
    titulo: 'Comisiones de la semana',
    subtitulo: rangoLargo(p.fecha_inicio, p.fecha_fin),
    estado: p.estado,
  });
  nota(doc, reglaAnterior
    ? 'Esta semana se pagó con la regla anterior: la comisión de cada venta, en la semana en que se vendió.'
    : 'Cada venta paga su comisión UNA vez, completa, en la nómina de la semana en que quedó pagada: la de ' +
      'contado, el día que se vende; la fiada, el apartado y el pedido, cuando se terminan de pagar. Lo que se ' +
      'liquida en una semana ya cerrada entra en la siguiente. Sobre la venta neta: sin IVA ni envío.');
  doc.y += 6;

  const sinComision = [];
  for (const r of recibos) {
    const cm = r.comisiones;
    const pct = n(r.porcentaje_comision);
    if (!cm || (pct === 0 && !cm.ventas.length && !cm.por_liquidar.length)) {
      sinComision.push(r.usuario);
      continue;
    }
    tituloSeccion(doc, `${r.usuario}  ·  ${pct > 0 ? num(pct) + '%' : 'sin comisión'}`,
      `${cm.ventas.length} ${cm.ventas.length === 1 ? 'venta' : 'ventas'} · ${pdf.dinero(cm.ventas_netas)} · comisión ${pdf.dinero(cm.comision)}`);
    if (!cm.ventas.length) {
      nota(doc, 'Ninguna venta suya quedó pagada esta semana.');
    } else {
      const sum = (k) => r2(cm.ventas.reduce((a, v) => a + n(v[k]), 0));
      tabla(doc, COLS_PAGADAS,
        cm.ventas.map((v) => [
          ...ventaYTipo(v),
          v.liquidada_en ? diaCorto(v.liquidada_en) : { t: 'al venderla', sub: 'regla anterior' },
          pdf.dinero(v.total),
          pdf.dinero(v.venta_neta),
          { t: pdf.dinero(v.comision), bold: true },
        ]),
        { total: ['Se paga', `${cm.ventas.length} ${cm.ventas.length === 1 ? 'venta' : 'ventas'}`, '', pdf.dinero(sum('total')), pdf.dinero(sum('venta_neta')), pdf.dinero(sum('comision'))] }
      );
    }
    if (cm.por_liquidar.length) {
      tituloSeccion(doc, `Por liquidar al día de hoy · ${r.usuario}`, `${pdf.dinero(cm.por_liquidar_comision)} de comisión al liquidarse`);
      tabla(doc, COLS_PENDIENTES,
        cm.por_liquidar.map((v) => [
          ...ventaYTipo(v),
          pdf.dinero(v.total),
          pdf.dinero(v.pagado),
          { t: pdf.dinero(v.falta), color: C.peligroT },
          { t: pdf.dinero(v.comision), color: C.tinta3 },
        ]),
        { total: ['Pendiente', `${cm.por_liquidar.length}`, '', '', pdf.dinero(cm.por_liquidar_debe), pdf.dinero(cm.por_liquidar_comision)] }
      );
    }
    if (cm.proxima_nomina.ventas > 0) {
      nota(doc, `${cm.proxima_nomina.ventas} ${cm.proxima_nomina.ventas === 1 ? 'venta ya pagada entra' : 'ventas ya pagadas entran'} ` +
        `en la próxima nómina que se calcule (${pdf.dinero(cm.proxima_nomina.comision)} de comisión).`);
    }
    doc.y += 8;
  }
  if (sinComision.length) nota(doc, `Sin comisión ni ventas esta semana: ${sinComision.join(', ')}.`);
}

// ------------------------------------------------------------------ recibo

function hojaRecibo(doc, periodo, r) {
  const p = periodo;
  cabecera(doc, {
    etiqueta: 'RECIBO DE NÓMINA',
    titulo: r.usuario,
    subtitulo: `${capital(r.rol)}  ·  ${rangoLargo(p.fecha_inicio, p.fecha_fin)}`,
    estado: p.estado,
  });

  const conHorario = r.dias_laborales !== null;
  const faltas = conHorario ? Math.max(0, n(r.dias_laborales) - n(r.dias_vacaciones) - n(r.dias_trabajados)) : 0;
  const pct = n(r.porcentaje_comision);
  const extras = r.conceptos.filter((c) => c.clave === 'horas_extra');
  const otros = r.conceptos.filter((c) => c.clave !== 'horas_extra');

  // ---- Percepciones y deducciones, una junto a la otra.
  const percepciones = [];
  percepciones.push({
    que: 'Sueldo',
    como: conHorario
      ? `${num(r.dias_trabajados)} de ${num(r.dias_laborales)} días × ${pdf.dinero(r.salario_diario)}${faltas > 0 ? ` · faltó ${num(faltas)}` : ''}`
      : 'la semana completa (no tiene horario)',
    importe: n(r.sueldo_base),
  });
  if (n(r.dias_vacaciones) > 0) {
    percepciones.push({
      que: 'Vacaciones',
      como: `${num(r.dias_vacaciones)} ${n(r.dias_vacaciones) === 1 ? 'día' : 'días'} × ${pdf.dinero(r.salario_diario)}`,
      importe: n(r.pago_vacaciones),
    });
  }
  if (pct > 0) {
    percepciones.push({ que: 'Comisión', como: `${num(pct)}% de ${pdf.dinero(r.ventas_netas)} de venta neta`, importe: n(r.comision) });
  }
  for (const c of extras) {
    const cuando = [c.fecha ? diaCorto(c.fecha) : '', horas(c.cantidad), c.hora_entrada ? `entró ${c.hora_entrada}` : '', c.hora_salida ? `salió ${c.hora_salida}` : '']
      .filter(Boolean).join(' · ');
    percepciones.push({ que: 'Horas extra', como: `${cuando} · al doble`, importe: n(c.importe) });
  }
  for (const c of otros.filter((x) => x.tipo === 'percepcion')) {
    percepciones.push({ que: c.descripcion || 'Otro', como: '', importe: n(c.importe) });
  }
  const NOMBRE = { falta: 'Falta', descuento: 'Descuento', otro: 'Otro' };
  const deducciones = otros.filter((x) => x.tipo === 'deduccion').map((c) => ({
    que: NOMBRE[c.clave] ?? 'Descuento',
    como: c.descripcion ?? '',
    importe: n(c.importe),
  }));

  const gap = 14;
  const w = (ancho(doc) - gap) / 2;
  const altoRenglon = (x) => (x.como ? 28 : 20);
  const altoLista = (lista) => (lista.length ? lista.reduce((s, x) => s + altoRenglon(x), 0) : 22);
  const h = 30 + Math.max(altoLista(percepciones), altoLista(deducciones)) + 34;
  const y0 = doc.y;
  const caja = (x, titulo, lista, signo, color, vacio) => {
    doc.roundedRect(x, y0, w, h, 8).lineWidth(0.8).strokeColor(C.borde).stroke();
    t(doc, titulo.toUpperCase(), x + 14, y0 + 13, { size: 7.5, bold: true, color: C.tinta2, espacio: 1 });
    let y = y0 + 32;
    if (!lista.length) {
      t(doc, vacio, x + 14, y, { size: 9, color: C.tinta3, width: w - 28 });
    }
    for (const it of lista) {
      t(doc, it.que, x + 14, y, { size: 9.5, bold: true, width: w - 120 });
      t(doc, `${signo}${pdf.dinero(it.importe)}`, x + 14, y, { size: 9.5, width: w - 28, align: 'right', color });
      if (it.como) t(doc, it.como, x + 14, y + 13, { size: 8, color: C.tinta3, width: w - 28 });
      y += altoRenglon(it);
    }
    const suma = r2(lista.reduce((s, it) => s + it.importe, 0));
    const yt = y0 + h - 26;
    doc.moveTo(x + 14, yt - 6).lineTo(x + w - 14, yt - 6).lineWidth(0.5).strokeColor(C.borde).stroke();
    t(doc, `Total ${titulo.toLowerCase()}`, x + 14, yt, { size: 9, color: C.tinta2 });
    t(doc, `${suma > 0 ? signo : ''}${pdf.dinero(suma)}`, x + 14, yt, { size: 10, bold: true, width: w - 28, align: 'right', color: suma > 0 ? color : C.tinta });
  };
  caja(M, 'Percepciones', percepciones, '', C.tinta, '');
  caja(M + w + gap, 'Deducciones', deducciones, '-', C.peligroT, 'Sin descuentos esta semana.');
  doc.y = y0 + h + 12;

  // ---- Lo que se le paga, con número y con letra.
  const total = n(r.total_pagar);
  const yn = doc.y;
  doc.roundedRect(M, yn, ancho(doc), 56, 8).fill(p.estado === 'cancelado' ? C.tinta3 : C.tinta);
  t(doc, p.estado === 'cancelado' ? 'NO SE PAGA: LA NÓMINA SE CANCELÓ' : 'A PAGAR', M + 16, yn + 10, { size: 7.5, bold: true, color: C.sobreOscuro, espacio: 1 });
  t(doc, pdf.dinero(total), M + 16, yn + 22, { size: 20, bold: true, color: '#FFFFFF' });
  t(doc, total < 0 ? 'Saldo en contra: los descuentos pasan de lo que gana esta semana.' : pesos(total),
    M + 190, yn + 28, { size: 9, color: C.sobreOscuro, width: ancho(doc) - 206, align: 'right' });
  doc.y = yn + 56 + 16;

  // ---- La semana: su horario día por día, con vacaciones y horas extra.
  if (conHorario) {
    const valorHora = n(r.valor_hora);
    tituloSeccion(doc, 'Su semana', `día ${pdf.dinero(r.salario_diario)} · hora ${pdf.dinero(valorHora)} · extra ${pdf.dinero(valorHora * 2)}`);
    const gapD = 6;
    const wd = (ancho(doc) - gapD * 6) / 7;
    const hd = 48;
    const yd = doc.y;
    for (let i = 0; i < 7; i++) {
      const fecha = jornada.sumarDias(p.fecha_inicio, i);
      const turno = r.horario.find((d) => Number(d.dia_semana) === i);
      const deVacaciones = turno && r.vacaciones.some((v) => v.desde <= fecha && fecha <= v.hasta);
      const extra = extras.filter((c) => c.fecha === fecha).reduce((s, c) => s + n(c.cantidad), 0);
      const x = M + i * (wd + gapD);
      if (deVacaciones) doc.roundedRect(x, yd, wd, hd, 6).fill(C.okF);
      else if (!turno) doc.roundedRect(x, yd, wd, hd, 6).fill(C.neutroF);
      else doc.roundedRect(x, yd, wd, hd, 6).lineWidth(0.8).strokeColor(C.borde).stroke();
      const [, , d] = partes(fecha);
      t(doc, `${DIA_CORTO[i]} ${d}`, x, yd + 8, { size: 9, bold: true, width: wd, align: 'center', color: turno ? C.tinta : C.tinta3 });
      t(doc, deVacaciones ? 'Vacaciones' : turno ? `${turno.hora_entrada} a ${turno.hora_salida}` : 'Descanso', x, yd + 23,
        { size: 7.5, width: wd, align: 'center', color: deVacaciones ? C.okT : C.tinta3 });
      if (extra > 0) t(doc, `+${horas(extra)} extra`, x, yd + 35, { size: 7.5, bold: true, width: wd, align: 'center', color: C.acento });
    }
    doc.y = yd + hd + 8;
    nota(doc, `Trabajó ${num(r.dias_trabajados)} de ${num(r.dias_laborales)} días` +
      (n(r.dias_vacaciones) > 0 ? ` · ${num(r.dias_vacaciones)} de vacaciones` : '') +
      (faltas > 0 ? ` · faltó ${num(faltas)} (cada falta descuenta un día)` : '') + '.');
    doc.y += 4;
  }

  // ---- Su comisión, por tipo de venta (el detalle venta por venta va en el
  //      reporte de comisiones), y lo que le falta por liquidar.
  const cm = r.comisiones;
  if (cm && (pct > 0 || cm.ventas.length || cm.por_liquidar.length)) {
    tituloSeccion(doc, 'Comisión de la semana',
      pct > 0 ? `${num(pct)}% de cada venta que quedó pagada` : 'no recibe comisión');
    if (!cm.ventas.length) {
      nota(doc, r.reglaAnterior ? 'Sin ventas a su nombre esta semana.' : 'Ninguna venta suya quedó pagada esta semana.');
    } else {
      const QUE = {
        contado: 'de contado, pagadas al venderlas',
        credito: 'fiadas que se terminaron de pagar',
        apartado: 'apartados liquidados',
        pedido: 'pedidos pagados',
      };
      const grupos = ['contado', 'credito', 'apartado', 'pedido']
        .map((tipo) => ({ tipo, ventas: cm.ventas.filter((v) => v.tipo === tipo) }))
        .filter((g) => g.ventas.length);
      const sum = (lista, k) => r2(lista.reduce((a, v) => a + n(v[k]), 0));
      tabla(
        doc,
        [
          { titulo: 'Ventas', ancho: 3.2 },
          { titulo: 'Cuántas', ancho: 1, alin: 'right' },
          { titulo: 'Venta neta', ancho: 1.5, alin: 'right' },
          { titulo: 'Comisión', ancho: 1.4, alin: 'right' },
        ],
        grupos.map((g) => [
          `${comisiones.NOMBRE_TIPO[g.tipo]}  ·  ${r.reglaAnterior ? 'por la fecha de venta' : QUE[g.tipo]}`,
          String(g.ventas.length),
          pdf.dinero(sum(g.ventas, 'venta_neta')),
          { t: pdf.dinero(sum(g.ventas, 'comision')), bold: true },
        ]),
        { total: ['Total', String(cm.ventas.length), pdf.dinero(sum(cm.ventas, 'venta_neta')), pdf.dinero(sum(cm.ventas, 'comision'))] }
      );
    }
    const pendiente = [];
    if (cm.por_liquidar.length) {
      pendiente.push(`Por liquidar al día de hoy: ${cm.por_liquidar.length} ${cm.por_liquidar.length === 1 ? 'venta que debe' : 'ventas que deben'} ` +
        `${pdf.dinero(cm.por_liquidar_debe)}; su comisión de ${pdf.dinero(cm.por_liquidar_comision)} se paga la semana en que se terminen de pagar.`);
    }
    if (cm.proxima_nomina.ventas > 0) {
      pendiente.push(`${cm.proxima_nomina.ventas} ${cm.proxima_nomina.ventas === 1 ? 'venta ya pagada entra' : 'ventas ya pagadas entran'} ` +
        `en la próxima nómina que se calcule (${pdf.dinero(cm.proxima_nomina.comision)} de comisión).`);
    }
    if (pendiente.length) nota(doc, pendiente.join(' '));
  }

  // ---- Recibí. Va abajo de la hoja; si ya no cabe, en la siguiente.
  if (p.estado === 'cancelado') return;
  const altoFirma = 82;
  if (doc.y + altoFirma > fondoUtil(doc)) {
    doc.addPage();
    banda(doc);
    doc.y = M;
  }
  const yf = Math.max(doc.y + 8, fondoUtil(doc) - altoFirma);
  doc.font('Helvetica').fontSize(9).fillColor(C.tinta2).text(
    `Recibí ${pdf.dinero(total)} (${total < 0 ? 'saldo en contra' : pesos(total)}) por mi sueldo` +
      `${pct > 0 ? ' y comisiones' : ''} de la semana ${rangoLargo(p.fecha_inicio, p.fecha_fin).replace(/^Del/, 'del')}, ` +
      `que se paga el ${diaLargo(p.fecha_pago)}.`,
    M, yf, { width: ancho(doc), lineGap: 1.5 }
  );
  const wf = 230;
  firma(doc, M + ancho(doc) - wf, yf + 52, wf, r.usuario, 'Firma de recibido');
  t(doc, 'Fecha: ______________________', M, yf + 46, { size: 9, color: C.tinta2 });
}

// ------------------------------------------------------------------ armar

/**
 * El PDF de la nómina de una semana. Con `usuarioId`, solo el recibo de esa
 * persona. Devuelve `{ buffer, nombre }`.
 */
async function pdfNomina(periodoId, { usuarioId = null } = {}) {
  const { periodo, recibos, ahora, elaboro } = await _datos(periodoId, usuarioId);
  const doc = pdf.crear();
  doc.info.Title = usuarioId ? `Recibo de nómina · ${recibos[0].usuario}` : `Nómina ${rangoCorto(periodo.fecha_inicio, periodo.fecha_fin)}`;

  const reglaAnterior = recibos[0].reglaAnterior;
  const conComision = (r) => r.comisiones && (n(r.porcentaje_comision) > 0 || r.comisiones.ventas.length || r.comisiones.por_liquidar.length);
  if (!usuarioId) {
    hojaResumen(doc, periodo, recibos, elaboro);
    // El reporte de comisiones va después del resumen, si alguien cobra comisión.
    if (recibos.some(conComision)) {
      doc.addPage();
      hojaComisiones(doc, periodo, recibos, { reglaAnterior });
    }
  }
  recibos.forEach((r, i) => {
    if (i > 0 || !usuarioId) doc.addPage();
    hojaRecibo(doc, periodo, r);
  });
  // El recibo de una persona lleva detrás el detalle de sus comisiones.
  if (usuarioId && conComision(recibos[0])) {
    doc.addPage();
    hojaComisiones(doc, periodo, recibos, { reglaAnterior });
  }
  pdf.pie(doc, `Nómina ${rangoCorto(periodo.fecha_inicio, periodo.fecha_fin)}  ·  generada el ${pdf.fecha(ahora)}`);
  const buffer = await pdf.aBuffer(doc);
  const rango = rangoCorto(periodo.fecha_inicio, periodo.fecha_fin);
  return {
    buffer,
    nombre: usuarioId ? `Recibo ${recibos[0].usuario} ${rango}.pdf` : `Nómina ${rango}.pdf`,
  };
}

module.exports = { pdfNomina, rangoLargo, rangoCorto };
