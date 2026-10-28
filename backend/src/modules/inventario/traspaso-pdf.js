'use strict';

/**
 * LOS PDF DE SURTIR SUCURSAL (2026-10-20, usuario: "que dé PDF de lo que se
 * envía y de lo que se recibe"):
 *
 *   · `pdfEnvio(id)`      la hoja que va con la camioneta: de dónde a dónde, quién
 *                         lo pidió y quién lo surtió, qué se pidió contra lo que
 *                         salió, y cada paquete (código, lote, peso real y conos)
 *                         por hilo, con las rayas para firmar.
 *   · `pdfRecepcion(id)`  el acuse: quién lo recibió y cuándo, por hilo lo que se
 *                         envió, lo que llegó y lo que faltó (la merma), y cada
 *                         paquete con "Llegó" o "No llegó".
 *
 * Se arman al momento con la base (como los de las cargas): el traspaso guarda lo
 * pedido, lo que salió y lo que llegó por línea (`traspaso_detalle`), los paquetes
 * que viajaron (`traspaso_bultos`) y los que no llegaron quedan 'faltante' con el
 * envío en `consumido_id`. No llevan costo ni lo que hay en el origen (a quien solo
 * es del destino no se le dice: "surtir a ciegas").
 */

const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const pdf = require('../../utils/pdf');
const model = require('./model');

const PASO = {
  solicitado: 'Pedido, sin enviar',
  en_transito: 'En camino',
  recibido: 'Recibido',
  cancelado: 'Cancelado',
};

function nombreHilo(l) {
  return `${l.producto}${l.calibre ? ' ' + l.calibre : ''}`;
}

/** "ROJO 2/30 · ACRILAN · TURCO": con qué se distingue en la bodega. */
function etiqueta(l) {
  return [nombreHilo(l), l.material, l.linea].filter(Boolean).join(' · ');
}

function paquetes(n) {
  const v = Number(n ?? 0);
  return `${pdf.numero(v)} ${v === 1 ? 'paquete' : 'paquetes'}`;
}

/** Quién lo pide y la hora de la BASE (como en las cargas). */
async function quienYCuando(usuarioId) {
  const [[r]] = await pool.query(
    `SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS ahora,
            (SELECT nombre FROM usuarios WHERE id = :u) AS usuario`,
    { u: usuarioId ?? 0 }
  );
  return `Generado el ${pdf.fecha(r.ahora)}${r.usuario ? ' por ' + r.usuario : ''}`;
}

/**
 * El traspaso con sus líneas y, en cada una, los paquetes que viajaron (con su
 * lote, sus conos y si faltó al recibirlo).
 */
async function _traspaso(id) {
  const t = await model.obtenerTraspaso(id);
  if (!t) throw new AppError(404, 'NO_ENCONTRADO', 'Ese envío no existe');
  const lineas = t.lineas ?? [];
  for (const l of lineas) l.bultos = [];
  if (lineas.length) {
    const [rows] = await pool.query(
      // "No llegó" solo en ESTE envío: el mismo paquete pudo viajar antes en otro.
      `SELECT tb.detalle_id, vc.codigo, vc.peso_kg, vc.lote, vc.conos,
              (vc.estado = 'faltante' AND vc.consumido_tipo = 'traspaso' AND vc.consumido_id = td.traspaso_id) AS falto
         FROM traspaso_bultos tb
         JOIN traspaso_detalle td ON td.id = tb.detalle_id
         JOIN variante_codigos vc ON vc.id = tb.variante_codigo_id
        WHERE tb.detalle_id IN (:ids)
        ORDER BY vc.lote, vc.codigo`,
      { ids: lineas.map((l) => l.detalle_id) }
    );
    const porLinea = new Map(lineas.map((l) => [Number(l.detalle_id), l]));
    for (const r of rows) {
      porLinea.get(Number(r.detalle_id))?.bultos.push({ ...r, falto: Boolean(Number(r.falto)) });
    }
  }
  return t;
}

