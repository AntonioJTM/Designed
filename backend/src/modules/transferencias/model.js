'use strict';

/**
 * TRANSFERENCIAS (2026-10-20, usuario: "un apartado en ventas que se llame
 * transferencias", con los datos de su hoja: fecha, folio de venta, cliente,
 * cuenta, no. de operación, producto, importe, estado y facturado).
 *
 * La lista sale SOLA de lo que el sistema ya guarda (lo eligió el usuario: no se
 * vuelve a capturar nada). Una transferencia es, según por dónde entró:
 *   · 'pago'      un `pagos` con método Transferencia: la venta de la caja, el
 *                 pago de una nota pendiente, el abono a una nota en espera, la
 *                 entrega, la captura que subió el personal.
 *   · 'abono'     un abono a su cuenta o a notas por transferencia. El abono
 *                 repartido en VARIAS notas son varios renglones de
 *                 `credito_movimientos` con la misma hora: es UN depósito y sale
 *                 en UN renglón ("2164, 2323"); su llave es el primero.
 *   · 'anticipo'  la parte por transferencia de un anticipo.
 * El folio de operación vive donde siempre (`referencia_transaccion` /
 * `referencia`); corregirlo aquí lo corrige ahí.
 *
 * Lo NUEVO —a qué cuenta llegó, si ya se revisó en el banco (Procesada) y si se
 * facturó— va en `transferencias`, ligado por (fuente, fuente_id). Sin su
 * renglón la transferencia sale igual, "Por revisar" y sin cuenta: así ninguna
 * se queda fuera aunque algún camino no lo anote. La cuenta se pide AL COBRAR
 * (`anotar`), y se corrige después aquí.
 */

const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const { porPalabras } = require('../../utils/query');

const FUENTES = ['pago', 'abono', 'anticipo'];
const ESTADOS = ['por_revisar', 'procesada'];

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Los métodos de pago que son transferencia (activos o no: la historia cuenta). */
async function metodosTransferencia(ejecutor = pool) {
  const [rows] = await ejecutor.query(
    "SELECT id FROM metodos_pago WHERE interno = 0 AND LOWER(nombre) LIKE '%transferencia%'"
  );
  return rows.map((r) => Number(r.id));
}

/** Una cuenta que existe y está activa, o 422. */
async function exigirCuenta(ejecutor, cuentaId) {
  const [[c]] = await ejecutor.query(
    'SELECT id, activa FROM cuentas_bancarias WHERE id = :id', { id: cuentaId }
  );
  if (!c || !Number(c.activa)) {
    throw new AppError(422, 'CUENTA_INVALIDA', 'Esa cuenta de banco no existe o está desactivada. Elige otra.');
  }
}

/**
 * AL COBRAR: anota a qué cuenta llegó una transferencia recién registrada.
 * Solo si el método ES transferencia y se dijo la cuenta (si no, no hace nada:
 * la transferencia sale igual en la lista, sin cuenta). Va dentro de la
 * transacción de quien cobra.
 */
async function anotar(conn, { fuente, fuenteId, metodoPagoId, cuentaId, usuarioId = null }) {
  if (!cuentaId || !fuenteId) return;
  const metodos = await metodosTransferencia(conn);
  if (!metodos.includes(Number(metodoPagoId))) return;
  await exigirCuenta(conn, cuentaId);
  await conn.query(
    `INSERT INTO transferencias (fuente, fuente_id, cuenta_bancaria_id, creado_por)
     VALUES (:fuente, :fuente_id, :cuenta, :usuario)
     ON DUPLICATE KEY UPDATE cuenta_bancaria_id = VALUES(cuenta_bancaria_id)`,
    { fuente, fuente_id: fuenteId, cuenta: cuentaId, usuario: usuarioId }
  );
}

/** Las cuentas activas para elegir al cobrar: banco y los últimos 4 números. */
async function cuentasActivas() {
  const [rows] = await pool.query(
    `SELECT id, banco, titular, numero_cuenta, clabe FROM cuentas_bancarias
      WHERE activa = 1 ORDER BY banco, id`
  );
  return rows.map((c) => {
    const num = String(c.numero_cuenta || c.clabe || '');
    return { id: Number(c.id), banco: c.banco, titular: c.titular, ultimos: num.slice(-4) || null };
  });
}

// ------------------------------------------------------------------ la lista

/**
 * Todas las transferencias, una por renglón (las tres fuentes juntas), con lo
 * que se anotó de cada una. `:metodos` = los métodos de transferencia.
 */
