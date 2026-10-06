'use strict';

const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const jornada = require('./jornada');

// Nómina semanal del personal (domingo → sábado, pagada ese mismo sábado).
//
// REGLA DE COMISIÓN: la base comisionable es la VENTA NETA de los pedidos en
// los que el empleado figura como vendedor (pedidos.usuario_id), es decir
// `subtotal - descuento`: sin IVA y sin costo de envío. Los pedidos cancelados
// o devueltos no cuentan, igual que en el módulo de reportes.
const VENTA_VALIDA = "estado NOT IN ('cancelado','devuelto')";

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
            DATE_FORMAT(ne.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
            COALESCE(ne.comida_min, 0)          AS comida_min,
            COALESCE(ne.activo, 0)              AS activo
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       LEFT JOIN nomina_empleados ne ON ne.usuario_id = u.id
      ${soloNomina ? 'WHERE ne.usuario_id IS NOT NULL AND ne.activo = 1' : ''}
      ORDER BY u.nombre`
  );
  const horarios = await horariosDe(rows.map((r) => r.usuario_id));
  for (const r of rows) r.horario = horarios.get(Number(r.usuario_id)) ?? [];
  return rows;
}

/**
 * El horario de cada empleado, por id: { dia_semana, hora_entrada, hora_salida }
 * con las horas como 'HH:MM'. Un día sin renglón es su descanso.
 */
async function horariosDe(ids, conn = pool) {
  const mapa = new Map();
  if (!ids.length) return mapa;
  const [rows] = await conn.query(
    `SELECT usuario_id, dia_semana,
            TIME_FORMAT(hora_entrada, '%H:%i') AS hora_entrada,
            TIME_FORMAT(hora_salida,  '%H:%i') AS hora_salida
       FROM nomina_horarios
      WHERE usuario_id IN (:ids)
      ORDER BY usuario_id, dia_semana`,
    { ids }
  );
  for (const r of rows) {
    const id = Number(r.usuario_id);
    if (!mapa.has(id)) mapa.set(id, []);
    mapa.get(id).push({ dia_semana: Number(r.dia_semana), hora_entrada: r.hora_entrada, hora_salida: r.hora_salida });
  }
  return mapa;
}

async function obtenerEmpleado(usuarioId) {
  const [rows] = await pool.query(
    `SELECT u.id AS usuario_id, u.nombre, u.correo, r.nombre AS rol, u.activo AS usuario_activo,
            (ne.usuario_id IS NOT NULL) AS en_nomina,
            COALESCE(ne.sueldo_base_semanal, 0) AS sueldo_base_semanal,
            COALESCE(ne.paga_comision, 0)       AS paga_comision,
            COALESCE(ne.porcentaje_comision, 0) AS porcentaje_comision,
            COALESCE(ne.valor_hora_extra, 0)    AS valor_hora_extra,
            DATE_FORMAT(ne.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
            COALESCE(ne.comida_min, 0)          AS comida_min,
            COALESCE(ne.activo, 0)              AS activo
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       LEFT JOIN nomina_empleados ne ON ne.usuario_id = u.id
      WHERE u.id = :id
      LIMIT 1`,
    { id: usuarioId }
  );
  const emp = rows[0] || null;
  if (emp) emp.horario = (await horariosDe([emp.usuario_id])).get(Number(emp.usuario_id)) ?? [];
  return emp;
}

/**
 * Alta o actualización de la configuración de nómina de un empleado. Si trae
 * `horario`, lo REEMPLAZA completo (los días que no vienen quedan de descanso);
 * sin `horario`, el que tenía se queda igual.
 */
async function guardarEmpleado(usuarioId, datos) {
  const { horario, ...config } = datos;
  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO nomina_empleados
         (usuario_id, sueldo_base_semanal, paga_comision, porcentaje_comision, valor_hora_extra,
          fecha_ingreso, comida_min, activo)
       VALUES (:usuario_id, :sueldo_base_semanal, :paga_comision, :porcentaje_comision, :valor_hora_extra,
               :fecha_ingreso, :comida_min, :activo)
       ON DUPLICATE KEY UPDATE
         sueldo_base_semanal = :sueldo_base_semanal,
         paga_comision       = :paga_comision,
         porcentaje_comision = :porcentaje_comision,
         valor_hora_extra    = :valor_hora_extra,
         fecha_ingreso       = :fecha_ingreso,
         comida_min          = :comida_min,
         activo              = :activo`,
      { usuario_id: usuarioId, ...config }
    );
    if (horario) {
      await conn.query('DELETE FROM nomina_horarios WHERE usuario_id = :id', { id: usuarioId });
      for (const d of horario) {
        await conn.query(
          `INSERT INTO nomina_horarios (usuario_id, dia_semana, hora_entrada, hora_salida)
           VALUES (:id, :dia, :entrada, :salida)`,
          { id: usuarioId, dia: d.dia_semana, entrada: d.hora_entrada, salida: d.hora_salida }
        );
      }
    }
  });
  return obtenerEmpleado(usuarioId);
}

