'use strict';

const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');

// Nómina semanal del personal (domingo → sábado, pagada ese mismo sábado).
//
// REGLA DE COMISIÓN: la base comisionable es la VENTA NETA de los pedidos en
// los que el empleado figura como vendedor (pedidos.usuario_id), es decir
// `subtotal - descuento`: sin IVA y sin costo de envío. Los pedidos cancelados
// o devueltos no cuentan, igual que en el módulo de reportes.
const VENTA_VALIDA = "estado NOT IN ('cancelado','devuelto')";

const ESTADOS = ['borrador', 'pagado', 'cancelado'];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Configuración de nómina por empleado
// ---------------------------------------------------------------------------

/**
 * Lista el staff con su configuración de nómina. Los usuarios sin fila en
 * `nomina_empleados` aparecen con `en_nomina = 0` para poder darlos de alta.
 */
async function listarEmpleados({ soloNomina } = {}) {
  const [rows] = await pool.query(
    `SELECT u.id AS usuario_id, u.nombre, u.correo, r.nombre AS rol, u.activo AS usuario_activo,
            (ne.usuario_id IS NOT NULL) AS en_nomina,
            COALESCE(ne.sueldo_base_semanal, 0) AS sueldo_base_semanal,
            COALESCE(ne.paga_comision, 0)       AS paga_comision,
            COALESCE(ne.porcentaje_comision, 0) AS porcentaje_comision,
            COALESCE(ne.valor_hora_extra, 0)    AS valor_hora_extra,
            COALESCE(ne.activo, 0)              AS activo
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       LEFT JOIN nomina_empleados ne ON ne.usuario_id = u.id
      ${soloNomina ? 'WHERE ne.usuario_id IS NOT NULL AND ne.activo = 1' : ''}
      ORDER BY u.nombre`
  );
  return rows;
}

async function obtenerEmpleado(usuarioId) {
  const [rows] = await pool.query(
    `SELECT u.id AS usuario_id, u.nombre, u.correo, r.nombre AS rol, u.activo AS usuario_activo,
            (ne.usuario_id IS NOT NULL) AS en_nomina,
            COALESCE(ne.sueldo_base_semanal, 0) AS sueldo_base_semanal,
            COALESCE(ne.paga_comision, 0)       AS paga_comision,
            COALESCE(ne.porcentaje_comision, 0) AS porcentaje_comision,
            COALESCE(ne.valor_hora_extra, 0)    AS valor_hora_extra,
            COALESCE(ne.activo, 0)              AS activo
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       LEFT JOIN nomina_empleados ne ON ne.usuario_id = u.id
      WHERE u.id = :id
      LIMIT 1`,
    { id: usuarioId }
  );
  return rows[0] || null;
}

/** Alta o actualización de la configuración de nómina de un empleado. */
async function guardarEmpleado(usuarioId, datos) {
  await pool.query(
    `INSERT INTO nomina_empleados
       (usuario_id, sueldo_base_semanal, paga_comision, porcentaje_comision, valor_hora_extra, activo)
     VALUES (:usuario_id, :sueldo_base_semanal, :paga_comision, :porcentaje_comision, :valor_hora_extra, :activo)
     ON DUPLICATE KEY UPDATE
       sueldo_base_semanal = :sueldo_base_semanal,
       paga_comision       = :paga_comision,
       porcentaje_comision = :porcentaje_comision,
       valor_hora_extra    = :valor_hora_extra,
       activo              = :activo`,
    { usuario_id: usuarioId, ...datos }
  );
  return obtenerEmpleado(usuarioId);
}

// ---------------------------------------------------------------------------
// Periodos
// ---------------------------------------------------------------------------

// Las columnas DATE se devuelven ya formateadas: mysql2 las entrega como
// objeto Date y aquí siempre se tratan como 'YYYY-MM-DD'.
const SELECT_PERIODO = `
  SELECT p.id,
         DATE_FORMAT(p.fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
         DATE_FORMAT(p.fecha_fin,    '%Y-%m-%d') AS fecha_fin,
         DATE_FORMAT(p.fecha_pago,   '%Y-%m-%d') AS fecha_pago,
         p.estado, p.notas,
         p.creado_por, u.nombre AS creado_por_nombre, p.creado_en, p.actualizado_en
    FROM nomina_periodos p
    LEFT JOIN usuarios u ON u.id = p.creado_por
`;

