'use strict';

const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const archivos = require('../../utils/archivos');
const cajaModel = require('./model');

/**
 * GASTOS DE LA CAJA (2026-10-20). "Otro apartado de gastos con límites; va en
 * caja porque el dinero sale de caja y no se calcula en nómina; tiene que
 * llevar tipo: viajes, limpieza, papelería…" (usuario). Decidió:
 *   · el LÍMITE es POR GASTO: un tope para cada gasto suelto de ese tipo;
 *   · pasarlo PIDE AUTORIZACIÓN (`autorizaciones/operaciones.js →
 *     gasto_sobre_limite`, en la ruta);
 *   · un tipo SIN límite NO es "pasa todo": TODO gasto de ese tipo se autoriza
 *     (revisor de tiendas, 2026-10-20: con "sin límite" la cajera sacaba $8,000
 *     como "Viajes" sin pedir nada, cuando un retiro sí se lo pide). Quien
 *     autoriza (`hacer:gasto_sobre_limite`) los registra directo;
 *   · la foto del ticket es OPCIONAL y se sube aparte (el gasto puede quedar
 *     esperando autorización, y entonces todavía no existe).
 *
 * El dinero sale del cajón del turno ABIERTO: un `movimientos_caja` 'gasto' que
 * el corte resta (SIGNO_CAJA), ligado a su renglón aquí. No puede sacar más de
 * lo que debería haber en el cajón. Cancelarlo (con el turno abierto todavía)
 * regresa el dinero como 'ingreso' y el gasto queda "cancelado", con su rastro.
 */

