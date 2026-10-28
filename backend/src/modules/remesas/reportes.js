'use strict';

/**
 * Reportes en PDF de las ENTRADAS de inventario por Carga de producto (la lista
 * de empaque del proveedor):
 *
 *   · `pdfCarga(id)`     el comprobante de UNA carga: el hilo, a qué almacén
 *                        entró, quién la cargó y cada bulto con su peso real.
 *                        La pantalla lo baja sola al terminar de cargar, y se
 *                        puede volver a sacar cuando sea desde el historial.
 *   · `pdfCargas(ids)`   varias cargas en un archivo: las de una lista completa
 *                        del proveedor (un hilo por carga). Primero el resumen
 *                        de la lista y luego cada hilo en su página.
 *   · `pdfProducto(id)`  todas las cargas de UN hilo (con periodo opcional):
 *                        cuánto ha entrado, a qué almacén y cómo están hoy
 *                        esos bultos.
 *
 * Se arman al momento con lo que hay en la base; no se guardan archivos. La
 * carga guarda su total (`num_bultos`, `kg_total`) y cada bulto queda en
 * `variante_codigos` con su `remesa_id`, así que el comprobante sale igual hoy
 * que el día de la carga. Lo único que cambia es la columna "Hoy" (si el bulto
 * sigue en existencia, se vendió o se bajó a conos), y por eso se rotula así.
 *
 * Solo cuentan las cargas: un traspaso entre almacenes o los conos que salen de
 * un paquete no son mercancía nueva, mueven o transforman la que ya había.
 */

const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const pdf = require('../../utils/pdf');

const ESTADO = {
  disponible: 'En existencia', apartado: 'Apartado (nota en espera o envío)', vendido: 'Vendido', desarmado: 'Bajado a conos',
  faltante: 'No llegó (faltó en un envío)',
};

/** "REM-1789814460000-D0B2" → "REM-D0B2", como en las listas de la pantalla. */
function folioCorto(folio) {
  return String(folio ?? '').replace(/^([A-Z]+)-\d{10,}-/, '$1-');
}

function nombreHilo(r) {
  return `${r.producto}${r.calibre ? ' ' + r.calibre : ''}`;
}

/** Quién lo pide y la hora de la BASE: así cuadra con las horas de las cargas. */
async function quienYCuando(usuarioId) {
  const [[r]] = await pool.query(
    `SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS ahora,
            (SELECT nombre FROM usuarios WHERE id = :u) AS usuario`,
    { u: usuarioId ?? 0 }
  );
  return `Generado el ${pdf.fecha(r.ahora)}${r.usuario ? ' por ' + r.usuario : ''}`;
}

// ---------------------------------------------------------------- una carga

/**
 * Los bultos de una carga por LOTE (2026-10-20, usuario: "igual eso lo requiero
 * en el reporte"): cada lote con cuántos bultos, kilos y conos trae, y sus
 * bultos en el orden en que entraron. Los lotes, como en la pantalla.
 */
function _porLote(bultos) {
  const m = new Map();
  for (const b of bultos) {
    const l = b.lote ?? '(sin lote)';
    if (!m.has(l)) m.set(l, []);
    m.get(l).push(b);
  }
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([lote, lista]) => ({
      lote,
      bultos: lista,
      kg: Math.round(lista.reduce((s, b) => s + Number(b.peso_kg), 0) * 1000) / 1000,
      conos: lista.reduce((s, b) => s + Number(b.conos ?? 0), 0),
      sinConos: lista.filter((b) => b.conos == null).length,
    }));
}

/** "20 bultos · 390.5 kg · 240 conos" (y cuántos no dicen sus conos). */
function _cifrasLote(l) {
  const partes = [
    `${pdf.numero(l.bultos.length)} ${l.bultos.length === 1 ? 'bulto' : 'bultos'}`,
    pdf.kg(l.kg),
    l.conos ? `${pdf.numero(l.conos)} ${l.conos === 1 ? 'cono' : 'conos'}` : 'sin conos',
  ];
  if (l.conos && l.sinConos) partes.push(`${l.sinConos} sin conos en el archivo`);
  return partes.join(' · ');
}