// ---------------------------------------------------------------------------
// Vacaciones
// ---------------------------------------------------------------------------

const SELECT_VACACIONES = `
  SELECT v.id, v.usuario_id,
         DATE_FORMAT(v.fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
         DATE_FORMAT(v.fecha_fin,    '%Y-%m-%d') AS fecha_fin,
         v.dias, v.notas, v.creado_en, u.nombre AS creado_por
    FROM nomina_vacaciones v
    LEFT JOIN usuarios u ON u.id = v.creado_por
`;

async function listarVacaciones(usuarioId, conn = pool) {
  const [rows] = await conn.query(
    `${SELECT_VACACIONES} WHERE v.usuario_id = :id ORDER BY v.fecha_inicio DESC`,
    { id: usuarioId }
  );
  return rows;
}

async function obtenerVacaciones(id) {
  const [rows] = await pool.query(`${SELECT_VACACIONES} WHERE v.id = :id LIMIT 1`, { id });
  return rows[0] || null;
}

/** Semanas de nómina que tocan un rango de fechas (para no mover una ya pagada). */
async function periodosEnRango(desde, hasta, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, estado,
            DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
            DATE_FORMAT(fecha_fin,    '%Y-%m-%d') AS fecha_fin
       FROM nomina_periodos
      WHERE fecha_inicio <= :hasta AND fecha_fin >= :desde
      ORDER BY fecha_inicio`,
    { desde, hasta }
  );
  return rows;
}

/**
 * Registra unas vacaciones y recalcula las semanas en borrador que tocan, para
 * que esos días se paguen como días normales. Todo junto o nada.
 */
async function crearVacaciones(datos) {
  return withTransaction(async (conn) => {
    // Bloquea al empleado: dos registros a la vez no deben pasarse del saldo.
    await conn.query('SELECT usuario_id FROM nomina_empleados WHERE usuario_id = :id FOR UPDATE', {
      id: datos.usuario_id,
    });
    const [encimadas] = await conn.query(
      `SELECT DATE_FORMAT(fecha_inicio, '%d/%m/%Y') AS ini, DATE_FORMAT(fecha_fin, '%d/%m/%Y') AS fin
         FROM nomina_vacaciones
        WHERE usuario_id = :id AND fecha_inicio <= :hasta AND fecha_fin >= :desde
        LIMIT 1`,
      { id: datos.usuario_id, desde: datos.fecha_inicio, hasta: datos.fecha_fin }
    );
    if (encimadas.length) {
      throw new AppError(409, 'VACACIONES_ENCIMADAS',
        `Esas fechas se enciman con sus vacaciones del ${encimadas[0].ini} al ${encimadas[0].fin}.`);
    }
    const [r] = await conn.query(
      `INSERT INTO nomina_vacaciones (usuario_id, fecha_inicio, fecha_fin, dias, notas, creado_por)
       VALUES (:usuario_id, :fecha_inicio, :fecha_fin, :dias, :notas, :creado_por)`,
      { ...datos, notas: datos.notas ?? null, creado_por: datos.creado_por ?? null }
    );
    await _recalcularBorradores(conn, datos.fecha_inicio, datos.fecha_fin);
    return r.insertId;
  });
}

async function eliminarVacaciones(id) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, usuario_id,
              DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
              DATE_FORMAT(fecha_fin,    '%Y-%m-%d') AS fecha_fin
         FROM nomina_vacaciones WHERE id = :id FOR UPDATE`,
      { id }
    );
    const v = rows[0];
    if (!v) throw new AppError(404, 'NO_ENCONTRADO', 'Vacaciones no encontradas');
    await conn.query('DELETE FROM nomina_vacaciones WHERE id = :id', { id });
    await _recalcularBorradores(conn, v.fecha_inicio, v.fecha_fin);
    return v;
  });
}

