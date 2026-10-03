'use strict';

const { pool, withTransaction } = require('../../config/db');
const { porPalabras } = require('../../utils/query');

// Acceso a datos de `productos` (la línea/modelo). Las variantes (SKU) e
// imágenes viven en sus propias tablas y se agregan en el detalle.
//
// `disponible` = existencias vendibles (cantidad - reservada) en el almacén que
// surte la tienda en línea, que llega como :almacen_online. Se expone en el
// catálogo público para poder marcar "Agotado" antes del checkout.

const SELECT_BASE = `
  SELECT p.id, p.categoria_id, cat.nombre AS categoria, cat.calibres AS calibres_material,
         p.linea_id, li.nombre AS linea,
         p.unidad_medida_id, um.abreviatura AS unidad,
         p.impuesto_id, imp.porcentaje AS impuesto_porcentaje,
         p.nombre, p.descripcion, p.grosor_calibre, p.precio_kg,
         p.multipresentacion, p.por_lotes, p.destacado, p.activo,
         p.creado_en, p.actualizado_en,
         -- No se puede vender: su presentación en kilos está en $0. Pasa con los
         -- hilos que crea la lista completa del proveedor, que entran sin precio.
         EXISTS (SELECT 1 FROM producto_variantes sp
                  WHERE sp.producto_id = p.id AND sp.activo = 1
                    AND sp.tipo_presentacion <> 'cono' AND sp.precio <= 0) AS sin_precio,
         -- Cuándo entró su primera carga: la nota "llegó en la carga del…".
         (SELECT DATE_FORMAT(MIN(r.creado_en), '%Y-%m-%d %H:%i:%s')
            FROM remesas r JOIN producto_variantes rv ON rv.id = r.variante_id
           WHERE rv.producto_id = p.id) AS primera_carga,
         (SELECT MIN(COALESCE(pv.precio_oferta, pv.precio))
            FROM producto_variantes pv
           WHERE pv.producto_id = p.id AND pv.activo = 1) AS precio_desde,
         (SELECT pi.url FROM producto_imagenes pi
           WHERE pi.producto_id = p.id
           ORDER BY pi.es_principal DESC, pi.orden LIMIT 1) AS imagen,
         (SELECT COALESCE(SUM(GREATEST(i.cantidad - i.cantidad_reservada, 0)), 0)
            FROM producto_variantes pvs
            JOIN inventario i ON i.variante_id = pvs.id AND i.almacen_id = :almacen_online
           WHERE pvs.producto_id = p.id AND pvs.activo = 1) AS disponible
    FROM productos p
    JOIN categorias cat        ON cat.id = p.categoria_id
    LEFT JOIN lineas li        ON li.id = p.linea_id
    JOIN unidades_medida um    ON um.id = p.unidad_medida_id
    LEFT JOIN impuestos imp    ON imp.id = p.impuesto_id
`;