const CARPETA = 'gastos';
const TOPE_LISTA = 500;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pesos = (n) => `$${Number(n ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------- los tipos

async function listarTipos({ todos = false } = {}) {
  const [rows] = await pool.query(
    `SELECT id, nombre, limite, activo FROM tipos_gasto ${todos ? '' : 'WHERE activo = 1'} ORDER BY nombre`
  );
  return rows.map((t) => ({ ...t, limite: t.limite == null ? null : Number(t.limite), activo: !!t.activo }));
}

async function obtenerTipo(id, ejecutor = pool) {
  const [[t]] = await ejecutor.query('SELECT id, nombre, limite, activo FROM tipos_gasto WHERE id = :id', { id });
  return t ? { ...t, limite: t.limite == null ? null : Number(t.limite), activo: !!t.activo } : null;
}

/** El nombre no se repite (sin importar mayúsculas ni espacios de más). */
async function exigirNombreLibre(nombre, id = null) {
  const [[ya]] = await pool.query(
    'SELECT id FROM tipos_gasto WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(:nombre)) AND (:id IS NULL OR id <> :id)',
    { nombre, id }
  );
  if (ya) throw new AppError(409, 'TIPO_GASTO_REPETIDO', `Ya hay un tipo de gasto «${nombre}».`);
}

async function crearTipo({ nombre, limite = null, activo = true }) {
  const n = String(nombre).trim();
  await exigirNombreLibre(n);
  const [r] = await pool.query(
    'INSERT INTO tipos_gasto (nombre, limite, activo) VALUES (:n, :l, :a)',
    { n, l: limite ?? null, a: activo ? 1 : 0 }
  );
  return obtenerTipo(r.insertId);
}

async function actualizarTipo(id, datos) {
  const t = await obtenerTipo(id);
  if (!t) throw new AppError(404, 'NO_ENCONTRADO', 'Ese tipo de gasto no existe.');
  const nombre = datos.nombre !== undefined ? String(datos.nombre).trim() : t.nombre;
  if (datos.nombre !== undefined) await exigirNombreLibre(nombre, id);
  await pool.query(
    'UPDATE tipos_gasto SET nombre = :n, limite = :l, activo = :a WHERE id = :id',
    {
      id,
      n: nombre,
      l: datos.limite !== undefined ? datos.limite : t.limite,
      a: (datos.activo !== undefined ? datos.activo : t.activo) ? 1 : 0,
    }
  );
  return obtenerTipo(id);
}

/** ¿Este gasto se autoriza? Pasa el tope de su tipo, o su tipo no tiene tope. */
function seAutorizaCon(t, monto) {
  return t.limite == null || Number(monto) > t.limite + 0.001;
}

/**
 * Lo pregunta el candado de la ruta. Un tipo que no existe o desactivado no se
 * autoriza: el registro contesta su 422 en el acto (pedirlo no serviría de nada).
 */
async function seAutoriza(tipoId, monto) {
  const t = await obtenerTipo(Number(tipoId));
  return !!(t && t.activo && seAutorizaCon(t, monto));
}

// ---------------------------------------------------------------- registrar

/**
 * Registra el gasto en el turno abierto: el renglón del gasto y su salida del
 * cajón, en una transacción con la sesión bloqueada (dos gastos a la vez no
 * pasan el efectivo entre los dos). `autorizacionId`: si pasó el límite, la
 * autorización con que se hizo.
 */
async function registrar(sesionId, { tipo_gasto_id, monto, descripcion }, { usuarioId, autorizacionId = null, puedeSinAutorizar = false }) {
  const id = await withTransaction(async (conn) => {
    const [[s]] = await conn.query('SELECT estado FROM sesiones_caja WHERE id = :id FOR UPDATE', { id: sesionId });
    if (!s) throw new AppError(404, 'NO_ENCONTRADO', 'Ese turno no existe.');
    if (s.estado !== 'abierta') throw new AppError(409, 'SESION_CERRADA', 'El turno de caja ya está cerrado: abre uno para registrar el gasto.');
    const t = await obtenerTipo(Number(tipo_gasto_id), conn);
    if (!t) throw new AppError(422, 'TIPO_GASTO_INVALIDO', 'Elige de qué es el gasto.');
    if (!t.activo) throw new AppError(422, 'TIPO_GASTO_INACTIVO', `El tipo «${t.nombre}» está desactivado.`);
    const m = round2(monto);
    // El tope se vuelve a mirar AQUÍ: si lo bajaron entre el candado y este
    // momento, el gasto no queda "pasado" sin autorización.
    if (seAutorizaCon(t, m) && !puedeSinAutorizar) {
      throw new AppError(409, 'GASTO_SE_AUTORIZA',
        `El límite de ${t.nombre} cambió mientras se registraba: vuelve a intentarlo (ahora se pide autorización).`);
    }
    const enCajon = await cajaModel.efectivoEnCajon(conn, sesionId);
    if (m > enCajon + 0.001) {
      throw new AppError(409, 'EFECTIVO_INSUFICIENTE',
        `En el cajón debería haber ${pesos(enCajon)}; no alcanza para un gasto de ${pesos(m)}.`);
    }
    const texto = String(descripcion).trim();
    const [g] = await conn.query(
      `INSERT INTO gastos (sesion_caja_id, tipo_gasto_id, monto, descripcion, limite, autorizacion_id, usuario_id)
       VALUES (:s, :t, :m, :d, :l, :a, :u)`,
      { s: sesionId, t: t.id, m, d: texto, l: t.limite, a: autorizacionId, u: usuarioId }
    );
    const [mov] = await conn.query(
      `INSERT INTO movimientos_caja (sesion_caja_id, tipo, monto, referencia_id, motivo)
       VALUES (:s, 'gasto', :m, :g, :motivo)`,
      { s: sesionId, m, g: g.insertId, motivo: `${t.nombre}: ${texto}`.slice(0, 255) }
    );
    await conn.query('UPDATE gastos SET movimiento_caja_id = :mov WHERE id = :g', { mov: mov.insertId, g: g.insertId });
    return g.insertId;
  });
  return { gasto: await obtener(id), sesion: await cajaModel.obtenerSesion(sesionId) };
}

// ---------------------------------------------------------------- consultar

const SELECT = `
  SELECT g.id, g.sesion_caja_id, g.tipo_gasto_id, tg.nombre AS tipo, g.monto, g.descripcion, g.limite, g.usuario_id,
         g.autorizacion_id, g.comprobante IS NOT NULL AS con_comprobante, g.comprobante_nombre, g.comprobante_tipo,
         g.estado, g.motivo_cancelacion,
         DATE_FORMAT(g.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
         DATE_FORMAT(g.cancelado_en, '%Y-%m-%d %H:%i:%s') AS cancelado_en,
         u.nombre AS usuario, uc.nombre AS cancelado_por, ua.nombre AS autorizo,
         c.nombre AS caja, c.almacen_id, a.nombre AS almacen, s.estado AS turno_estado
    FROM gastos g
    JOIN tipos_gasto tg      ON tg.id = g.tipo_gasto_id
    JOIN sesiones_caja s     ON s.id = g.sesion_caja_id
    JOIN cajas c             ON c.id = s.caja_id
    JOIN almacenes a         ON a.id = c.almacen_id
    JOIN usuarios u          ON u.id = g.usuario_id
    LEFT JOIN usuarios uc    ON uc.id = g.cancelado_por
    LEFT JOIN autorizaciones au ON au.id = g.autorizacion_id
    LEFT JOIN usuarios ua    ON ua.id = au.autorizador_id`;

function _fila(r) {
  return {
    ...r,
    monto: Number(r.monto),
    limite: r.limite == null ? null : Number(r.limite),
    con_comprobante: !!Number(r.con_comprobante),
    paso_limite: r.limite != null && Number(r.monto) > Number(r.limite) + 0.001,
    // Necesitaba autorización: pasó su tope, o su tipo no tenía. Si no hay
    // `autorizacion_id`, lo registró directo quien puede autorizar.
    se_autorizaba: r.limite == null || Number(r.monto) > Number(r.limite) + 0.001,
  };
}

async function obtener(id) {
  const [[r]] = await pool.query(`${SELECT} WHERE g.id = :id`, { id });
  return r ? _fila(r) : null;
}

/**
 * Los gastos de sus tiendas en un rango, con lo gastado por tipo (sin los
 * cancelados). `hasta` incluye el día completo.
 */
async function listar({ desde, hasta, tipo_gasto_id, almacen_id, sesion_caja_id }, filtroTienda) {
  const where = ['1 = 1'];
  const params = { ...filtroTienda.params };
  if (desde) { where.push('g.creado_en >= :desde'); params.desde = desde; }
  if (hasta) { where.push('g.creado_en < DATE_ADD(:hasta, INTERVAL 1 DAY)'); params.hasta = hasta; }
  if (tipo_gasto_id) { where.push('g.tipo_gasto_id = :tipo'); params.tipo = Number(tipo_gasto_id); }
  if (almacen_id) { where.push('c.almacen_id = :alm'); params.alm = Number(almacen_id); }
  if (sesion_caja_id) { where.push('g.sesion_caja_id = :ses'); params.ses = Number(sesion_caja_id); }
  const filtro = `WHERE ${where.join(' AND ')}${filtroTienda.sql}`;
  const [rows] = await pool.query(`${SELECT} ${filtro} ORDER BY g.creado_en DESC, g.id DESC LIMIT ${TOPE_LISTA + 1}`, params);
  // Las cifras se suman sobre TODOS (la lista se recorta a 500, las cifras no).
  const [porTipo] = await pool.query(
    `SELECT g.tipo_gasto_id, tg.nombre AS tipo, COUNT(*) AS num, SUM(g.monto) AS total,
            SUM(g.limite IS NOT NULL AND g.monto > g.limite + 0.001) AS pasaron
       FROM gastos g
       JOIN tipos_gasto tg  ON tg.id = g.tipo_gasto_id
       JOIN sesiones_caja s ON s.id = g.sesion_caja_id
       JOIN cajas c         ON c.id = s.caja_id
     ${filtro} AND g.estado = 'registrado'
      GROUP BY g.tipo_gasto_id, tg.nombre
      ORDER BY total DESC`,
    params
  );
  const tipos = porTipo.map((t) => ({ tipo_gasto_id: t.tipo_gasto_id, tipo: t.tipo, num: Number(t.num), total: round2(t.total) }));
  return {
    items: rows.slice(0, TOPE_LISTA).map(_fila),
    hay_mas: rows.length > TOPE_LISTA,
    total: round2(tipos.reduce((s, t) => s + t.total, 0)),
    num: tipos.reduce((s, t) => s + t.num, 0),
    pasaron_limite: porTipo.reduce((s, t) => s + Number(t.pasaron ?? 0), 0),
    por_tipo: tipos,
  };
}

// ---------------------------------------------------------------- cancelar

/**
 * Se registró por error: el dinero REGRESA al cajón ('ingreso') y el gasto queda
 * cancelado con su motivo. Solo con su turno todavía abierto: uno ya cortado no
 * se toca (el corte ya se hizo con ese dinero fuera).
 */
async function cancelar(id, motivo, usuarioId) {
  await withTransaction(async (conn) => {
    const [[g]] = await conn.query(
      `SELECT g.*, s.estado AS turno, tg.nombre AS tipo
         FROM gastos g JOIN sesiones_caja s ON s.id = g.sesion_caja_id JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
        WHERE g.id = :id FOR UPDATE`,
      { id }
    );
    if (!g) throw new AppError(404, 'NO_ENCONTRADO', 'Ese gasto no existe.');
    if (g.estado === 'cancelado') throw new AppError(409, 'GASTO_YA_CANCELADO', 'Ese gasto ya estaba cancelado.');
    if (g.turno !== 'abierta') {
      throw new AppError(409, 'TURNO_CERRADO',
        'Ese gasto es de un turno que ya se cortó: no se cancela. Si el dinero regresó, mételo como ingreso en el turno de hoy.');
    }
    await conn.query('SELECT id FROM sesiones_caja WHERE id = :s FOR UPDATE', { s: g.sesion_caja_id });
    await conn.query(
      `INSERT INTO movimientos_caja (sesion_caja_id, tipo, monto, referencia_id, motivo)
       VALUES (:s, 'ingreso', :m, :g, :motivo)`,
      {
        s: g.sesion_caja_id, m: g.monto, g: g.id,
        motivo: `Se canceló el gasto de ${g.tipo}: ${String(motivo).trim()}`.slice(0, 255),
      }
    );
    await conn.query(
      `UPDATE gastos SET estado = 'cancelado', cancelado_en = NOW(), cancelado_por = :u, motivo_cancelacion = :mo
        WHERE id = :id`,
      { id, u: usuarioId, mo: String(motivo).trim().slice(0, 255) }
    );
  });
  return obtener(id);
}

// ---------------------------------------------------------------- la foto

/** La foto o el PDF del ticket. Se valida por sus BYTES (`utils/archivos.js`). */
async function guardarComprobante(id, buf, nombreOriginal) {
  const g = await obtener(id);
  if (!g) throw new AppError(404, 'NO_ENCONTRADO', 'Ese gasto no existe.');
  const guardado = await archivos.guardar(CARPETA, buf);
  if (!guardado) {
    throw new AppError(422, 'ARCHIVO_INVALIDO', 'Sube una foto (JPG, PNG o WEBP) o un PDF del ticket.');
  }
  const [[antes]] = await pool.query('SELECT comprobante FROM gastos WHERE id = :id', { id });
  await pool.query(
    'UPDATE gastos SET comprobante = :c, comprobante_nombre = :n, comprobante_tipo = :t WHERE id = :id',
    { id, c: guardado.nombre, n: String(nombreOriginal ?? '').slice(0, 255) || 'ticket', t: guardado.tipo }
  );
  if (antes?.comprobante) await archivos.borrar(CARPETA, antes.comprobante);
  return obtener(id);
}

async function leerComprobante(id) {
  const [[g]] = await pool.query('SELECT comprobante, comprobante_nombre, comprobante_tipo FROM gastos WHERE id = :id', { id });
  if (!g?.comprobante) throw new AppError(404, 'SIN_COMPROBANTE', 'Ese gasto no tiene foto del ticket.');
  const buf = await archivos.leer(CARPETA, g.comprobante);
  if (!buf) throw new AppError(404, 'SIN_COMPROBANTE', 'La foto del ticket ya no está.');
  return { buf, nombre: g.comprobante_nombre, tipo: g.comprobante_tipo };
}

async function quitarComprobante(id) {
  const [[g]] = await pool.query('SELECT comprobante FROM gastos WHERE id = :id', { id });
  if (!g) throw new AppError(404, 'NO_ENCONTRADO', 'Ese gasto no existe.');
  await pool.query('UPDATE gastos SET comprobante = NULL, comprobante_nombre = NULL, comprobante_tipo = NULL WHERE id = :id', { id });
  if (g.comprobante) await archivos.borrar(CARPETA, g.comprobante);
  return obtener(id);
}

/** De qué tienda es un gasto (para "cada quien, sus tiendas"). */
async function almacenDe(id) {
  const [[r]] = await pool.query(
    `SELECT c.almacen_id FROM gastos g JOIN sesiones_caja s ON s.id = g.sesion_caja_id JOIN cajas c ON c.id = s.caja_id
      WHERE g.id = :id`,
    { id }
  );
  return r ? r.almacen_id : null;
}

module.exports = {
  listarTipos, obtenerTipo, crearTipo, actualizarTipo, seAutoriza, exigirNombreLibre,
  registrar, obtener, listar, cancelar,
  guardarComprobante, leerComprobante, quitarComprobante, almacenDe,
};