/** Recalcula las semanas EN BORRADOR (y ya calculadas) que tocan el rango. */
async function _recalcularBorradores(conn, desde, hasta) {
  const periodos = await periodosEnRango(desde, hasta, conn);
  for (const p of periodos) {
    if (p.estado !== 'borrador') continue;
    const [[{ n }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM nomina_recibos WHERE periodo_id = :id', { id: p.id }
    );
    if (Number(n) > 0) await _calcular(conn, p.id);
  }
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
            r.sueldo_base, r.dias_laborales, r.dias_trabajados, r.dias_vacaciones,
            r.salario_diario, r.valor_hora, r.pago_vacaciones,
            r.num_pedidos, r.ventas_netas, r.porcentaje_comision, r.comision,
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
    `SELECT c.id, c.recibo_id, c.tipo, c.clave, c.descripcion, c.cantidad, c.importe, c.creado_en,
            DATE_FORMAT(c.fecha, '%Y-%m-%d') AS fecha,
            TIME_FORMAT(c.hora_entrada, '%H:%i') AS hora_entrada,
            TIME_FORMAT(c.hora_salida,  '%H:%i') AS hora_salida
       FROM nomina_recibo_conceptos c
       JOIN nomina_recibos r ON r.id = c.recibo_id
      WHERE r.periodo_id = :id
      ORDER BY c.id`,
    { id: periodoId }
  );
  const porRecibo = new Map(recibos.map((r) => [r.id, []]));
  for (const c of conceptos) porRecibo.get(c.recibo_id)?.push(c);
  // El horario VIGENTE de cada quien: el recibo lo usa para calcular horas extra.
  const horarios = await horariosDe(recibos.map((r) => r.usuario_id));
  for (const r of recibos) {
    r.conceptos = porRecibo.get(r.id) ?? [];
    r.horario = horarios.get(Number(r.usuario_id)) ?? [];
  }

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
 * total = sueldo_base + pago_vacaciones + comision + otras_percepciones - deducciones
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
            total_pagar        = sueldo_base + pago_vacaciones + comision + :percepciones - :deducciones
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
  return withTransaction((conn) => _calcular(conn, periodoId));
}

/**
 * El cálculo, dentro de una transacción abierta (lo reusan las vacaciones y
 * los días trabajados, que recalculan la semana en el mismo movimiento).
 *
 * Con horario, el recibo paga POR DÍAS (decisión del usuario, 2026-10-06):
 *   día = sueldo semanal ÷ días que trabaja
 *   sueldo del recibo  = día × días trabajados
 *   vacaciones         = día × días de vacaciones que caen en la semana
 * Las faltas que ya se capturaron (días de su horario que no trabajó ni fueron
 * vacaciones) se CONSERVAN al recalcular: si después se registran vacaciones,
 * se descuentan de los días trabajados sin borrar la falta.
 * Sin horario, el recibo paga el sueldo semanal completo, como antes.
 */