const FUENTES_SQL = `
  SELECT 'pago' AS fuente, g.id AS fuente_id, g.creado_en AS fecha, g.monto AS importe,
         g.referencia_transaccion AS referencia, p.cliente_id,
         CAST(g.pedido_id AS CHAR) AS pedidos, p.numero_pedido AS folios,
         CASE WHEN p.encargo = 1 THEN 'espera' WHEN p.nota_pendiente = 1 THEN 'nota' ELSE 'venta' END AS de,
         (g.estado = 'reembolsado' OR p.estado IN ('cancelado', 'devuelto')) AS cancelada
    FROM pagos g
    JOIN pedidos p ON p.id = g.pedido_id
   WHERE g.metodo_pago_id IN (:metodos) AND g.estado IN ('completado', 'reembolsado')
  UNION ALL
  SELECT 'abono', MIN(c.id), c.creado_en, SUM(c.monto), MAX(c.referencia), c.cliente_id,
         GROUP_CONCAT(c.pedido_id ORDER BY c.id), GROUP_CONCAT(pa.numero_pedido ORDER BY c.id SEPARATOR ', '),
         'abono', 0
    FROM credito_movimientos c
    LEFT JOIN pedidos pa ON pa.id = c.pedido_id
   WHERE c.tipo = 'abono' AND c.metodo_pago_id IN (:metodos)
   GROUP BY c.cliente_id, c.creado_en, c.usuario_id, c.metodo_pago_id
  UNION ALL
  SELECT 'anticipo', s.id, s.creado_en, s.monto, s.referencia, s.cliente_id, NULL, NULL, 'anticipo', 0
    FROM saldo_favor_movimientos s
   WHERE s.tipo = 'anticipo' AND s.metodo_pago_id IN (:metodos)`;

const DESDE_SQL = `
  FROM (${FUENTES_SQL}) x
  LEFT JOIN transferencias t   ON t.fuente = x.fuente AND t.fuente_id = x.fuente_id
  LEFT JOIN cuentas_bancarias cb ON cb.id = t.cuenta_bancaria_id
  LEFT JOIN clientes cl          ON cl.id = x.cliente_id`;

const RENGLON_SQL = `
  SELECT x.fuente, x.fuente_id, DATE_FORMAT(x.fecha, '%Y-%m-%d %H:%i:%s') AS fecha, x.importe,
         x.referencia, x.cliente_id, cl.nombre AS cliente, cl.codigo AS cliente_codigo,
         x.pedidos, x.folios, x.de, x.cancelada,
         t.cuenta_bancaria_id, cb.banco AS cuenta_banco,
         RIGHT(COALESCE(cb.numero_cuenta, cb.clabe), 4) AS cuenta_ultimos,
         COALESCE(t.estado, 'por_revisar') AS estado, COALESCE(t.facturada, 0) AS facturada,
         DATE_FORMAT(t.revisada_en, '%Y-%m-%d %H:%i:%s') AS revisada_en, ur.nombre AS revisada_por,
         DATE_FORMAT(t.facturada_en, '%Y-%m-%d %H:%i:%s') AS facturada_en, uf.nombre AS facturada_por
    ${DESDE_SQL}
    LEFT JOIN usuarios ur ON ur.id = t.revisada_por
    LEFT JOIN usuarios uf ON uf.id = t.facturada_por`;

function _filtros({ desde, hasta, q, cuenta, estado, facturada, de }) {
  const w = [];
  const params = {};
  if (desde) { w.push('x.fecha >= :desde'); params.desde = desde; }
  if (hasta) { w.push('x.fecha < DATE_ADD(:hasta, INTERVAL 1 DAY)'); params.hasta = hasta; }
  if (cuenta === 'sin') w.push('t.cuenta_bancaria_id IS NULL');
  else if (Number(cuenta) > 0) { w.push('t.cuenta_bancaria_id = :cuenta'); params.cuenta = Number(cuenta); }
  if (estado === 'procesada') w.push("t.estado = 'procesada'");
  else if (estado === 'por_revisar') w.push("(t.estado IS NULL OR t.estado = 'por_revisar')");
  if (facturada === true) w.push('t.facturada = 1');
  else if (facturada === false) w.push('(t.facturada IS NULL OR t.facturada = 0)');
  if (de && ['venta', 'nota', 'espera', 'abono', 'anticipo'].includes(de)) { w.push('x.de = :de'); params.de = de; }
  if (q) {
    // Por palabras (como los hilos): el nombre, su número, el folio de la venta
    // ("79FA") o el número de operación.
    const p = porPalabras(q, ['cl.nombre', 'cl.codigo', 'x.folios', 'x.referencia']);
    if (p) { w.push(p.sql); Object.assign(params, p.params); }
  }
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params };
}

