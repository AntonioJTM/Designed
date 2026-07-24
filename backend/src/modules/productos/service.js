'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');
const { slugify } = require('../../utils/slug');
const { paginado } = require('../../utils/query');

async function listar(filtros) {
  const { rows, total } = await model.listar(filtros);
  return paginado(rows, total, filtros.page, filtros.limit);
}

/** Detalle del producto con sus variantes e imágenes anidadas. */
async function obtener(id, { conDetalle = true } = {}) {
  const producto = await model.obtener(id);
  if (!producto) throw new AppError(404, 'NO_ENCONTRADO', 'Producto no encontrado');
  if (!conDetalle) return producto;

  const [variantes, imagenes] = await Promise.all([
    model.variantesDe(id),
    model.imagenesDe(id),
  ]);
  return { ...producto, variantes, imagenes };
}

async function crear(datos) {
  const registro = {
    categoria_id: datos.categoria_id,
    marca_id: datos.marca_id ?? null,
    material_id: datos.material_id ?? null,
    unidad_medida_id: datos.unidad_medida_id,
    impuesto_id: datos.impuesto_id ?? null,
    nombre: datos.nombre,
    slug: datos.slug?.trim() || slugify(datos.nombre),
    descripcion: datos.descripcion ?? null,
    grosor_calibre: datos.grosor_calibre ?? null,
    peso_gramos: datos.peso_gramos ?? null,
    longitud_metros: datos.longitud_metros ?? null,
    destacado: datos.destacado ?? false,
    activo: datos.activo ?? true,
  };
  const creado = await model.crear(registro);
  return obtener(creado.id);
}

async function actualizar(id, datos) {
  const actual = await model.obtener(id);
  if (!actual) throw new AppError(404, 'NO_ENCONTRADO', 'Producto no encontrado');

  const merge = (campo) => (datos[campo] !== undefined ? datos[campo] : actual[campo]);
  const registro = {
    categoria_id: merge('categoria_id'),
    marca_id: merge('marca_id'),
    material_id: merge('material_id'),
    unidad_medida_id: merge('unidad_medida_id'),
    impuesto_id: merge('impuesto_id'),
    nombre: merge('nombre'),
    slug: datos.slug?.trim() || (datos.nombre ? slugify(datos.nombre) : actual.slug),
    descripcion: merge('descripcion'),
    grosor_calibre: merge('grosor_calibre'),
    peso_gramos: merge('peso_gramos'),
    longitud_metros: merge('longitud_metros'),
    destacado: merge('destacado'),
    activo: merge('activo'),
  };
  await model.actualizar(id, registro);
  return obtener(id);
}

async function eliminar(id) {
  const producto = await model.obtener(id);
  if (!producto) throw new AppError(404, 'NO_ENCONTRADO', 'Producto no encontrado');
  await model.eliminar(id);
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
