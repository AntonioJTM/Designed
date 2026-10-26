'use strict';

/**
 * EL VENDEDOR DE LA NOTA (2026-10-23, usuario: "Nota de venta: añadir vendedor").
 * En la caja se elige quién atendió al cliente, aparte de quién cobra:
 *
 *  · `pedidos.usuario_id` es quien la REGISTRÓ («Elaboró») y no cambia.
 *  · `pedidos.vendedor_id` es quien la VENDIÓ: a esa persona va la comisión
 *    (decisión del usuario). NULL = la vendió quien la registró, así lo de antes
 *    y la tienda en línea se leen igual que siempre (`SQL_VENDEDOR`).
 *  · Se elige entre el personal ACTIVO de esa tienda (decisión del usuario): quien
 *    la tiene en «Trabaja en», quien trabaja en «Todas las tiendas» y el
 *    administrador, que las ve todas siempre. Propone a quien está cobrando.
 */

const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');

/** Quién vendió una venta `p`: el elegido o, si no hay, quien la registró. */
const SQL_VENDEDOR = 'COALESCE(p.vendedor_id, p.usuario_id)';

// Trabaja en esa tienda (:almacen): la tiene en «Trabaja en», está en «Todas» o es
// administrador (de puesto principal o de los demás).
const TRABAJA_AHI = `u.activo = 1 AND (
     u.todas_las_tiendas = 1
  OR EXISTS (SELECT 1 FROM usuario_almacenes ua WHERE ua.usuario_id = u.id AND ua.almacen_id = :almacen)
  OR r.nombre = 'administrador'
  OR EXISTS (SELECT 1 FROM usuario_roles ur JOIN roles ro ON ro.id = ur.rol_id
              WHERE ur.usuario_id = u.id AND ro.nombre = 'administrador'))`;

/** El personal que puede quedar como vendedor de una venta de esa tienda, por nombre. */
async function deTienda(almacenId, ejecutor = pool) {
  const [rows] = await ejecutor.query(
    `SELECT u.id, u.nombre, r.nombre AS puesto
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE ${TRABAJA_AHI}
      ORDER BY u.nombre, u.id`,
    { almacen: Number(almacenId) }
  );
  return rows.map((v) => ({ id: Number(v.id), nombre: v.nombre, puesto: v.puesto }));
}

/**
 * El vendedor con que queda una venta de esa tienda. Sin elegir, o si es quien la
 * registra, es quien la registra; otra persona tiene que trabajar ahí y estar
 * activa (422 `VENDEDOR_INVALIDO`).
 */
async function resolver(ejecutor, { vendedorId, usuarioId, almacenId }) {
  if (vendedorId == null || Number(vendedorId) === Number(usuarioId)) return usuarioId ?? null;
  const [[v]] = await ejecutor.query(
    `SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.id = :id AND ${TRABAJA_AHI} LIMIT 1`,
    { id: Number(vendedorId), almacen: Number(almacenId) }
  );
  if (!v) {
    throw new AppError(422, 'VENDEDOR_INVALIDO',
      'Esa persona no trabaja en esta tienda o ya no está activa: elige otro vendedor.');
  }
  return Number(v.id);
}

module.exports = { SQL_VENDEDOR, deTienda, resolver };
