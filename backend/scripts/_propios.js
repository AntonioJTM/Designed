'use strict';

/**
 * Lo que una prueba E2E puede borrar al terminar: lo NUEVO —no estaba en la
 * foto que tomó al empezar— y que además es SUYO: lleva el prefijo TMP en el
 * nombre, o cuelga de algo que lo lleva (el pedido de una caja TMP, la dirección
 * de un cliente TMP, la remesa de un hilo TMP).
 *
 * Existe porque las pruebas corren contra la base de producción. Antes se
 * borraba TODO lo nuevo, y una venta real hecha en el mostrador mientras corría
 * la prueba se habría borrado con lo de la prueba. Con esto la venta real queda
 * intacta: no es de una caja TMP ni lleva un hilo TMP.
 *
 *   const nuevos = soloPropios(db, foto);
 *   for (const id of await nuevos('pedidos')) …
 */
function soloPropios(db, foto, prefijo = 'TMP') {
  const pat = prefijo + '%';
  const ids = async (sql, params) => (await db.query(sql, params))[0].map((r) => r.id);

  const reglas = {
    productos: () => ids('SELECT id FROM productos WHERE nombre LIKE ?', [pat]),
    almacenes: () => ids('SELECT id FROM almacenes WHERE nombre LIKE ?', [pat]),
    cajas: () =>
      ids(
        `SELECT c.id FROM cajas c JOIN almacenes a ON a.id = c.almacen_id
          WHERE c.nombre LIKE ? OR a.nombre LIKE ?`,
        [pat, pat]
      ),
    sesiones_caja: () =>
      ids(
        `SELECT s.id FROM sesiones_caja s
           JOIN cajas c     ON c.id = s.caja_id
           JOIN almacenes a ON a.id = c.almacen_id
          WHERE c.nombre LIKE ? OR a.nombre LIKE ?`,
        [pat, pat]
      ),
    pedidos: () =>
      ids(
        `SELECT p.id FROM pedidos p
           LEFT JOIN sesiones_caja s ON s.id = p.sesion_caja_id
           LEFT JOIN cajas c         ON c.id = s.caja_id
           LEFT JOIN clientes cl     ON cl.id = p.cliente_id
          WHERE c.nombre LIKE ? OR cl.nombre LIKE ?
             OR EXISTS (SELECT 1 FROM pedido_detalle d
                          JOIN producto_variantes pv ON pv.id = d.variante_id
                          JOIN productos pr          ON pr.id = pv.producto_id
                         WHERE d.pedido_id = p.id AND pr.nombre LIKE ?)`,
        [pat, pat, pat]
      ),
    clientes: () => ids('SELECT id FROM clientes WHERE nombre LIKE ?', [pat]),
    direcciones: () =>
      ids(
        'SELECT d.id FROM direcciones d JOIN clientes c ON c.id = d.cliente_id WHERE c.nombre LIKE ?',
        [pat]
      ),
    cupones: () => ids('SELECT id FROM cupones WHERE codigo LIKE ?', [pat]),
    remesas: () =>
      ids(
        `SELECT r.id FROM remesas r
           JOIN producto_variantes pv ON pv.id = r.variante_id
           JOIN productos p           ON p.id = pv.producto_id
          WHERE p.nombre LIKE ?`,
        [pat]
      ),
  };

  return async (tabla) => {
    if (!reglas[tabla]) throw new Error(`soloPropios: no sé reconocer lo propio en ${tabla}`);
    if (!foto[tabla]) throw new Error(`soloPropios: falta la foto de ${tabla}`);
    return (await reglas[tabla]()).filter((i) => !foto[tabla].has(i));
  };
}

/**
 * Borra los TURNOS de las cajas de una prueba, con sus movimientos de caja,
 * PERO solo los que nadie más usó.
 *
 * Existe por el incidente del 2026-10-03: mientras e2e-apartados tenía abierta
 * su caja TMP, alguien registró desde el panel un abono REAL en efectivo (el
 * modal de abono propone el primer turno abierto que encuentra, y era el de la
 * prueba). La limpieza borraba los movimientos "por turno" y se llevó la
 * entrada de ese dinero.
 *
 * Un turno tiene algo AJENO si en él hay un abono de crédito de un cliente que
 * no es de la prueba, o un pedido que no es de un cliente de la prueba ni lleva
 * un hilo de la prueba. Ese turno NO se borra (ni su caja): se avisa fuerte y se
 * deja para revisarlo a mano. Devuelve los turnos que se respetaron.
 */
async function borrarTurnosPropios(db, sesionIds, prefijo = 'TMP') {
  const pat = prefijo + '%';
  const respetados = [];
  for (const id of sesionIds) {
    const [[ajeno]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM credito_movimientos cm JOIN clientes c ON c.id = cm.cliente_id
                WHERE cm.sesion_caja_id = ? AND c.nombre NOT LIKE ?)
            + (SELECT COUNT(*) FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
                WHERE p.sesion_caja_id = ? AND (c.id IS NULL OR c.nombre NOT LIKE ?)
                  AND NOT EXISTS (SELECT 1 FROM pedido_detalle d
                                    JOIN producto_variantes pv ON pv.id = d.variante_id
                                    JOIN productos pr          ON pr.id = pv.producto_id
                                   WHERE d.pedido_id = p.id AND pr.nombre LIKE ?)) AS n`,
      [id, pat, id, pat, pat]
    );
    if (Number(ajeno.n) > 0) {
      respetados.push(id);
      continue;
    }
    await db.query('DELETE FROM movimientos_caja WHERE sesion_caja_id = ?', [id]);
    await db.query('DELETE FROM sesiones_caja WHERE id = ?', [id]);
  }
  if (respetados.length) {
    console.warn(
      `\n  ⚠  ${respetados.length} turno(s) de la caja de prueba tienen movimientos AJENOS ` +
        `(alguien cobró o vendió en ella mientras corría la prueba). NO se borraron, ni su caja: ` +
        `turno(s) ${respetados.join(', ')}. Revísalos a mano.\n`
    );
  }
  return respetados;
}

/** Borra las cajas de la prueba que ya no tengan turnos (los ajenos las sostienen). */
async function borrarCajasSinTurnos(db, cajaIds) {
  for (const id of cajaIds) {
    await db.query(
      'DELETE FROM cajas WHERE id = ? AND NOT EXISTS (SELECT 1 FROM sesiones_caja s WHERE s.caja_id = ?)',
      [id, id]
    );
  }
}

module.exports = { soloPropios, borrarTurnosPropios, borrarCajasSinTurnos };