async function _carga(id, almacenes = null) {
  const [[r]] = await pool.query(
    `SELECT r.id, r.folio, r.num_bultos, r.kg_total, r.costo_kg, r.lotes, r.archivo, r.notas,
            DATE_FORMAT(r.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
            DATE_FORMAT(r.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
            prv.nombre AS proveedor, r.factura, r.pedimento, r.contenedor,
            pv.sku, pv.tipo_presentacion, pv.precio, prod.id AS producto_id, prod.nombre AS producto,
            prod.grosor_calibre AS calibre, cat.nombre AS material, l.nombre AS linea,
            a.nombre AS almacen, u.nombre AS usuario
       FROM remesas r
       JOIN producto_variantes pv ON pv.id = r.variante_id
       JOIN productos prod        ON prod.id = pv.producto_id
       LEFT JOIN categorias cat   ON cat.id = prod.categoria_id
       LEFT JOIN lineas l         ON l.id = prod.linea_id
       JOIN almacenes a           ON a.id = r.almacen_id
       LEFT JOIN usuarios u       ON u.id = r.usuario_id
       LEFT JOIN proveedores prv  ON prv.id = r.proveedor_id
      WHERE r.id = :id`,
    { id }
  );
  if (!r) throw new AppError(404, 'NO_ENCONTRADO', 'Esa carga no existe');
  const [bultos] = await pool.query(
    `SELECT vc.codigo, vc.peso_kg, vc.lote, vc.conos, vc.estado, vc.almacen_id, a.nombre AS almacen
       FROM variante_codigos vc
       LEFT JOIN almacenes a ON a.id = vc.almacen_id
      WHERE vc.remesa_id = :id
      ORDER BY vc.id`,
    { id }
  );
  // A quien no ve esa tienda, sin el nombre (2026-10-26, auditoría; como el Reporte de
  // entradas): la gerente de la Matriz sabía qué paquetes tiene hoy Moroleón.
  const ve = (almacenId) => !Array.isArray(almacenes) || almacenId == null || almacenes.includes(Number(almacenId));
  for (const b of bultos) if (!ve(b.almacen_id)) b.almacen = 'otra tienda';
  return { ...r, bultos };
}

async function pdfCarga(id, { usuarioId, veCostos, almacenes = null }) {
  const c = await _carga(id, almacenes);
  const doc = pdf.crear();
  doc.info.Title = `Carga ${c.folio}`;
  _dibujarCarga(doc, c, veCostos);
  pdf.pie(doc, `${await quienYCuando(usuarioId)} · ${c.folio}`);
  return { buffer: await pdf.aBuffer(doc), folio: c.folio };
}

