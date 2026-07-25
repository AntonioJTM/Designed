'use strict';

const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');

// Caja / punto de venta: cajas físicas, sesiones (turnos) y sus movimientos.
// Signo del movimiento de caja sobre el efectivo esperado.
const SIGNO_CAJA = { venta: 1, ingreso: 1, retiro: -1, devolucion: -1 };

// El efectivo se suma en JS a partir de DECIMAL; redondear evita colas como
// 232.00000000000003 tanto en pantalla como en el corte.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---- Cajas ----
async function listarCajas() {
  const [rows] = await pool.query(
    `SELECT c.id, c.almacen_id, a.nombre AS almacen, c.nombre, c.activo
       FROM cajas c JOIN almacenes a ON a.id = c.almacen_id
      ORDER BY c.nombre`
  );
  return rows;
}

async function crearCaja({ almacen_id, nombre, activo }) {
  const [r] = await pool.query(
    'INSERT INTO cajas (almacen_id, nombre, activo) VALUES (:almacen_id, :nombre, :activo)',
    { almacen_id, nombre, activo }
  );
  return obtenerCaja(r.insertId);
}

async function actualizarCaja(id, { almacen_id, nombre, activo }) {
  await pool.query(
    'UPDATE cajas SET almacen_id = :almacen_id, nombre = :nombre, activo = :activo WHERE id = :id',
    { id, almacen_id, nombre, activo }
  );
  return obtenerCaja(id);
}

/** Caja con el nombre de su almacén, igual que en el listado. */
async function obtenerCaja(id) {
  const [rows] = await pool.query(
    `SELECT c.id, c.almacen_id, a.nombre AS almacen, c.nombre, c.activo
       FROM cajas c JOIN almacenes a ON a.id = c.almacen_id
      WHERE c.id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

/** Sesiones que ha tenido la caja; si hay alguna, no se puede eliminar. */
async function tieneSesiones(cajaId) {
  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM sesiones_caja WHERE caja_id = :id',
    { id: cajaId }
  );
  return n > 0;
}

async function eliminarCaja(id) {
  const [r] = await pool.query('DELETE FROM cajas WHERE id = :id', { id });
  return r.affectedRows > 0;
}

// ---- Sesiones ----

/** Id de la sesión abierta de una caja, o null. Solo para validar. */
async function _idSesionAbierta(caja_id) {
  const [rows] = await pool.query(
    `SELECT id FROM sesiones_caja WHERE caja_id = :caja_id AND estado = 'abierta' LIMIT 1`,
    { caja_id }
  );
  return rows[0]?.id ?? null;
}

/**
 * Sesión abierta de una caja, con la MISMA forma que devuelve obtenerSesion:
 * nombre de caja y cajero, movimientos y efectivo esperado. El POS la usa para
 * pintar el panel al entrar, así que si viniera cruda esos datos saldrían en
 * blanco.
 */
async function sesionAbiertaDeCaja(caja_id) {
  const id = await _idSesionAbierta(caja_id);
  return id ? obtenerSesion(id) : null;
}

async function abrirSesion({ caja_id, usuario_id, monto_inicial }) {
  if (await _idSesionAbierta(caja_id)) {
    throw new AppError(409, 'CAJA_YA_ABIERTA', 'Esa caja ya tiene una sesión abierta');
  }
  const [r] = await pool.query(
    `INSERT INTO sesiones_caja (caja_id, usuario_id, monto_inicial)
     VALUES (:caja_id, :usuario_id, :monto_inicial)`,
    { caja_id, usuario_id, monto_inicial }
  );
  return obtenerSesion(r.insertId);
}

/** Suma con signo de los movimientos de la sesión. */
async function totalesSesion(id) {
  const [rows] = await pool.query(
    `SELECT tipo, COALESCE(SUM(monto),0) AS suma
       FROM movimientos_caja WHERE sesion_caja_id = :id GROUP BY tipo`,
    { id }
  );
  let neto = 0;
  const porTipo = {};
  for (const row of rows) {
    const suma = Number(row.suma);
    porTipo[row.tipo] = suma;
    neto += (SIGNO_CAJA[row.tipo] ?? 0) * suma;
  }
  return { neto, porTipo };
}

async function obtenerSesion(id) {
  const [rows] = await pool.query(
    `SELECT s.*, c.nombre AS caja, u.nombre AS usuario
       FROM sesiones_caja s
       JOIN cajas c   ON c.id = s.caja_id
       JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.id = :id LIMIT 1`,
    { id }
  );
  const sesion = rows[0];
  if (!sesion) return null;

  const [movs] = await pool.query(
    `SELECT id, tipo, monto, referencia_id, motivo, creado_en
       FROM movimientos_caja WHERE sesion_caja_id = :id ORDER BY creado_en, id`,
    { id }
  );
  const { neto, porTipo } = await totalesSesion(id);
  sesion.movimientos = movs;
  sesion.esperado_actual = round2(Number(sesion.monto_inicial) + neto);
  sesion.totales_por_tipo = porTipo;
  return sesion;
}

async function registrarMovimientoManual(sesion_id, { tipo, monto, motivo }) {
  const [rows] = await pool.query(
    `SELECT estado FROM sesiones_caja WHERE id = :id LIMIT 1`,
    { id: sesion_id }
  );
  if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Sesión de caja no encontrada');
  if (rows[0].estado !== 'abierta') {
    throw new AppError(409, 'SESION_CERRADA', 'La sesión de caja está cerrada');
  }
  await pool.query(
    `INSERT INTO movimientos_caja (sesion_caja_id, tipo, monto, motivo)
     VALUES (:sesion_id, :tipo, :monto, :motivo)`,
    { sesion_id, tipo, monto, motivo: motivo ?? null }
  );
  return obtenerSesion(sesion_id);
}

async function cerrarSesion(id, monto_final) {
  // El UPDATE va en su transacción; la lectura del detalle se hace DESPUÉS del
  // commit (obtenerSesion usa el pool y no vería cambios sin confirmar).
  await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      'SELECT * FROM sesiones_caja WHERE id = :id FOR UPDATE',
      { id }
    );
    const sesion = rows[0];
    if (!sesion) throw new AppError(404, 'NO_ENCONTRADO', 'Sesión de caja no encontrada');
    if (sesion.estado !== 'abierta') {
      throw new AppError(409, 'SESION_CERRADA', 'La sesión ya está cerrada');
    }

    const [tot] = await conn.query(
      `SELECT tipo, COALESCE(SUM(monto),0) AS suma
         FROM movimientos_caja WHERE sesion_caja_id = :id GROUP BY tipo`,
      { id }
    );
    let neto = 0;
    for (const row of tot) neto += (SIGNO_CAJA[row.tipo] ?? 0) * Number(row.suma);

    const esperado = round2(Number(sesion.monto_inicial) + neto);
    const diferencia = round2(Number(monto_final) - esperado);

    await conn.query(
      `UPDATE sesiones_caja SET estado='cerrada', monto_esperado=:esperado,
          monto_final=:monto_final, diferencia=:diferencia, fecha_cierre=CURRENT_TIMESTAMP
        WHERE id=:id`,
      { esperado, monto_final, diferencia, id }
    );
  });
  return obtenerSesion(id);
}

module.exports = {
  listarCajas,
  crearCaja,
  actualizarCaja,
  obtenerCaja,
  tieneSesiones,
  eliminarCaja,
  sesionAbiertaDeCaja,
  abrirSesion,
  obtenerSesion,
  registrarMovimientoManual,
  cerrarSesion,
};