/** Los paquetes de un hilo por LOTE, como en la caja y en las cargas. */
function _porLote(bultos) {
  const m = new Map();
  for (const b of bultos) {
    const l = b.lote ?? null;
    if (!m.has(l)) m.set(l, []);
    m.get(l).push(b);
  }
  return [...m.entries()].map(([lote, lista]) => ({
    lote,
    bultos: lista,
    kg: Math.round(lista.reduce((s, b) => s + Number(b.peso_kg ?? 0), 0) * 1000) / 1000,
  }));
}

function _nombreLote(lote) {
  return lote ? `Lote ${lote}` : 'Sin lote';
}

/** "3 paquetes · 57.25 kg · Lote 0094853: 2 · Lote 0094860: 1". */
function _cifrasHilo(bultos) {
  const kg = Math.round(bultos.reduce((s, b) => s + Number(b.peso_kg ?? 0), 0) * 1000) / 1000;
  const lotes = _porLote(bultos);
  const partes = [paquetes(bultos.length), pdf.kg(kg)];
  if (lotes.length > 1) partes.push(lotes.map((g) => `${_nombreLote(g.lote)}: ${g.bultos.length}`).join(' · '));
  else if (lotes[0]?.lote) partes.push(_nombreLote(lotes[0].lote));
  return partes.join(' · ');
}

/** Lo pedido o lo que salió de una línea, en paquetes si así va; si no, en kilos. */
function _cuanto(paq, kg) {
  return paq != null ? paquetes(paq) : pdf.kg(kg);
}

const noSalio = (l) => Number(l.cantidad) === 0;

/** Los que viajaron por lote; para la recepción, con "Llegó" / "No llegó". */
function _tablaPaquetes(doc, l, { recepcion }) {
  const filas = [];
  let i = 0;
  for (const g of _porLote(l.bultos)) {
    for (const b of g.bultos) {
      i += 1;
      filas.push([
        String(i),
        b.codigo,
        b.lote ?? '',
        pdf.kg(b.peso_kg),
        b.conos != null ? String(b.conos) : '',
        ...(recepcion ? [b.falto ? 'NO LLEGÓ' : 'Llegó'] : []),
      ]);
    }
  }
  const kg = Math.round(l.bultos.reduce((s, b) => s + Number(b.peso_kg ?? 0), 0) * 1000) / 1000;
  const conos = l.bultos.reduce((s, b) => s + Number(b.conos ?? 0), 0);
  const faltaron = l.bultos.filter((b) => b.falto).length;
  pdf.tabla(
    doc,
    [
      { titulo: '#', ancho: 0.45, alin: 'right' },
      { titulo: 'Código del paquete', ancho: 1.9 },
      { titulo: 'Lote', ancho: 1.3 },
      { titulo: 'Peso real', ancho: 1.05, alin: 'right' },
      { titulo: 'Conos', ancho: 0.7, alin: 'right' },
      ...(recepcion ? [{ titulo: '¿Llegó?', ancho: 1 }] : []),
    ],
    filas,
    {
      total: [
        '', paquetes(l.bultos.length), '', pdf.kg(kg), conos ? String(conos) : '',
        ...(recepcion ? [faltaron ? `Faltaron ${faltaron}` : 'Todos'] : []),
      ],
    }
  );
}

/** Un envío de antes de escanear (o en kilos) no trae la lista de sus paquetes: se dice. */
function _notaSinLista(doc, salieron, verbo) {
  const sin = salieron.filter((l) => !l.bultos.length);
  if (!sin.length) return;
  pdf.nota(doc, sin.length === salieron.length
    ? `Este envío no trae la lista de sus paquetes (es de antes de que se escanearan al surtir): de cada hilo solo se sabe cuánto ${verbo}.`
    : `${sin.map(nombreHilo).join(', ')} no ${sin.length === 1 ? 'trae' : 'traen'} la lista de sus paquetes: solo se sabe cuánto ${verbo}.`);
}