/** El comprobante de una carga, en la página donde va el documento. */
function _dibujarCarga(doc, c, veCostos) {
  pdf.encabezado(doc, {
    titulo: 'Entrada de inventario',
    subtitulo: `Carga de producto · ${c.folio}`,
    derecha: pdf.fecha(c.creado_en, { conHora: false }),
  });

  const kgTotal = Number(c.kg_total);
  const costo = c.costo_kg != null ? Number(c.costo_kg) : null;
  pdf.datos(doc, [
    ['Hilo', nombreHilo(c)],
    ['Material y línea', [c.material, c.linea].filter(Boolean).join(' · ')],
    ['Presentación', `${c.sku} · ${c.tipo_presentacion}`],
    ['Entró a', c.almacen],
    ['Proveedor', c.proveedor],
    ['Factura', c.factura],
    ['Pedimento', c.pedimento],
    ['Contenedor', c.contenedor],
    ['Fecha de ingreso', c.fecha_ingreso ? pdf.fecha(c.fecha_ingreso, { conHora: false }) : null],
    ['Se capturó', pdf.fecha(c.creado_en)],
    ['La cargó', c.usuario],
    ['Archivo', c.archivo],
    ['Lotes', c.lotes],
    // El precio de compra es información interna: solo para quien ve costos.
    ...(veCostos
      ? [
          ['Precio de compra', costo != null ? `${pdf.dinero(costo)} por kg` : 'Sin capturar'],
          ['Valor de la compra', costo != null ? pdf.dinero(Math.round(costo * kgTotal * 100) / 100) : ''],
        ]
      : []),
    ['Notas', c.notas],
  ]);

  const conos = c.bultos.reduce((s, b) => s + Number(b.conos ?? 0), 0);
  pdf.cifras(doc, [
    ['Bultos', pdf.numero(c.num_bultos)],
    ['Kilos que entraron', pdf.kg(kgTotal)],
    ['Peso promedio', c.num_bultos ? pdf.kg(Math.round((kgTotal / c.num_bultos) * 1000) / 1000) : '—'],
    ['Conos que rinden', conos ? pdf.numero(conos) : '—'],
  ]);

  // Por LOTE (2026-10-20): cada lote con sus cifras y sus bultos uno por uno.
  const lotes = _porLote(c.bultos);
  pdf.seccion(doc, lotes.length > 1 ? `Bultos que entraron, por lote (${lotes.length} lotes)` : 'Bultos que entraron');
  for (const l of lotes) {
    pdf.subseccion(doc, `Lote ${l.lote}`, _cifrasLote(l));
    pdf.tabla(
      doc,
      [
        { titulo: '#', ancho: 0.5, alin: 'right' },
        { titulo: 'Código del bulto', ancho: 1.8 },
        { titulo: 'Peso real', ancho: 1.1, alin: 'right' },
        { titulo: 'Conos', ancho: 0.7, alin: 'right' },
        { titulo: 'Hoy', ancho: 2.6 },
      ],
      l.bultos.map((b, i) => [
        String(i + 1),
        b.codigo,
        pdf.kg(b.peso_kg),
        b.conos != null ? String(b.conos) : '',
        b.estado === 'disponible' && b.almacen ? `${ESTADO.disponible} · ${b.almacen}` : ESTADO[b.estado] ?? b.estado,
      ]),
      { total: ['', `${l.bultos.length} ${l.bultos.length === 1 ? 'bulto' : 'bultos'}`, pdf.kg(l.kg), l.conos ? String(l.conos) : '', ''] }
    );
  }

  // Un bulto capturado por error se puede quitar a mano: la carga conserva su
  // total, pero ese bulto ya no sale en la lista. Se dice para que cuadre.
  if (c.bultos.length < Number(c.num_bultos)) {
    pdf.nota(doc,
      `La carga registró ${c.num_bultos} bultos; ${c.num_bultos - c.bultos.length} se quitaron después ` +
      '(y sus kilos salieron del inventario, con su movimiento en el kardex) y ya no aparecen en la lista. ' +
      'Los totales de arriba son los de la carga.');
  }
  pdf.nota(doc,
    'La columna "Hoy" dice cómo está cada bulto al generar este reporte: si sigue en existencia (y en qué ' +
    'almacén), si está apartado (para una nota en espera o un envío), si ya se vendió, si se bajó a conos o si ' +
    'no llegó en un envío. Lo demás es lo que entró ese día.');
}

// ------------------------------------------------- varias cargas (una lista)