/**
 * La lista (de la más nueva a la más vieja) y sus cifras: todo lo filtrado, no
 * solo la página.
 */
async function listar(filtros = {}, { limit = 100, offset = 0 } = {}) {
  const metodos = await metodosTransferencia();
  if (!metodos.length) {
    return { items: [], total: 0, cifras: _cifrasVacias(), por_cuenta: [] };
  }
  const { where, params } = _filtros(filtros);
  const base = { ...params, metodos };
  const [rows] = await pool.query(
    `${RENGLON_SQL}
       ${where}
      ORDER BY x.fecha DESC, x.fuente DESC, x.fuente_id DESC
      LIMIT :limit OFFSET :offset`,
    { ...base, limit, offset }
  );

  const [[c]] = await pool.query(
    `SELECT COUNT(*) AS cuantas, COALESCE(SUM(x.importe), 0) AS importe,
            COALESCE(SUM(CASE WHEN COALESCE(t.estado, 'por_revisar') = 'por_revisar' THEN 1 ELSE 0 END), 0) AS por_revisar,
            COALESCE(SUM(CASE WHEN COALESCE(t.estado, 'por_revisar') = 'por_revisar' THEN x.importe ELSE 0 END), 0) AS importe_por_revisar,
            COALESCE(SUM(CASE WHEN t.estado = 'procesada' THEN x.importe ELSE 0 END), 0) AS importe_procesado,
            COALESCE(SUM(CASE WHEN COALESCE(t.facturada, 0) = 0 THEN 1 ELSE 0 END), 0) AS sin_facturar,
            COALESCE(SUM(CASE WHEN COALESCE(t.facturada, 0) = 0 THEN x.importe ELSE 0 END), 0) AS importe_sin_facturar,
            COALESCE(SUM(CASE WHEN t.cuenta_bancaria_id IS NULL THEN 1 ELSE 0 END), 0) AS sin_cuenta,
            COALESCE(SUM(CASE WHEN x.cancelada THEN x.importe ELSE 0 END), 0) AS importe_cancelado
       ${DESDE_SQL} ${where}`,
    base
  );
  const [cuentas] = await pool.query(
    `SELECT t.cuenta_bancaria_id AS id, cb.banco, RIGHT(COALESCE(cb.numero_cuenta, cb.clabe), 4) AS ultimos,
            COUNT(*) AS cuantas, SUM(x.importe) AS importe
       ${DESDE_SQL} ${where}
      GROUP BY t.cuenta_bancaria_id, cb.banco, ultimos
      ORDER BY importe DESC`,
    base
  );

  const items = rows.map(_renglon);
  await _conVentas(items);

  return {
    items: items.map(({ _pedidos, ...i }) => i),
    total: Number(c.cuantas),
    cifras: {
      cuantas: Number(c.cuantas),
      importe: round2(c.importe),
      por_revisar: Number(c.por_revisar),
      importe_por_revisar: round2(c.importe_por_revisar),
      importe_procesado: round2(c.importe_procesado),
      sin_facturar: Number(c.sin_facturar),
      importe_sin_facturar: round2(c.importe_sin_facturar),
      sin_cuenta: Number(c.sin_cuenta),
      importe_cancelado: round2(c.importe_cancelado),
    },
    por_cuenta: cuentas.map((k) => ({
      id: k.id != null ? Number(k.id) : null, banco: k.banco, ultimos: k.ultimos, cuantas: Number(k.cuantas), importe: round2(k.importe),
    })),
  };
}

function _cifrasVacias() {
  return {
    cuantas: 0, importe: 0, por_revisar: 0, importe_por_revisar: 0, importe_procesado: 0,
    sin_facturar: 0, importe_sin_facturar: 0, sin_cuenta: 0, importe_cancelado: 0,
  };
}

/** Las ventas de cada renglón: su folio, su estado y el material de lo que se llevó. */
async function _conVentas(items) {
  const ids = [...new Set(items.flatMap((i) => i._pedidos))];
  if (!ids.length) return;
  const [ventas] = await pool.query(
    `SELECT p.id, p.numero_pedido, p.estado,
            (SELECT GROUP_CONCAT(DISTINCT cat.nombre ORDER BY cat.nombre SEPARATOR ', ')
               FROM pedido_detalle d
               JOIN producto_variantes pv ON pv.id = d.variante_id
               JOIN productos pr          ON pr.id = pv.producto_id
               LEFT JOIN categorias cat   ON cat.id = pr.categoria_id
              WHERE d.pedido_id = p.id) AS materiales
       FROM pedidos p WHERE p.id IN (:ids)`,
    { ids }
  );
  const porId = new Map(ventas.map((v) => [Number(v.id), v]));
  for (const i of items) {
    i.ventas = i._pedidos.map((id) => porId.get(id)).filter(Boolean).map((v) => ({
      id: Number(v.id), folio: v.numero_pedido, estado: v.estado,
    }));
    const mats = new Set(i._pedidos.flatMap((id) => String(porId.get(id)?.materiales ?? '').split(', ').filter(Boolean)));
    i.materiales = [...mats].sort().join(', ') || null;
  }
}