/** Rayas para firmar, con el nombre (si se sabe) y para qué es cada una. */
function _firmas(doc, lista) {
  const M = doc.page.margins.left;
  const anchoUtil = doc.page.width - M * 2;
  const gap = 30;
  const w = (anchoUtil - gap * (lista.length - 1)) / lista.length;
  // Abajo de la hoja si cabe; si no, en una página aparte.
  const fondo = doc.page.height - M - 28;
  if (doc.y + 80 > fondo) doc.addPage();
  const y = Math.min(fondo - 36, doc.y + 50);
  lista.forEach(([nombre, rol], i) => {
    const x = M + i * (w + gap);
    doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.8).strokeColor(pdf.COLOR.tinta2).stroke();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(pdf.COLOR.tinta)
      .text(nombre || ' ', x, y + 6, { width: w, align: 'center', lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(8).fillColor(pdf.COLOR.tinta3)
      .text(rol, x, y + 19, { width: w, align: 'center', lineBreak: false });
  });
  doc.x = M;
  doc.y = y + 34;
}

// ------------------------------------------------------------------ el envío

async function pdfEnvio(id, { usuarioId }) {
  const t = await _traspaso(id);
  // Solo lo que va en camino o ya llegó. Uno cancelado en camino ya regresó al
  // origen: sus paquetes no se enseñan a la otra tienda (como la lista, que deja
  // de mandar `enviados`), revisor de tiendas 2026-10-20.
  if (t.estado !== 'en_transito' && t.estado !== 'recibido') {
    throw new AppError(409, 'TRASPASO_SIN_ENVIAR', t.estado === 'cancelado'
      ? `El traspaso ${t.folio} se canceló: no tiene PDF de envío.`
      : `El traspaso ${t.folio} todavía no se envía: su PDF de envío sale cuando se surte.`);
  }
  const doc = pdf.crear();
  doc.info.Title = `Envío ${t.folio}`;
  pdf.encabezado(doc, {
    titulo: 'Envío a sucursal',
    subtitulo: `Surtir sucursal · ${t.folio}`,
    derecha: pdf.fecha(t.enviado_en, { conHora: false }),
  });

  const salieron = t.lineas.filter((l) => !noSalio(l));
  const bultos = salieron.flatMap((l) => l.bultos);
  const kg = Math.round(salieron.reduce((s, l) => s + Number(l.cantidad), 0) * 1000) / 1000;
  const lotes = new Set(bultos.map((b) => b.lote ?? ''));

  pdf.datos(doc, [
    ['Sale de', t.almacen_origen],
    ['Va a', t.almacen_destino],
    ['Lo pidió', [t.usuario, pdf.fecha(t.creado_en)].filter(Boolean).join(' · ')],
    ['Lo surtió', [t.enviado_por, pdf.fecha(t.enviado_en)].filter(Boolean).join(' · ')],
    ['Cómo va', t.estado === 'recibido'
      ? `Recibido${t.recibido_por ? ' por ' + t.recibido_por : ''} el ${pdf.fecha(t.recibido_en)}`
      : PASO[t.estado] ?? t.estado],
    ['Notas del pedido', t.notas],
    ['Nota del envío', t.envio_notas],
  ]);

  pdf.cifras(doc, [
    ['Hilos que salieron', pdf.numero(salieron.length)],
    ['Paquetes', bultos.length ? pdf.numero(bultos.length) : '—'],
    ['Kilos reales', pdf.kg(kg)],
    ['Lotes', bultos.length ? pdf.numero(lotes.size) : '—'],
  ]);

  // Lo pedido contra lo que salió: "se manda lo que hay".
  pdf.seccion(doc, 'Qué se pidió y qué salió');
  const pedidosPaq = t.lineas.reduce((s, l) => s + Number(l.paquetes_solicitados ?? l.paquetes ?? 0), 0);
  const salieronPaq = t.lineas.reduce((s, l) => s + Number(l.paquetes ?? 0), 0);
  pdf.tabla(
    doc,
    [
      { titulo: 'Hilo', ancho: 2.6 },
      { titulo: 'Se pidió', ancho: 1.2, alin: 'right' },
      { titulo: 'Salió', ancho: 1.5, alin: 'right' },
      { titulo: 'Kilos reales', ancho: 1.1, alin: 'right' },
    ],
    t.lineas.map((l) => [
      etiqueta(l),
      // Lo PEDIDO: una línea en kilos no tiene paquetes pedidos (decía los que salieron).
      l.paquetes_solicitados != null || l.cantidad_solicitada != null
        ? _cuanto(l.paquetes_solicitados, l.cantidad_solicitada ?? l.cantidad)
        : _cuanto(l.paquetes, l.cantidad),
      noSalio(l) ? 'No salió (no había)' : _cuanto(l.paquetes, l.cantidad),
      noSalio(l) ? '' : pdf.kg(l.cantidad),
    ]),
    { total: ['Total', pedidosPaq ? paquetes(pedidosPaq) : '', salieronPaq ? paquetes(salieronPaq) : '', pdf.kg(kg)] }
  );

  // Cada paquete que va en la camioneta, por hilo y por lote.
  if (bultos.length) {
    pdf.seccion(doc, 'Paquetes que salieron');
    for (const l of salieron) {
      if (!l.bultos.length) continue;
      pdf.subseccion(doc, nombreHilo(l), _cifrasHilo(l.bultos));
      _tablaPaquetes(doc, l, { recepcion: false });
    }
  }
  _notaSinLista(doc, salieron, 'salió');
  if (t.estado === 'en_transito') {
    pdf.nota(doc,
      'Quien recibe revisa cada paquete contra esta lista y, al confirmar que llegó, marca los que no llegaron: ' +
      'esos se dan de baja como faltante con su peso real.');
  }

  _firmas(doc, [
    [t.enviado_por, 'Surtió'],
    ['', 'Lo llevó'],
    [t.estado === 'recibido' ? t.recibido_por : '', 'Recibió'],
  ]);

  pdf.pie(doc, `${await quienYCuando(usuarioId)} · ${t.folio}`);
  return { buffer: await pdf.aBuffer(doc), folio: t.folio };
}

// -------------------------------------------------------------- la recepción

async function pdfRecepcion(id, { usuarioId }) {
  const t = await _traspaso(id);
  if (t.estado !== 'recibido') {
    throw new AppError(409, 'TRASPASO_SIN_RECIBIR',
      `El traspaso ${t.folio} está "${PASO[t.estado] ?? t.estado}": su PDF de recepción sale cuando se confirma que llegó.`);
  }
  const doc = pdf.crear();
  doc.info.Title = `Recepción ${t.folio}`;
  pdf.encabezado(doc, {
    titulo: 'Recepción de envío',
    subtitulo: `Surtir sucursal · ${t.folio}`,
    derecha: pdf.fecha(t.recibido_en, { conHora: false }),
  });

  const salieron = t.lineas.filter((l) => !noSalio(l));
  const enviadoKg = Math.round(salieron.reduce((s, l) => s + Number(l.cantidad), 0) * 1000) / 1000;
  const llegoKg = Math.round(salieron.reduce((s, l) => s + Number(l.cantidad_recibida ?? l.cantidad), 0) * 1000) / 1000;
  const faltoKg = Math.round((enviadoKg - llegoKg) * 1000) / 1000;
  const bultos = salieron.flatMap((l) => l.bultos);
  const faltaron = bultos.filter((b) => b.falto);
  const enviadosPaq = salieron.reduce((s, l) => s + Number(l.paquetes ?? 0), 0);
  const llegaronPaq = salieron.reduce((s, l) => s + Number(l.paquetes_recibidos ?? l.paquetes ?? 0), 0);
  const incompletos = salieron.filter((l) => Number(l.cantidad_recibida ?? l.cantidad) < Number(l.cantidad));

  pdf.datos(doc, [
    ['Llegó a', t.almacen_destino],
    ['Salió de', t.almacen_origen],
    ['Lo recibió', [t.recibido_por, pdf.fecha(t.recibido_en)].filter(Boolean).join(' · ')],
    ['Lo surtió', [t.enviado_por, pdf.fecha(t.enviado_en)].filter(Boolean).join(' · ')],
    ['Lo pidió', [t.usuario, pdf.fecha(t.creado_en)].filter(Boolean).join(' · ')],
    ['Cómo llegó', incompletos.length
      ? `Incompleto: ${incompletos.length === 1 ? 'un hilo llegó' : `${incompletos.length} hilos llegaron`} con faltante`
      : 'Completo'],
    ['Nota del envío', t.envio_notas],
    ['Nota al recibir', t.recepcion_notas],
  ]);

  pdf.cifras(doc, [
    ['Se enviaron', enviadosPaq ? paquetes(enviadosPaq) : pdf.kg(enviadoKg)],
    ['Llegaron', enviadosPaq ? paquetes(llegaronPaq) : pdf.kg(llegoKg)],
    ['Kilos que entraron', pdf.kg(llegoKg)],
    ['Faltante (merma)', faltoKg > 0 ? pdf.kg(faltoKg) : 'Nada'],
  ]);

  pdf.seccion(doc, 'Qué se envió y qué llegó');
  pdf.tabla(
    doc,
    [
      { titulo: 'Hilo', ancho: 2.3 },
      { titulo: 'Se envió', ancho: 1.3, alin: 'right' },
      { titulo: 'Llegó', ancho: 1.3, alin: 'right' },
      { titulo: 'Faltó', ancho: 1.3, alin: 'right' },
    ],
    t.lineas.map((l) => {
      if (noSalio(l)) return [etiqueta(l), 'No salió (no había)', '', ''];
      const llego = Number(l.cantidad_recibida ?? l.cantidad);
      const falto = Math.round((Number(l.cantidad) - llego) * 1000) / 1000;
      const enPaq = l.paquetes != null;
      const faltanPaq = enPaq ? Number(l.paquetes) - Number(l.paquetes_recibidos ?? l.paquetes) : 0;
      return [
        etiqueta(l),
        enPaq ? `${paquetes(l.paquetes)}\n${pdf.kg(l.cantidad)}` : pdf.kg(l.cantidad),
        enPaq ? `${paquetes(l.paquetes_recibidos ?? l.paquetes)}\n${pdf.kg(llego)}` : pdf.kg(llego),
        falto > 0 ? (enPaq ? `${paquetes(faltanPaq)}\n${pdf.kg(falto)}` : pdf.kg(falto)) : 'Nada',
      ];
    }),
    {
      total: [
        'Total',
        enviadosPaq ? `${paquetes(enviadosPaq)}\n${pdf.kg(enviadoKg)}` : pdf.kg(enviadoKg),
        enviadosPaq ? `${paquetes(llegaronPaq)}\n${pdf.kg(llegoKg)}` : pdf.kg(llegoKg),
        faltoKg > 0 ? (enviadosPaq ? `${paquetes(enviadosPaq - llegaronPaq)}\n${pdf.kg(faltoKg)}` : pdf.kg(faltoKg)) : 'Nada',
      ],
    }
  );

  if (faltaron.length) {
    pdf.seccion(doc, `Paquetes que no llegaron (${faltaron.length})`);
    pdf.tabla(
      doc,
      [
        { titulo: 'Hilo', ancho: 2.2 },
        { titulo: 'Código del paquete', ancho: 1.8 },
        { titulo: 'Lote', ancho: 1.3 },
        { titulo: 'Peso real', ancho: 1.05, alin: 'right' },
      ],
      salieron.flatMap((l) => l.bultos.filter((b) => b.falto).map((b) => [nombreHilo(l), b.codigo, b.lote ?? '', pdf.kg(b.peso_kg)])),
      { total: ['', paquetes(faltaron.length), '', pdf.kg(faltaron.reduce((s, b) => s + Number(b.peso_kg ?? 0), 0))] }
    );
    pdf.nota(doc,
      'Estos paquetes se dieron de baja como faltante (merma) con su peso real, con el folio del envío en el ' +
      'kardex: ya no se venden ni se bajan a conos.');
  }

  if (bultos.length) {
    pdf.seccion(doc, 'Cada paquete del envío');
    for (const l of salieron) {
      if (!l.bultos.length) continue;
      const falt = l.bultos.filter((b) => b.falto).length;
      pdf.subseccion(doc, nombreHilo(l),
        `${_cifrasHilo(l.bultos)}${falt ? ` · no ${falt === 1 ? 'llegó 1' : `llegaron ${falt}`}` : ' · llegaron todos'}`);
      _tablaPaquetes(doc, l, { recepcion: true });
    }
  }
  _notaSinLista(doc, salieron, 'llegó');

  _firmas(doc, [
    [t.enviado_por, 'Surtió'],
    [t.recibido_por, 'Recibió'],
  ]);

  pdf.pie(doc, `${await quienYCuando(usuarioId)} · ${t.folio}`);
  return { buffer: await pdf.aBuffer(doc), folio: t.folio };
}

module.exports = { pdfEnvio, pdfRecepcion };
