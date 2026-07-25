'use strict';

const model = require('./model');
const almacenesModel = require('../almacenes/model');
const { AppError } = require('../../middlewares/error');
const { paginado } = require('../../utils/query');

// El catálogo reporta `disponible` contra el almacén que surte la tienda en
// línea, que es del que descontará el pedido al confirmarse. Así lo que ve el
// cliente coincide con lo que valida el checkout.

async function listar(filtros) {
  const almacenOnline = await almacenesModel.idTiendaLinea();
  const { rows, total } = await model.listar({ ...filtros, almacen_online: almacenOnline });
  return paginado(rows, total, filtros.page, filtros.limit);
}

/** Detalle del producto con sus variantes e imágenes anidadas. */
async function obtener(id, { conDetalle = true } = {}) {
  const almacenOnline = await almacenesModel.idTiendaLinea();
  const producto = await model.obtener(id, almacenOnline);
  if (!producto) throw new AppError(404, 'NO_ENCONTRADO', 'Producto no encontrado');
  if (!conDetalle) return producto;

  const [variantes, imagenes] = await Promise.all([
    model.variantesDe(id, almacenOnline),
    model.imagenesDe(id),
  ]);
  return { ...producto, variantes, imagenes };
}

async function crear(datos) {
  const registro = {
    categoria_id: datos.categoria_id,
    linea_id: datos.linea_id ?? null,
    unidad_medida_id: datos.unidad_medida_id,
    impuesto_id: datos.impuesto_id ?? null,
    nombre: datos.nombre,
    descripcion: datos.descripcion ?? null,
    grosor_calibre: datos.grosor_calibre ?? null,
    multipresentacion: datos.multipresentacion ?? false,
    por_lotes: datos.por_lotes ?? false,
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
    linea_id: merge('linea_id'),
    unidad_medida_id: merge('unidad_medida_id'),
    impuesto_id: merge('impuesto_id'),
    nombre: merge('nombre'),
    descripcion: merge('descripcion'),
    grosor_calibre: merge('grosor_calibre'),
    multipresentacion: merge('multipresentacion'),
    por_lotes: merge('por_lotes'),
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
