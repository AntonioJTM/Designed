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

module.exports = { soloPropios };