async function listar({ q, categoria_id, activo, destacado, limit, offset, almacen_online }) {
  const where = [];
  const params = { almacen_online: almacen_online ?? 0 };
  // El color, el calibre o la descripción, palabra por palabra: en la tienda
  // hay dos ROJO y el cliente escribe "rojo 2/30".
  const busca = porPalabras(q, ['p.nombre', 'p.descripcion', { col: 'p.grosor_calibre', calibre: true }]);
  if (busca) {
    where.push(busca.sql);
    Object.assign(params, busca.params);
  }
  if (categoria_id !== undefined) {
    where.push('p.categoria_id = :categoria_id');
    params.categoria_id = categoria_id;
  }
  if (activo !== undefined) {
    where.push('p.activo = :activo');
    params.activo = activo ? 1 : 0;
  }
  if (destacado !== undefined) {
    where.push('p.destacado = :destacado');
    params.destacado = destacado ? 1 : 0;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `${SELECT_BASE} ${whereSql} ORDER BY p.creado_en DESC LIMIT :limit OFFSET :offset`,
    { ...params, limit, offset }
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM productos p ${whereSql}`,
    params
  );
  return { rows, total };
}

async function obtener(id, almacenOnline) {
  const [rows] = await pool.query(`${SELECT_BASE} WHERE p.id = :id LIMIT 1`, {
    id,
    almacen_online: almacenOnline ?? 0,
  });
  return rows[0] || null;
}

/**
 * Variantes de un producto, con sus existencias vendibles en línea.
 *
 * Trae también los datos de la PRESENTACIÓN (tipo, peso, de qué paquete sale un
 * cono y su unidad de venta). Faltaban, así que la pantalla de presentaciones no
 * podía decir "Paquete de 19 kg" ni de dónde salía el precio de un cono: los
 * campos llegaban en undefined.
 */
async function variantesDe(productoId, almacenOnline) {
  const [rows] = await pool.query(
    `SELECT pv.id, pv.producto_id,
            pv.sku, pv.codigo_barras, pv.presentacion, pv.lote,
            pv.precio, pv.precio_oferta, pv.costo, pv.activo,
            pv.tipo_presentacion, pv.peso_kg,
            pv.origen_variante_id, pv.piezas_por_origen, pv.modo_precio,
            um.abreviatura AS unidad,
            CASE pv.tipo_presentacion
              WHEN 'paquete' THEN 'kg'
              WHEN 'cono'    THEN 'kg'
              ELSE um.abreviatura
            END AS unidad_venta,
            org.sku     AS paquete_sku,
            org.precio  AS paquete_precio_kg,
            org.peso_kg AS paquete_peso_kg,
            COALESCE(GREATEST(i.cantidad - i.cantidad_reservada, 0), 0) AS disponible
       FROM producto_variantes pv
       JOIN productos prod                ON prod.id = pv.producto_id
       JOIN unidades_medida um            ON um.id = prod.unidad_medida_id
       LEFT JOIN producto_variantes org   ON org.id = pv.origen_variante_id
       LEFT JOIN inventario i
              ON i.variante_id = pv.id AND i.almacen_id = :almacen_online
      WHERE pv.producto_id = :id
      ORDER BY pv.id`,
    { id: productoId, almacen_online: almacenOnline ?? 0 }
  );
  return rows;
}

/** Imágenes de un producto. */
async function imagenesDe(productoId) {
  const [rows] = await pool.query(
    `SELECT id, producto_id, variante_id, url, es_principal, orden
       FROM producto_imagenes
      WHERE producto_id = :id
      ORDER BY es_principal DESC, orden`,
    { id: productoId }
  );
  return rows;
}

async function crear(datos) {
  const [r] = await pool.query(
    `INSERT INTO productos
       (categoria_id, linea_id, unidad_medida_id, impuesto_id,
        nombre, descripcion, grosor_calibre, precio_kg, multipresentacion, por_lotes, destacado, activo)
     VALUES
       (:categoria_id, :linea_id, :unidad_medida_id, :impuesto_id,
        :nombre, :descripcion, :grosor_calibre, :precio_kg, :multipresentacion, :por_lotes, :destacado, :activo)`,
    datos
  );
  return obtener(r.insertId);
}

async function actualizar(id, datos) {
  await pool.query(
    `UPDATE productos SET
        categoria_id = :categoria_id, linea_id = :linea_id,
        unidad_medida_id = :unidad_medida_id, impuesto_id = :impuesto_id,
        nombre = :nombre, descripcion = :descripcion,
        grosor_calibre = :grosor_calibre, precio_kg = :precio_kg,
        multipresentacion = :multipresentacion,
        por_lotes = :por_lotes, destacado = :destacado, activo = :activo
      WHERE id = :id`,
    { ...datos, id }
  );
  return obtener(id);
}

/**
 * Lo que el producto tiene CARGADO en cualquiera de sus presentaciones. Con una
 * sola cosa de estas ya no se borra: borrar el producto se lleva en cascada sus
 * presentaciones, y con ellas los bultos y las existencias, sin dejar rastro.
 * La presentación vacía que se crea sola al dar de alta NO cuenta: un producto
 * recién capturado (o capturado por error) se puede borrar.
 */
async function cargado(id, ejecutor = pool) {
  const sub = '(SELECT id FROM producto_variantes WHERE producto_id = :id)';
  const [[r]] = await ejecutor.query(
    `SELECT
       (SELECT COUNT(*) FROM variante_codigos      WHERE variante_id IN ${sub}) AS bultos,
       (SELECT COUNT(*) FROM remesas               WHERE variante_id IN ${sub}) AS cargas,
       (SELECT COALESCE(SUM(cantidad), 0) FROM inventario WHERE variante_id IN ${sub}) AS kg,
       (SELECT COUNT(*) FROM inventario
         WHERE variante_id IN ${sub} AND (cantidad <> 0 OR cantidad_reservada <> 0)) AS saldos,
       (SELECT COUNT(*) FROM movimientos_inventario WHERE variante_id IN ${sub}) AS movimientos,
       (SELECT COUNT(DISTINCT pedido_id) FROM pedido_detalle WHERE variante_id IN ${sub}) AS ventas,
       (SELECT COUNT(DISTINCT traspaso_id) FROM traspaso_detalle WHERE variante_id IN ${sub}) AS traspasos,
       (SELECT COUNT(*) FROM variante_conversiones
         WHERE variante_origen_id IN ${sub} OR variante_destino_id IN ${sub}) AS desarmes,
       (SELECT COUNT(*) FROM orden_compra_detalle  WHERE variante_id IN ${sub}) AS compras,
       (SELECT COUNT(*) FROM carrito_items         WHERE variante_id IN ${sub}) AS carritos`,
    { id }
  );
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

/**
 * Borra el producto SOLO si no tiene nada cargado; lo revisa y lo borra en la
 * misma transacción, con el producto bloqueado. Devuelve null si lo borró, o lo
 * que tiene cargado si no. Lo vacío (la presentación sin nada, sus precios por
 * lista, sus imágenes, renglones de inventario en cero) se va en cascada.
 */
async function eliminarSiVacio(id) {
  return withTransaction(async (conn) => {
    const [[p]] = await conn.query('SELECT id FROM productos WHERE id = :id FOR UPDATE', { id });
    if (!p) return { noExiste: true };
    const c = await cargado(id, conn);
    const tiene = c.bultos || c.cargas || c.saldos || c.movimientos || c.ventas || c.traspasos
      || c.desarmes || c.compras || c.carritos;
    if (tiene) return c;
    await conn.query('DELETE FROM productos WHERE id = :id', { id });
    return null;
  });
}

module.exports = {
  listar,
  obtener,
  variantesDe,
  imagenesDe,
  crear,
  actualizar,
  cargado,
  eliminarSiVacio,
};