async function pdfCargas(ids, { usuarioId, veCostos, almacenes = null }) {
  const cargas = [];
  for (const id of ids) cargas.push(await _carga(id, almacenes));
  const doc = pdf.crear();
  const primera = cargas[0];
  const titulo = cargas.length === 1 ? `Carga ${primera.folio}` : `Carga de ${cargas.length} hilos`;
  doc.info.Title = titulo;

  pdf.encabezado(doc, {
    titulo: 'Entrada de inventario',
    subtitulo: `Carga de producto · ${cargas.length} ${cargas.length === 1 ? 'hilo' : 'hilos'} de una misma lista`,
    derecha: pdf.fecha(primera.creado_en, { conHora: false }),
  });

  const entraron = [...new Set(cargas.map((c) => c.almacen))];
  const usuarios = [...new Set(cargas.map((c) => c.usuario).filter(Boolean))];
  pdf.datos(doc, [
    ['Archivo', primera.archivo],
    ['Entró a', entraron.join(', ')],
    ['Proveedor', primera.proveedor],
    ['Factura', primera.factura],
    ['Pedimento', primera.pedimento],
    ['Contenedor', primera.contenedor],
    ['Fecha de ingreso', primera.fecha_ingreso ? pdf.fecha(primera.fecha_ingreso, { conHora: false }) : null],
    ['Se capturó', pdf.fecha(primera.creado_en)],
    ['La cargó', usuarios.join(', ')],
    ['Notas', primera.notas],
  ]);

  const kg = (x) => Math.round(x * 1000) / 1000;
  const bultos = cargas.reduce((s, c) => s + Number(c.num_bultos), 0);
  const kgTotal = kg(cargas.reduce((s, c) => s + Number(c.kg_total), 0));
  const conosDe = (c) => c.bultos.reduce((s, b) => s + Number(b.conos ?? 0), 0);
  const conos = cargas.reduce((s, c) => s + conosDe(c), 0);
  pdf.cifras(doc, [
    ['Hilos', pdf.numero(cargas.length)],
    ['Bultos', pdf.numero(bultos)],
    ['Kilos que entraron', pdf.kg(kgTotal)],
    ['Conos que rinden', conos ? pdf.numero(conos) : '—'],
  ]);

  pdf.seccion(doc, 'Hilos que entraron');
  pdf.tabla(
    doc,
    [
      { titulo: 'Hilo', ancho: 2 },
      { titulo: 'Folio', ancho: 1.2 },
      { titulo: 'Lotes', ancho: 1.8 },
      { titulo: 'Bultos', ancho: 0.8, alin: 'right' },
      { titulo: 'Kilos', ancho: 1.1, alin: 'right' },
      { titulo: 'Conos', ancho: 0.8, alin: 'right' },
    ],
    cargas.map((c) => [
      nombreHilo(c),
      folioCorto(c.folio),
      c.lotes ?? '',
      pdf.numero(c.num_bultos),
      pdf.kg(c.kg_total),
      conosDe(c) ? pdf.numero(conosDe(c)) : '',
    ]),
    { total: [`${cargas.length} ${cargas.length === 1 ? 'hilo' : 'hilos'}`, '', '', pdf.numero(bultos), pdf.kg(kgTotal), conos ? pdf.numero(conos) : ''] }
  );

  // Los hilos que se crearon con esta carga entran sin precio de venta.
  const sinPrecio = cargas.filter((c) => !(Number(c.precio) > 0)).map(nombreHilo);
  if (sinPrecio.length) {
    pdf.nota(doc,
      `Sin precio de venta todavía: ${sinPrecio.join(', ')}. No se pueden vender hasta que se les ponga ` +
      'su precio por kilo en Productos.');
  }
  // Los lotes de cada hilo, de un vistazo (2026-10-20).
  pdf.seccion(doc, 'Lotes de cada hilo');
  const filasLotes = [];
  for (const c of cargas) {
    _porLote(c.bultos).forEach((l, i) => {
      filasLotes.push([
        i === 0 ? nombreHilo(c) : '',
        l.lote,
        pdf.numero(l.bultos.length),
        pdf.kg(l.kg),
        l.conos ? pdf.numero(l.conos) : '',
      ]);
    });
  }
  pdf.tabla(
    doc,
    [
      { titulo: 'Hilo', ancho: 2.2 },
      { titulo: 'Lote', ancho: 1.6 },
      { titulo: 'Bultos', ancho: 0.9, alin: 'right' },
      { titulo: 'Kilos', ancho: 1.2, alin: 'right' },
      { titulo: 'Conos', ancho: 0.9, alin: 'right' },
    ],
    filasLotes
  );
  pdf.nota(doc, 'En las páginas siguientes va cada hilo, lote por lote, con sus bultos: código, peso real y conos.');

  for (const c of cargas) {
    doc.addPage();
    _dibujarCarga(doc, c, veCostos);
  }

  pdf.pie(doc, `${await quienYCuando(usuarioId)} · ${cargas.length} ${cargas.length === 1 ? 'carga' : 'cargas'}`);
  const base = (primera.archivo ?? titulo).split(/[\\/]/).pop().replace(/\.(xlsx|xls)$/i, '');
  return { buffer: await pdf.aBuffer(doc), nombre: `Carga ${base}.pdf` };
}

// ---------------------------------------------------------- todo un producto

