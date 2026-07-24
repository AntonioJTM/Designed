'use strict';

const { pool } = require('../../config/db');

// Acceso a datos de `productos` (la línea/modelo). Las variantes (SKU) e
// imágenes viven en sus propias tablas y se agregan en el detalle.

const SELECT_BASE = `
  SELECT p.id, p.categoria_id, cat.nombre AS categoria,
         p.marca_id, m.nombre AS marca,
         p.material_id, mat.nombre AS material,
         p.unidad_medida_id, um.abreviatura AS unidad,
         p.impuesto_id, imp.porcentaje AS impuesto_porcentaje,
         p.nombre, p.slug, p.descripcion, p.grosor_calibre,
         p.peso_gramos, p.longitud_metros, p.destacado, p.activo,
         p.creado_en, p.actualizado_en,
         (SELECT MIN(COALESCE(pv.precio_oferta, pv.precio))
            FROM producto_variantes pv
           WHERE pv.producto_id = p.id AND pv.activo = 1) AS precio_desde,
         (SELECT pi.url FROM producto_imagenes pi
           WHERE pi.producto_id = p.id
           ORDER BY pi.es_principal DESC, pi.orden LIMIT 1) AS imagen
    FROM productos p
    JOIN categorias cat        ON cat.id = p.categoria_id
    LEFT JOIN marcas m         ON m.id = p.marca_id
    LEFT JOIN materiales mat   ON mat.id = p.material_id
    JOIN unidades_medida um    ON um.id = p.unidad_medida_id
    LEFT JOIN impuestos imp    ON imp.id = p.impuesto_id
`;

async function listar({ q, categoria_id, activo, destacado, limit, offset }) {
  const where = [];
  const params = {};
  if (q) {
    where.push('(p.nombre LIKE :q OR p.slug LIKE :q OR p.descripcion LIKE :q)');
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

async function obtener(id) {
  const [rows] = await pool.query(`${SELECT_BASE} WHERE p.id = :id LIMIT 1`, { id });
  return rows[0] || null;
}

/** Variantes de un producto, con datos de color. */
async function variantesDe(productoId) {
  const [rows] = await pool.query(
    `SELECT pv.id, pv.producto_id, pv.color_id, col.nombre AS color, col.codigo_hex,
            pv.sku, pv.codigo_barras, pv.presentacion, pv.precio, pv.precio_oferta,
            pv.costo, pv.activo
       FROM producto_variantes pv
       LEFT JOIN colores col ON col.id = pv.color_id
      WHERE pv.producto_id = :id
      ORDER BY pv.id`,
    { id: productoId }
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
       (categoria_id, marca_id, material_id, unidad_medida_id, impuesto_id,
        nombre, slug, descripcion, grosor_calibre, peso_gramos, longitud_metros,
        destacado, activo)
     VALUES
       (:categoria_id, :marca_id, :material_id, :unidad_medida_id, :impuesto_id,
        :nombre, :slug, :descripcion, :grosor_calibre, :peso_gramos, :longitud_metros,
        :destacado, :activo)`,
    datos
  );
  return obtener(r.insertId);
}

async function actualizar(id, datos) {
  await pool.query(
    `UPDATE productos SET
        categoria_id = :categoria_id, marca_id = :marca_id, material_id = :material_id,
        unidad_medida_id = :unidad_medida_id, impuesto_id = :impuesto_id,
        nombre = :nombre, slug = :slug, descripcion = :descripcion,
        grosor_calibre = :grosor_calibre, peso_gramos = :peso_gramos,
        longitud_metros = :longitud_metros, destacado = :destacado, activo = :activo
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