async function _calcular(conn, periodoId) {
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
    `SELECT ne.usuario_id, ne.sueldo_base_semanal, ne.paga_comision, ne.porcentaje_comision,
            ne.comida_min
       FROM nomina_empleados ne
       JOIN usuarios u ON u.id = ne.usuario_id
      WHERE ne.activo = 1`
  );
  if (empleados.length === 0) {
    throw new AppError(422, 'SIN_EMPLEADOS',
      'No hay personal dado de alta en la nómina. Configúralo antes de calcular.');
  }
  const ids = empleados.map((e) => e.usuario_id);
  const horarios = await horariosDe(ids, conn);

  // Vacaciones que tocan la semana, por empleado.
  const [vacaciones] = await conn.query(
    `SELECT usuario_id,
            DATE_FORMAT(GREATEST(fecha_inicio, :ini), '%Y-%m-%d') AS desde,
            DATE_FORMAT(LEAST(fecha_fin, :fin), '%Y-%m-%d')       AS hasta
       FROM nomina_vacaciones
      WHERE usuario_id IN (:ids) AND fecha_inicio <= :fin AND fecha_fin >= :ini`,
    { ids, ini: periodo.fecha_inicio, fin: periodo.fecha_fin }
  );

  // Lo que ya tenía cada recibo: de ahí salen las faltas capturadas.
  const [previos] = await conn.query(
    `SELECT usuario_id, dias_laborales, dias_trabajados, dias_vacaciones
       FROM nomina_recibos WHERE periodo_id = :id`,
    { id: periodoId }
  );
  const previoPorUsuario = new Map(previos.map((r) => [Number(r.usuario_id), r]));

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
    const id = Number(emp.usuario_id);
    const venta = ventaPorUsuario.get(id);
    const ventasNetas = venta ? round2(venta.ventas_netas) : 0;
    const numPedidos = venta ? Number(venta.num_pedidos) : 0;
    const pct = emp.paga_comision ? Number(emp.porcentaje_comision) : 0;
    const comision = round2((ventasNetas * pct) / 100);
    const sueldo = Number(emp.sueldo_base_semanal);

    const horario = horarios.get(id) ?? [];
    let dias = { laborales: null, trabajados: null, vacaciones: 0, diario: null, hora: null };
    let sueldoBase = round2(sueldo);
    let pagoVacaciones = 0;
    if (horario.length) {
      const laborales = jornada.diasLaborales(horario);
      const vac = Math.min(
        laborales,
        vacaciones
          .filter((v) => Number(v.usuario_id) === id)
          .reduce((s, v) => s + jornada.diasHabilesEnRango(horario, v.desde, v.hasta), 0)
      );
      const previo = previoPorUsuario.get(id);
      const faltas = previo && previo.dias_laborales !== null && previo.dias_trabajados !== null
        ? Math.max(0, Number(previo.dias_laborales) - Number(previo.dias_vacaciones) - Number(previo.dias_trabajados))
        : 0;
      const trabajados = Math.max(0, laborales - vac - faltas);
      dias = {
        laborales,
        trabajados,
        vacaciones: vac,
        diario: jornada.salarioDiario(sueldo, horario),
        hora: jornada.valorHora(sueldo, horario, emp.comida_min),
      };
      sueldoBase = jornada.pagoPorDias(sueldo, horario, trabajados);
      pagoVacaciones = jornada.pagoPorDias(sueldo, horario, vac);
    }

    await conn.query(
      `INSERT INTO nomina_recibos
         (periodo_id, usuario_id, sueldo_base, dias_laborales, dias_trabajados, dias_vacaciones,
          salario_diario, valor_hora, pago_vacaciones, num_pedidos, ventas_netas,
          porcentaje_comision, comision, total_pagar)
       VALUES (:periodo_id, :usuario_id, :sueldo_base, :laborales, :trabajados, :vacaciones,
               :diario, :hora, :pago_vacaciones, :num_pedidos, :ventas_netas,
               :pct, :comision, :sueldo_base + :pago_vacaciones + :comision)
       ON DUPLICATE KEY UPDATE
         sueldo_base         = :sueldo_base,
         dias_laborales      = :laborales,
         dias_trabajados     = :trabajados,
         dias_vacaciones     = :vacaciones,
         salario_diario      = :diario,
         valor_hora          = :hora,
         pago_vacaciones     = :pago_vacaciones,
         num_pedidos         = :num_pedidos,
         ventas_netas        = :ventas_netas,
         porcentaje_comision = :pct,
         comision            = :comision`,
      {
        periodo_id: periodoId,
        usuario_id: emp.usuario_id,
        sueldo_base: sueldoBase,
        ...dias,
        pago_vacaciones: pagoVacaciones,
        num_pedidos: numPedidos,
        ventas_netas: ventasNetas,
        pct,
        comision,
      }
    );
  }

  // Fuera de la nómina = fuera del periodo (arrastra sus conceptos por CASCADE).
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
}