async function obtenerPeriodoPorInicio(fechaInicio) {
  const [rows] = await pool.query(`${SELECT_PERIODO} WHERE p.fecha_inicio = :f LIMIT 1`, {
    f: fechaInicio,
  });
  return rows[0] || null;
}

async function obtenerPeriodo(id) {
  const [rows] = await pool.query(`${SELECT_PERIODO} WHERE p.id = :id LIMIT 1`, { id });
  return rows[0] || null;
}

async function crearPeriodo({ fecha_inicio, fecha_fin, fecha_pago, notas }, usuarioId) {
  const [r] = await pool.query(
    `INSERT INTO nomina_periodos (fecha_inicio, fecha_fin, fecha_pago, notas, creado_por)
     VALUES (:fecha_inicio, :fecha_fin, :fecha_pago, :notas, :creado_por)`,
    { fecha_inicio, fecha_fin, fecha_pago, notas: notas ?? null, creado_por: usuarioId ?? null }
  );
  return obtenerPeriodo(r.insertId);
}

/** Listado de periodos con el total ya calculado de cada uno. */
async function listarPeriodos({ estado, limit, offset }) {
  const where = [];
  const params = { limit, offset };
  if (estado) {
    where.push('p.estado = :estado');
    params.estado = estado;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT p.id,
            DATE_FORMAT(p.fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
            DATE_FORMAT(p.fecha_fin,    '%Y-%m-%d') AS fecha_fin,
            DATE_FORMAT(p.fecha_pago,   '%Y-%m-%d') AS fecha_pago,
            p.estado,
            COUNT(r.id) AS num_recibos,
            COALESCE(SUM(r.total_pagar), 0) AS total_nomina
       FROM nomina_periodos p
       LEFT JOIN nomina_recibos r ON r.periodo_id = p.id
       ${whereSql}
      GROUP BY p.id, p.fecha_inicio, p.fecha_fin, p.fecha_pago, p.estado
      ORDER BY p.fecha_inicio DESC
      LIMIT :limit OFFSET :offset`,
    params
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM nomina_periodos p ${whereSql}`,
    params
  );
  return { rows, total };
}

async function cambiarEstadoPeriodo(id, estado) {
  const [r] = await pool.query('UPDATE nomina_periodos SET estado = :estado WHERE id = :id', {
    estado,
    id,
  });
  if (r.affectedRows === 0) throw new AppError(404, 'NO_ENCONTRADO', 'Periodo de nómina no encontrado');
  return obtenerPeriodo(id);
}

// ---------------------------------------------------------------------------
// Recibos y conceptos
// ---------------------------------------------------------------------------

async function listarRecibos(periodoId) {
  const [recibos] = await pool.query(
    `SELECT r.id, r.periodo_id, r.usuario_id, u.nombre AS usuario, rol.nombre AS rol,
            r.sueldo_base, r.num_pedidos, r.ventas_netas, r.porcentaje_comision, r.comision,
            r.otras_percepciones, r.deducciones, r.total_pagar, r.notas
       FROM nomina_recibos r
       JOIN usuarios u  ON u.id = r.usuario_id
       JOIN roles rol   ON rol.id = u.rol_id
      WHERE r.periodo_id = :id
      ORDER BY u.nombre`,
    { id: periodoId }
  );
  if (recibos.length === 0) return [];

  const [conceptos] = await pool.query(
    `SELECT c.id, c.recibo_id, c.tipo, c.clave, c.descripcion, c.cantidad, c.importe, c.creado_en
       FROM nomina_recibo_conceptos c
       JOIN nomina_recibos r ON r.id = c.recibo_id
      WHERE r.periodo_id = :id
      ORDER BY c.id`,
    { id: periodoId }
  );
  const porRecibo = new Map(recibos.map((r) => [r.id, []]));
  for (const c of conceptos) porRecibo.get(c.recibo_id)?.push(c);
  for (const r of recibos) r.conceptos = porRecibo.get(r.id) ?? [];

  return recibos;
}

async function obtenerRecibo(id) {
  const [rows] = await pool.query(
    `SELECT r.*, u.nombre AS usuario, p.estado AS periodo_estado
       FROM nomina_recibos r
       JOIN usuarios u        ON u.id = r.usuario_id
       JOIN nomina_periodos p ON p.id = r.periodo_id
      WHERE r.id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

/**
 * Recalcula percepciones/deducciones manuales de un recibo y su total.
 * total = sueldo_base + comision + otras_percepciones - deducciones
 */
async function _recalcularTotales(conn, reciboId) {
  const [[sumas]] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN tipo = 'percepcion' THEN importe END), 0) AS percepciones,
            COALESCE(SUM(CASE WHEN tipo = 'deduccion'  THEN importe END), 0) AS deducciones
       FROM nomina_recibo_conceptos WHERE recibo_id = :id`,
    { id: reciboId }
  );
  await conn.query(
    `UPDATE nomina_recibos
        SET otras_percepciones = :percepciones,
            deducciones        = :deducciones,
            total_pagar        = sueldo_base + comision + :percepciones - :deducciones
      WHERE id = :id`,
    { id: reciboId, percepciones: sumas.percepciones, deducciones: sumas.deducciones }
  );
}

/**
 * (Re)calcula los recibos del periodo a partir de la configuración vigente y
 * de las ventas de la semana. Conserva los conceptos manuales ya capturados;
 * elimina los recibos de quien salió de la nómina.
 */
async function calcularPeriodo(periodoId) {
  return withTransaction(async (conn) => {
    const [prows] = await conn.query(
      `SELECT id, estado,
              DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
              DATE_FORMAT(fecha_fin,    '%Y-%m-%d') AS fecha_fin
         FROM nomina_periodos WHERE id = :id FOR UPDATE`,
      { id: periodoId }
    );
    const periodo = prows[0];
    if (!periodo) throw new AppError(404, 'NO_ENCONTRADO', 'Periodo de nómina no encontrado');
    if (periodo.estado !== 'borrador') {
      throw new AppError(409, 'PERIODO_CERRADO',
        'Solo se puede recalcular un periodo en borrador');
    }

    const desde = `${periodo.fecha_inicio} 00:00:00`;
    const hastaExcl = _diaSiguiente(periodo.fecha_fin);

    // Empleados vigentes en la nómina.
    const [empleados] = await conn.query(
      `SELECT ne.usuario_id, ne.sueldo_base_semanal, ne.paga_comision, ne.porcentaje_comision
         FROM nomina_empleados ne
         JOIN usuarios u ON u.id = ne.usuario_id
        WHERE ne.activo = 1`
    );
    if (empleados.length === 0) {
      throw new AppError(422, 'SIN_EMPLEADOS',
        'No hay personal dado de alta en la nómina. Configúralo antes de calcular.');
    }

    // Venta neta de la semana por vendedor.
    const [ventas] = await conn.query(
      `SELECT usuario_id, COUNT(*) AS num_pedidos,
              COALESCE(SUM(subtotal - descuento), 0) AS ventas_netas
         FROM pedidos
        WHERE usuario_id IS NOT NULL
          AND creado_en >= :desde AND creado_en < :hasta
          AND ${VENTA_VALIDA}
        GROUP BY usuario_id`,
      { desde, hasta: hastaExcl }
    );
    const ventaPorUsuario = new Map(ventas.map((v) => [Number(v.usuario_id), v]));

    // Upsert de un recibo por empleado.
    for (const emp of empleados) {
      const venta = ventaPorUsuario.get(Number(emp.usuario_id));
      const ventasNetas = venta ? round2(venta.ventas_netas) : 0;
      const numPedidos = venta ? Number(venta.num_pedidos) : 0;
      const pct = emp.paga_comision ? Number(emp.porcentaje_comision) : 0;
      const comision = round2((ventasNetas * pct) / 100);
      const sueldoBase = round2(emp.sueldo_base_semanal);

      await conn.query(
        `INSERT INTO nomina_recibos
           (periodo_id, usuario_id, sueldo_base, num_pedidos, ventas_netas,
            porcentaje_comision, comision, total_pagar)
         VALUES (:periodo_id, :usuario_id, :sueldo_base, :num_pedidos, :ventas_netas,
                 :pct, :comision, :sueldo_base + :comision)
         ON DUPLICATE KEY UPDATE
           sueldo_base         = :sueldo_base,
           num_pedidos         = :num_pedidos,
           ventas_netas        = :ventas_netas,
           porcentaje_comision = :pct,
           comision            = :comision`,
        {
          periodo_id: periodoId,
          usuario_id: emp.usuario_id,
          sueldo_base: sueldoBase,
          num_pedidos: numPedidos,
          ventas_netas: ventasNetas,
          pct,
          comision,
        }
      );
    }

    // Fuera de la nómina = fuera del periodo (arrastra sus conceptos por CASCADE).
    const ids = empleados.map((e) => e.usuario_id);
    await conn.query(
      'DELETE FROM nomina_recibos WHERE periodo_id = :id AND usuario_id NOT IN (:ids)',
      { id: periodoId, ids }
    );

    // Reaplica los conceptos manuales sobre los montos recién calculados.
    const [recibos] = await conn.query(
      'SELECT id FROM nomina_recibos WHERE periodo_id = :id',
      { id: periodoId }
    );
    for (const r of recibos) await _recalcularTotales(conn, r.id);

    return recibos.length;
  });
}

async function agregarConcepto(reciboId, datos) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT r.id, p.estado AS periodo_estado
         FROM nomina_recibos r JOIN nomina_periodos p ON p.id = r.periodo_id
        WHERE r.id = :id FOR UPDATE`,
      { id: reciboId }
    );
    const recibo = rows[0];
    if (!recibo) throw new AppError(404, 'NO_ENCONTRADO', 'Recibo de nómina no encontrado');
    if (recibo.periodo_estado !== 'borrador') {
      throw new AppError(409, 'PERIODO_CERRADO',
        'No se pueden agregar conceptos a un periodo que ya no está en borrador');
    }

    const [r] = await conn.query(
      `INSERT INTO nomina_recibo_conceptos (recibo_id, tipo, clave, descripcion, cantidad, importe)
       VALUES (:recibo_id, :tipo, :clave, :descripcion, :cantidad, :importe)`,
      {
        recibo_id: reciboId,
        tipo: datos.tipo,
        clave: datos.clave,
        descripcion: datos.descripcion ?? null,
        cantidad: datos.cantidad ?? null,
        importe: datos.importe,
      }
    );
    await _recalcularTotales(conn, reciboId);
    return r.insertId;
  });
}

async function eliminarConcepto(conceptoId) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT c.id, c.recibo_id, p.estado AS periodo_estado
         FROM nomina_recibo_conceptos c
         JOIN nomina_recibos r  ON r.id = c.recibo_id
         JOIN nomina_periodos p ON p.id = r.periodo_id
        WHERE c.id = :id FOR UPDATE`,
      { id: conceptoId }
    );
    const concepto = rows[0];
    if (!concepto) throw new AppError(404, 'NO_ENCONTRADO', 'Concepto no encontrado');
    if (concepto.periodo_estado !== 'borrador') {
      throw new AppError(409, 'PERIODO_CERRADO',
        'No se pueden quitar conceptos de un periodo que ya no está en borrador');
    }

    await conn.query('DELETE FROM nomina_recibo_conceptos WHERE id = :id', { id: conceptoId });
    await _recalcularTotales(conn, concepto.recibo_id);
    return concepto.recibo_id;
  });
}