async function pdfProducto(productoId, { usuarioId, veCostos, desde, hasta, almacenes = null }) {
  const [[p]] = await pool.query(
    `SELECT prod.id, prod.nombre AS producto, prod.grosor_calibre AS calibre,
            cat.nombre AS material, l.nombre AS linea
       FROM productos prod
       LEFT JOIN categorias cat ON cat.id = prod.categoria_id
       LEFT JOIN lineas l       ON l.id = prod.linea_id
      WHERE prod.id = :id`,
    { id: productoId }
  );
  if (!p) throw new AppError(404, 'NO_ENCONTRADO', 'Ese producto no existe');

  const where = ['pv.producto_id = :id'];
  const params = { id: productoId };
  // Solo las cargas de SUS tiendas (2026-10-15).
  if (Array.isArray(almacenes)) {
    where.push(almacenes.length ? 'r.almacen_id IN (:almacenesAlcance)' : '1 = 0');
    params.almacenesAlcance = almacenes;
  }
  // Por el día que LLEGÓ (fecha de ingreso), como el historial (2026-10-26, auditoría:
  // un contenedor que llegó el 3 y se capturó el 6 no salía del 1 al 5).
  const llego = 'COALESCE(r.fecha_ingreso, DATE(r.creado_en))';
  if (desde) { where.push(`${llego} >= :desde`); params.desde = desde; }
  if (hasta) { where.push(`${llego} <= :hasta`); params.hasta = hasta; }

  const [cargas] = await pool.query(
    `SELECT r.id, r.folio, DATE_FORMAT(r.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
            r.num_bultos, r.kg_total, r.costo_kg, r.lotes, pv.sku,
            DATE_FORMAT(COALESCE(r.fecha_ingreso, r.creado_en), '%Y-%m-%d') AS llego,
            prov.nombre AS proveedor, r.factura,
            a.nombre AS almacen, u.nombre AS usuario,
            COALESCE(e.disp, 0) AS disp, COALESCE(e.disp_kg, 0) AS disp_kg,
            COALESCE(e.apar, 0) AS apar, COALESCE(e.apar_kg, 0) AS apar_kg,
            COALESCE(e.vend, 0) AS vend, COALESCE(e.vend_kg, 0) AS vend_kg,
            COALESCE(e.des, 0) AS des, COALESCE(e.des_kg, 0) AS des_kg,
            COALESCE(e.fal, 0) AS fal, COALESCE(e.fal_kg, 0) AS fal_kg
       FROM remesas r
       JOIN producto_variantes pv ON pv.id = r.variante_id
       JOIN almacenes a           ON a.id = r.almacen_id
       LEFT JOIN usuarios u       ON u.id = r.usuario_id
       LEFT JOIN proveedores prov ON prov.id = r.proveedor_id
       LEFT JOIN (
         SELECT remesa_id,
                SUM(estado = 'disponible') AS disp, SUM(IF(estado = 'disponible', peso_kg, 0)) AS disp_kg,
                SUM(estado = 'apartado')   AS apar, SUM(IF(estado = 'apartado', peso_kg, 0))   AS apar_kg,
                SUM(estado = 'vendido')    AS vend, SUM(IF(estado = 'vendido', peso_kg, 0))    AS vend_kg,
                SUM(estado = 'desarmado')  AS des,  SUM(IF(estado = 'desarmado', peso_kg, 0))  AS des_kg,
                SUM(estado = 'faltante')   AS fal,  SUM(IF(estado = 'faltante', peso_kg, 0))   AS fal_kg
           FROM variante_codigos WHERE remesa_id IS NOT NULL GROUP BY remesa_id
       ) e ON e.remesa_id = r.id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(r.fecha_ingreso, DATE(r.creado_en)), r.id`,
    params
  );

  const doc = pdf.crear();
  const hilo = nombreHilo(p);
  doc.info.Title = `Entradas de ${hilo}`;
  const periodo =
    desde && hasta ? `Del ${pdf.fecha(desde, { conHora: false })} al ${pdf.fecha(hasta, { conHora: false })}`
      : desde ? `Desde el ${pdf.fecha(desde, { conHora: false })}`
        : hasta ? `Hasta el ${pdf.fecha(hasta, { conHora: false })}`
          : 'Todas las cargas';

  pdf.encabezado(doc, {
    titulo: 'Entradas de inventario',
    subtitulo: `${hilo}${p.material || p.linea ? ' · ' + [p.material, p.linea].filter(Boolean).join(' · ') : ''}`,
    derecha: periodo,
  });

  const suma = (k) => cargas.reduce((s, c) => s + Number(c[k] ?? 0), 0);
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const kgTotal = r3(suma('kg_total'));
  const conCosto = cargas.filter((c) => c.costo_kg != null);
  const kgConCosto = conCosto.reduce((s, c) => s + Number(c.kg_total), 0);
  const costoProm = kgConCosto > 0
    ? Math.round((conCosto.reduce((s, c) => s + Number(c.kg_total) * Number(c.costo_kg), 0) / kgConCosto) * 100) / 100
    : null;
  const lotes = new Set(cargas.flatMap((c) => String(c.lotes ?? '').split(',').map((x) => x.trim()).filter(Boolean)));

  pdf.datos(doc, [
    ['Hilo', hilo],
    ['Material y línea', [p.material, p.linea].filter(Boolean).join(' · ')],
    ['Periodo', periodo],
    ['Presentación', [...new Set(cargas.map((c) => c.sku))].join(', ')],
  ]);
  pdf.cifras(doc, [
    ['Cargas', pdf.numero(cargas.length)],
    ['Bultos', pdf.numero(suma('num_bultos'))],
    ['Kilos que entraron', pdf.kg(kgTotal)],
    veCostos
      ? ['Costo promedio de compra', costoProm != null ? `${pdf.dinero(costoProm)}/kg` : '—']
      : ['Lotes distintos', pdf.numero(lotes.size)],
  ]);

  if (cargas.length === 0) {
    pdf.nota(doc, 'Este hilo no tiene cargas en el periodo.');
  } else {
    pdf.seccion(doc, 'Cargas');
    const columnas = [
      { titulo: 'Llegó', ancho: 0.9 },
      { titulo: 'Folio', ancho: 0.9 },
      { titulo: 'Proveedor · factura', ancho: 1.4 },
      { titulo: 'Almacén', ancho: 1.1 },
      { titulo: 'Bultos', ancho: 0.6, alin: 'right' },
      { titulo: 'Kilos', ancho: 1.0, alin: 'right' },
      { titulo: 'Lotes', ancho: 0.95 },
      ...(veCostos ? [{ titulo: 'Costo/kg', ancho: 0.75, alin: 'right' }] : []),
      { titulo: 'La cargó', ancho: 1.2 },
    ];
    const filas = cargas.map((c) => [
      pdf.fechaCorta(c.llego),
      folioCorto(c.folio),
      [c.proveedor, c.factura].filter(Boolean).join(' · ') || '—',
      c.almacen,
      pdf.numero(c.num_bultos),
      pdf.kg(c.kg_total),
      c.lotes ?? '',
      ...(veCostos ? [c.costo_kg != null ? pdf.dinero(c.costo_kg) : 'sin capturar'] : []),
      c.usuario ?? '',
    ]);
    pdf.tabla(doc, columnas, filas, {
      total: ['Total', `${cargas.length} ${cargas.length === 1 ? 'carga' : 'cargas'}`, '', '', pdf.numero(suma('num_bultos')), pdf.kg(kgTotal), '',
        ...(veCostos ? [costoProm != null ? pdf.dinero(costoProm) : ''] : []), ''],
    });
    if (veCostos && conCosto.length < cargas.length) {
      pdf.nota(doc,
        `${cargas.length - conCosto.length} de las cargas entraron sin precio de compra; el costo promedio ` +
        'es solo de las que sí lo tienen.');
    }

    // A qué almacén entró cada kilo.
    const porAlmacen = new Map();
    for (const c of cargas) {
      const a = porAlmacen.get(c.almacen) ?? { cargas: 0, bultos: 0, kg: 0 };
      a.cargas += 1;
      a.bultos += Number(c.num_bultos);
      a.kg += Number(c.kg_total);
      porAlmacen.set(c.almacen, a);
    }
    pdf.seccion(doc, 'Por almacén');
    pdf.tabla(
      doc,
      [
        { titulo: 'Almacén', ancho: 2.4 },
        { titulo: 'Cargas', ancho: 0.8, alin: 'right' },
        { titulo: 'Bultos', ancho: 0.8, alin: 'right' },
        { titulo: 'Kilos', ancho: 1.2, alin: 'right' },
        { titulo: 'Del total', ancho: 0.9, alin: 'right' },
      ],
      [...porAlmacen].map(([nombre, a]) => [
        nombre, pdf.numero(a.cargas), pdf.numero(a.bultos), pdf.kg(r3(a.kg)),
        kgTotal > 0 ? `${Math.round((a.kg / kgTotal) * 100)}%` : '',
      ])
    );

    // Qué pasó con esos bultos: siguen, se vendieron o se bajaron a conos.
    pdf.seccion(doc, 'Cómo están hoy esos bultos');
    pdf.tabla(
      doc,
      [
        { titulo: 'Estado', ancho: 2.4 },
        { titulo: 'Bultos', ancho: 1, alin: 'right' },
        { titulo: 'Kilos', ancho: 1.2, alin: 'right' },
      ],
      [
        [ESTADO.disponible, pdf.numero(suma('disp')), pdf.kg(r3(suma('disp_kg')))],
        ...(suma('apar') > 0 ? [[ESTADO.apartado, pdf.numero(suma('apar')), pdf.kg(r3(suma('apar_kg')))]] : []),
        [ESTADO.vendido, pdf.numero(suma('vend')), pdf.kg(r3(suma('vend_kg')))],
        [ESTADO.desarmado, pdf.numero(suma('des')), pdf.kg(r3(suma('des_kg')))],
        ...(suma('fal') > 0 ? [[ESTADO.faltante, pdf.numero(suma('fal')), pdf.kg(r3(suma('fal_kg')))]] : []),
      ]
    );

    // POR LOTE, como en la revisión de la carga (2026-10-20, usuario: "sí, igual
    // en el reporte"): cuánto trajo cada lote y sus bultos uno por uno. Un bulto
    // que hoy está en una tienda que quien pide no ve dice "otra tienda".
    const [bultos] = await pool.query(
      `SELECT vc.codigo, vc.peso_kg, vc.lote, vc.conos, vc.estado, vc.almacen_id, vc.remesa_id,
              a.nombre AS almacen
         FROM variante_codigos vc
         LEFT JOIN almacenes a ON a.id = vc.almacen_id
        WHERE vc.remesa_id IN (:ids)
        ORDER BY vc.id`,
      { ids: cargas.map((c) => c.id) }
    );
    if (bultos.length) {
      const folioDe = new Map(cargas.map((c) => [c.id, folioCorto(c.folio)]));
      const ve = (almacenId) => !Array.isArray(almacenes) || almacenes.includes(Number(almacenId));
      const hoy = (b) =>
        b.estado === 'disponible' && b.almacen ? `${ESTADO.disponible} · ${ve(b.almacen_id) ? b.almacen : 'otra tienda'}`
          : ESTADO[b.estado] ?? b.estado;
      const lotesHilo = _porLote(bultos);

      pdf.seccion(doc, 'Por lote');
      pdf.tabla(
        doc,
        [
          { titulo: 'Lote', ancho: 1.6 },
          { titulo: 'Bultos', ancho: 0.8, alin: 'right' },
          { titulo: 'Kilos', ancho: 1.1, alin: 'right' },
          { titulo: 'Conos', ancho: 0.8, alin: 'right' },
          { titulo: 'En existencia', ancho: 1.1, alin: 'right' },
        ],
        lotesHilo.map((l) => [
          l.lote,
          pdf.numero(l.bultos.length),
          pdf.kg(l.kg),
          l.conos ? pdf.numero(l.conos) : '',
          (() => {
            const n = l.bultos.filter((b) => b.estado === 'disponible').length;
            return `${pdf.numero(n)} ${n === 1 ? 'paquete' : 'paquetes'}`;
          })(),
        ])
      );

      pdf.seccion(doc, 'Bultos por lote');
      for (const l of lotesHilo) {
        pdf.subseccion(doc, `Lote ${l.lote}`, _cifrasLote(l));
        pdf.tabla(
          doc,
          [
            { titulo: '#', ancho: 0.5, alin: 'right' },
            { titulo: 'Código del bulto', ancho: 1.6 },
            { titulo: 'Peso real', ancho: 1.0, alin: 'right' },
            { titulo: 'Conos', ancho: 0.6, alin: 'right' },
            { titulo: 'Carga', ancho: 0.9 },
            { titulo: 'Hoy', ancho: 2.2 },
          ],
          l.bultos.map((b, i) => [
            String(i + 1),
            b.codigo,
            pdf.kg(b.peso_kg),
            b.conos != null ? String(b.conos) : '',
            folioDe.get(b.remesa_id) ?? '',
            hoy(b),
          ]),
          { total: ['', `${l.bultos.length} ${l.bultos.length === 1 ? 'bulto' : 'bultos'}`, pdf.kg(l.kg), l.conos ? String(l.conos) : '', '', ''] }
        );
      }
    }
  }

  pdf.nota(doc,
    'Solo cuenta la mercancía que entró por Carga de producto (la lista de empaque del proveedor). ' +
    'Los traspasos entre almacenes y los conos que salen de un paquete no son entradas nuevas: ' +
    'mueven o transforman lo que ya había.');

  pdf.pie(doc, `${await quienYCuando(usuarioId)} · ${hilo}`);
  return { buffer: await pdf.aBuffer(doc), hilo };
}

module.exports = { pdfCarga, pdfCargas, pdfProducto };