/**
 * Cuántos días trabajó de verdad en la semana (los que faltan para llegar a los
 * de su horario, sin contar vacaciones, son faltas y no se pagan). Recalcula la
 * semana en el mismo movimiento para que el recibo quede al día.
 */
async function fijarDiasTrabajados(reciboId, diasTrabajados) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT r.id, r.periodo_id, r.dias_laborales, r.dias_vacaciones, p.estado AS periodo_estado
         FROM nomina_recibos r JOIN nomina_periodos p ON p.id = r.periodo_id
        WHERE r.id = :id FOR UPDATE`,
      { id: reciboId }
    );
    const recibo = rows[0];
    if (!recibo) throw new AppError(404, 'NO_ENCONTRADO', 'Recibo de nómina no encontrado');
    if (recibo.periodo_estado !== 'borrador') {
      throw new AppError(409, 'PERIODO_CERRADO', 'Esta nómina ya no está en borrador: no se puede cambiar.');
    }
    if (recibo.dias_laborales === null) {
      throw new AppError(422, 'SIN_HORARIO',
        'Este empleado no tiene horario: captúralo en Sueldos y comisiones y recalcula la semana.');
    }
    const maximo = Number(recibo.dias_laborales) - Number(recibo.dias_vacaciones);
    if (diasTrabajados > maximo) {
      throw new AppError(422, 'DIAS_DE_MAS',
        Number(recibo.dias_vacaciones) > 0
          ? `Su horario tiene ${Number(recibo.dias_laborales)} días y ${Number(recibo.dias_vacaciones)} fueron de vacaciones: trabajó ${maximo} como máximo.`
          : `Su horario tiene ${maximo} días a la semana: no puede haber trabajado más.`);
    }
    await conn.query('UPDATE nomina_recibos SET dias_trabajados = :d WHERE id = :id', {
      d: diasTrabajados,
      id: reciboId,
    });
    await _calcular(conn, recibo.periodo_id);
    return recibo.periodo_id;
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

    // Horas extra del mismo día, una sola vez: dos renglones del martes pagarían doble.
    if (datos.fecha) {
      const [dup] = await conn.query(
        `SELECT id FROM nomina_recibo_conceptos
          WHERE recibo_id = :id AND clave = 'horas_extra' AND fecha = :fecha LIMIT 1`,
        { id: reciboId, fecha: datos.fecha }
      );
      if (dup.length) {
        throw new AppError(409, 'HORAS_EXTRA_DUPLICADAS',
          'Ese día ya tiene horas extra. Quítalas y vuelve a capturarlas si cambiaron.');
      }
    }
    const [r] = await conn.query(
      `INSERT INTO nomina_recibo_conceptos
         (recibo_id, tipo, clave, descripcion, cantidad, fecha, hora_entrada, hora_salida, importe)
       VALUES (:recibo_id, :tipo, :clave, :descripcion, :cantidad, :fecha, :hora_entrada, :hora_salida, :importe)`,
      {
        recibo_id: reciboId,
        tipo: datos.tipo,
        clave: datos.clave,
        descripcion: datos.descripcion ?? null,
        cantidad: datos.cantidad ?? null,
        fecha: datos.fecha ?? null,
        hora_entrada: datos.hora_entrada ?? null,
        hora_salida: datos.hora_salida ?? null,
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
  listarEmpleados,
  obtenerEmpleado,
  guardarEmpleado,
  horariosDe,
  listarVacaciones,
  obtenerVacaciones,
  periodosEnRango,
  crearVacaciones,
  eliminarVacaciones,
  fijarDiasTrabajados,
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