/** Pedidos que forman la base comisionable de un empleado en el periodo. */
async function ventasDelPeriodo(periodoId, usuarioId) {
  const periodo = await obtenerPeriodo(periodoId);
  if (!periodo) throw new AppError(404, 'NO_ENCONTRADO', 'Periodo de nómina no encontrado');

  const desde = `${periodo.fecha_inicio} 00:00:00`;
  const hastaExcl = _diaSiguiente(periodo.fecha_fin);

  const [rows] = await pool.query(
    `SELECT id, numero_pedido, canal, estado, creado_en,
            subtotal, descuento, impuestos, costo_envio, total,
            (subtotal - descuento) AS venta_neta
       FROM pedidos
      WHERE usuario_id = :usuario_id
        AND creado_en >= :desde AND creado_en < :hasta
        AND ${VENTA_VALIDA}
      ORDER BY creado_en`,
    { usuario_id: usuarioId, desde, hasta: hastaExcl }
  );
  return rows;
}

/**
 * Devuelve 'YYYY-MM-DD 00:00:00' del día siguiente (límite superior exclusivo).
 * Acepta un string 'YYYY-MM-DD' o el objeto Date que devuelve mysql2 para DATE.
 */
function _diaSiguiente(fecha) {
  const iso = fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10);
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(500, 'FECHA_PERIODO_INVALIDA', `Fecha de periodo ilegible: ${fecha}`);
  }
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)} 00:00:00`;
}

module.exports = {
  ESTADOS,
  listarEmpleados,
  obtenerEmpleado,
  guardarEmpleado,
  obtenerPeriodoPorInicio,
  obtenerPeriodo,
  crearPeriodo,
  listarPeriodos,
  cambiarEstadoPeriodo,
  listarRecibos,
  obtenerRecibo,
  calcularPeriodo,
  agregarConcepto,
  eliminarConcepto,
  ventasDelPeriodo,
};
