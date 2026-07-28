'use strict';

const { pool } = require('../../config/db');

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
  if (q) {
    where.push('(p.nombre LIKE :q OR p.descripcion LIKE :q)');
    params.q = `%${q}%`;
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

async function eliminar(id) {
  const [r] = await pool.query('DELETE FROM productos WHERE id = :id', { id });
  return r.affectedRows > 0;
}

module.exports = {
  listar,
  obtener,
  variantesDe,
  imagenesDe,
  crear,
  actualizar,
  eliminar,
};