// ------------------------------------------------------------ corregir / marcar

/** "pago-12" → { fuente, fuenteId } o 404. */
function partirClave(clave) {
  const m = /^(pago|abono|anticipo)-(\d+)$/.exec(String(clave ?? ''));
  if (!m) throw new AppError(404, 'NO_ENCONTRADA', 'Esa transferencia no existe');
  return { fuente: m[1], fuenteId: Number(m[2]) };
}

/** Que la transferencia exista (y sea transferencia), con los renglones de su abono. */
async function _origen(conn, fuente, fuenteId, metodos) {
  if (fuente === 'pago') {
    const [[g]] = await conn.query(
      `SELECT id FROM pagos WHERE id = :id AND metodo_pago_id IN (:metodos)
         AND estado IN ('completado', 'reembolsado') FOR UPDATE`,
      { id: fuenteId, metodos }
    );
    return g ? [Number(g.id)] : null;
  }
  if (fuente === 'anticipo') {
    const [[s]] = await conn.query(
      `SELECT id FROM saldo_favor_movimientos WHERE id = :id AND tipo = 'anticipo'
         AND metodo_pago_id IN (:metodos) FOR UPDATE`,
      { id: fuenteId, metodos }
    );
    return s ? [Number(s.id)] : null;
  }
  // El abono: su primer renglón y los demás del mismo depósito.
  const [[a]] = await conn.query(
    `SELECT cliente_id, creado_en, usuario_id, metodo_pago_id FROM credito_movimientos
      WHERE id = :id AND tipo = 'abono' AND metodo_pago_id IN (:metodos)`,
    { id: fuenteId, metodos }
  );
  if (!a) return null;
  const [rows] = await conn.query(
    `SELECT id FROM credito_movimientos
      WHERE tipo = 'abono' AND cliente_id = :c AND creado_en = :f AND metodo_pago_id = :m
        AND usuario_id <=> :u
      ORDER BY id FOR UPDATE`,
    { c: a.cliente_id, f: a.creado_en, m: a.metodo_pago_id, u: a.usuario_id }
  );
  // La llave es el PRIMERO: otro renglón del mismo abono no es otra transferencia.
  if (!rows.length || Number(rows[0].id) !== fuenteId) return null;
  return rows.map((r) => Number(r.id));
}

/**
 * Corrige o marca UNA transferencia: la cuenta (`null` = sin cuenta), el número
 * de operación, el estado y si se facturó. Queda quién la marcó y cuándo.
 */
async function actualizar(clave, cambios, usuarioId) {
  const { fuente, fuenteId } = partirClave(clave);
  await withTransaction(async (conn) => {
    const metodos = await metodosTransferencia(conn);
    const ids = metodos.length ? await _origen(conn, fuente, fuenteId, metodos) : null;
    if (!ids) throw new AppError(404, 'NO_ENCONTRADA', 'Esa transferencia no existe');
    await _guardar(conn, fuente, fuenteId, ids, cambios, usuarioId);
  });
  const [r] = (await listarPorClaves([clave])).items;
  return r;
}

