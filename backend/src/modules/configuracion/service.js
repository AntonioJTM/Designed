'use strict';

const model = require('./model');
const cuentas = require('./cuentas');
const { AppError } = require('../../middlewares/error');
const { pool } = require('../../config/db');

/**
 * Lo que ve la tienda pública: las claves marcadas `publica` y las cuentas de
 * banco ACTIVAS (a dónde depositar), sin fechas ni ids internos de más.
 */
async function publica() {
  const mapa = await model.mapa({ soloPublicas: true });
  const activas = await model.listarCuentas({ soloActivas: true });
  mapa.cuentas_bancarias = activas.map(({ id, banco, titular, numero_cuenta, clabe }) => ({
    id, banco, titular, numero_cuenta, clabe,
  }));
  return mapa;
}

/** Lo que ve el panel: todas las claves con su descripción, para dibujar el formulario. */
async function completa() {
  return model.listar();
}

async function guardar(cambios) {
  const validas = new Set(await model.clavesValidas());
  const desconocidas = Object.keys(cambios).filter((c) => !validas.has(c));
  if (desconocidas.length) {
    throw new AppError(422, 'CLAVE_DESCONOCIDA',
      `Estas opciones no existen: ${desconocidas.join(', ')}`);
  }

  // El costo de envío alimenta el total del pedido: no puede ser texto ni negativo.
  if (cambios.envio_costo_fijo !== undefined && cambios.envio_costo_fijo !== null) {
    const n = Number(cambios.envio_costo_fijo);
    if (!Number.isFinite(n) || n < 0) {
      throw new AppError(422, 'ENVIO_COSTO_INVALIDO',
        'El costo de envío debe ser un número mayor o igual a cero.');
    }
    cambios.envio_costo_fijo = n.toFixed(2);
  }

  // El tope del destare por cono (2026-10-20): vacío, o un número de 0 a 1 kg.
  if (cambios.desarme_destare_max_kg !== undefined && cambios.desarme_destare_max_kg !== null &&
      String(cambios.desarme_destare_max_kg).trim() !== '') {
    const n = Number(cambios.desarme_destare_max_kg);
    if (!Number.isFinite(n) || n <= 0 || n > 1) {
      throw new AppError(422, 'DESTARE_TOPE_INVALIDO',
        'El tope del destare por cono va en kilos, más de 0 y hasta 1 (un tubo pesa gramos: 50 g son 0.05).');
    }
    cambios.desarme_destare_max_kg = String(Math.round(n * 1000) / 1000);
  }

  await model.guardar(cambios);
  return completa();
}

// ---- Cuentas de banco ----

async function listarCuentas() {
  return model.listarCuentas();
}

/** Una CLABE repetida choca con el índice único: se dice en palabras. */
async function _conCuentaUnica(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      throw new AppError(409, 'CLABE_REPETIDA', 'Ya hay una cuenta con esa CLABE.');
    }
    throw err;
  }
}

async function crearCuenta(datos) {
  const c = cuentas.normalizar(datos);
  return _conCuentaUnica(() => model.crearCuenta(c));
}

async function actualizarCuenta(id, datos) {
  if (!(await model.obtenerCuenta(id))) throw new AppError(404, 'NO_ENCONTRADO', 'Cuenta no encontrada');
  const c = cuentas.normalizar(datos);
  return _conCuentaUnica(() => model.actualizarCuenta(id, c));
}

/** Se borra de verdad: ninguna venta ni pago apunta a la cuenta, solo se le enseña al cliente. */
async function eliminarCuenta(id) {
  // Una cuenta a la que ya llegaron transferencias no se borra: se perdería a
  // dónde llegaron (Transferencias, 2026-10-20). Se desactiva.
  const [[u]] = await pool.query(
    'SELECT COUNT(*) AS n FROM transferencias WHERE cuenta_bancaria_id = :id', { id }
  );
  if (Number(u.n)) {
    throw new AppError(409, 'CUENTA_CON_TRANSFERENCIAS',
      `A esa cuenta ya llegaron ${u.n} ${Number(u.n) === 1 ? 'transferencia' : 'transferencias'}: ` +
      'no se puede borrar. Desactívala para que ya no se ofrezca.');
  }
  const n = await model.eliminarCuenta(id);
  if (!n) throw new AppError(404, 'NO_ENCONTRADO', 'Cuenta no encontrada');
  return model.listarCuentas();
}

module.exports = {
  publica, completa, guardar,
  listarCuentas, crearCuenta, actualizarCuenta, eliminarCuenta,
};