async function _guardar(conn, fuente, fuenteId, ids, cambios, usuarioId) {
  // Solo se revisa la cuenta si CAMBIA: una que ya tenía y después se
  // desactivó se puede quedar (se corrige lo demás sin perderla).
  if (cambios.cuenta_bancaria_id) {
    const [[actual]] = await conn.query(
      'SELECT cuenta_bancaria_id FROM transferencias WHERE fuente = :fuente AND fuente_id = :id',
      { fuente, id: fuenteId }
    );
    if (Number(actual?.cuenta_bancaria_id) !== Number(cambios.cuenta_bancaria_id)) {
      await exigirCuenta(conn, cambios.cuenta_bancaria_id);
    }
  }
  if (cambios.referencia !== undefined) {
    const ref = cambios.referencia ? String(cambios.referencia).trim() || null : null;
    if (fuente === 'pago') {
      await conn.query('UPDATE pagos SET referencia_transaccion = :ref WHERE id IN (:ids)', { ref, ids });
    } else if (fuente === 'anticipo') {
      await conn.query('UPDATE saldo_favor_movimientos SET referencia = :ref WHERE id IN (:ids)', { ref, ids });
    } else {
      await conn.query('UPDATE credito_movimientos SET referencia = :ref WHERE id IN (:ids)', { ref, ids });
    }
  }
  await conn.query(
    'INSERT IGNORE INTO transferencias (fuente, fuente_id, creado_por) VALUES (:fuente, :id, :u)',
    { fuente, id: fuenteId, u: usuarioId }
  );
  const sets = [];
  const p = { fuente, id: fuenteId, u: usuarioId };
  if (cambios.cuenta_bancaria_id !== undefined) {
    sets.push('cuenta_bancaria_id = :cuenta');
    p.cuenta = cambios.cuenta_bancaria_id || null;
  }
  if (cambios.estado !== undefined) {
    sets.push('revisada_por = IF(:estado = estado, revisada_por, IF(:estado = \'procesada\', :u, NULL))');
    sets.push('revisada_en = IF(:estado = estado, revisada_en, IF(:estado = \'procesada\', NOW(), NULL))');
    sets.push('estado = :estado');
    p.estado = cambios.estado;
  }
  if (cambios.facturada !== undefined) {
    p.fact = cambios.facturada ? 1 : 0;
    sets.push('facturada_por = IF(:fact = facturada, facturada_por, IF(:fact = 1, :u, NULL))');
    sets.push('facturada_en = IF(:fact = facturada, facturada_en, IF(:fact = 1, NOW(), NULL))');
    sets.push('facturada = :fact');
  }
  if (sets.length) {
    await conn.query(`UPDATE transferencias SET ${sets.join(', ')} WHERE fuente = :fuente AND fuente_id = :id`, p);
  }
}

/** Marca VARIAS de una vez (Procesadas / Facturadas), todo o nada. */
async function marcarVarias(claves, cambios, usuarioId) {
  const partes = [...new Set(claves)].map(partirClave);
  await withTransaction(async (conn) => {
    const metodos = await metodosTransferencia(conn);
    for (const { fuente, fuenteId } of partes) {
      const ids = metodos.length ? await _origen(conn, fuente, fuenteId, metodos) : null;
      if (!ids) throw new AppError(404, 'NO_ENCONTRADA', `La transferencia ${fuente}-${fuenteId} no existe`);
      await _guardar(conn, fuente, fuenteId, ids, cambios, usuarioId);
    }
  });
  return { marcadas: partes.length };
}

/** Unas transferencias por su clave (para contestar con el renglón al día). */
async function listarPorClaves(claves) {
  const partes = claves.map(partirClave);
  const metodos = await metodosTransferencia();
  if (!metodos.length || !partes.length) return { items: [] };
  const cond = partes.map((_, i) => `(x.fuente = :f${i} AND x.fuente_id = :i${i})`).join(' OR ');
  const params = { metodos };
  partes.forEach((p, i) => { params[`f${i}`] = p.fuente; params[`i${i}`] = p.fuenteId; });
  const [rows] = await pool.query(`${RENGLON_SQL} WHERE ${cond}`, params);
  const items = rows.map(_renglon);
  await _conVentas(items);
  return { items: items.map(({ _pedidos, ...i }) => i) };
}

function _renglon(r) {
  return {
    clave: `${r.fuente}-${r.fuente_id}`,
    fuente: r.fuente,
    fuente_id: Number(r.fuente_id),
    fecha: r.fecha,
    importe: round2(r.importe),
    referencia: r.referencia,
    cliente_id: r.cliente_id != null ? Number(r.cliente_id) : null,
    cliente: r.cliente,
    cliente_codigo: r.cliente_codigo,
    de: r.de,
    cancelada: Boolean(Number(r.cancelada)),
    ventas: [],
    materiales: null,
    _pedidos: String(r.pedidos ?? '').split(',').map(Number).filter((n) => n > 0),
    cuenta_bancaria_id: r.cuenta_bancaria_id != null ? Number(r.cuenta_bancaria_id) : null,
    cuenta: r.cuenta_banco,
    cuenta_ultimos: r.cuenta_ultimos,
    estado: r.estado,
    facturada: Boolean(Number(r.facturada)),
    revisada_por: r.revisada_por, revisada_en: r.revisada_en,
    facturada_por: r.facturada_por, facturada_en: r.facturada_en,
  };
}

module.exports = {
  FUENTES, ESTADOS, metodosTransferencia, anotar, cuentasActivas,
  listar, actualizar, marcarVarias, partirClave,
};
