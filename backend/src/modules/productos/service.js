'use strict';

const model = require('./model');
const variantesService = require('../variantes/service');
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
    precio_kg: datos.precio_kg ?? null,
    multipresentacion: datos.multipresentacion ?? false,
    por_lotes: datos.por_lotes ?? false,
    destacado: datos.destacado ?? false,
    activo: datos.activo ?? true,
  };
  const creado = await model.crear(registro);

  // Si la presentación no se pudo crear, el producto NO se pierde: se devuelve
  // igual, con el motivo, y la pantalla lo dice en vez de presumir que se creó.
  // Sería peor perder el alta completa.
  const motivo = await _crearPresentacionInicial(creado.id, registro);
  const producto = await obtener(creado.id);
  return motivo ? { ...producto, presentacion_pendiente: motivo } : producto;
}

/**
 * El hilo SIEMPRE entra en paquetes, así que su presentación se crea sola: el
 * SKU y el código de barras son el nombre del color (la tienda no maneja SKU
 * propios) y el precio lo hereda del producto. El PESO queda pendiente: lo pone
 * la carga del Excel con el promedio real de los bultos.
 *
 * Devuelve null si la creó, o el motivo por el que no pudo. El caso real es el
 * producto sin precio por kilo: la presentación no tiene de dónde heredarlo.
 */
async function _crearPresentacionInicial(productoId, registro) {
  try {
    const sku = await variantesService.skuDesdeNombre(registro.nombre);
    // 'paquete' necesita la bandera de multipresentación; sin ella la
    // presentación es 'simple', que también se lleva en kilos.
    const esPaquete = !!registro.multipresentacion;
    await variantesService.crear({
      producto_id: productoId,
      sku,
      codigo_barras: sku,
      presentacion: esPaquete ? 'Paquete' : null,
      tipo_presentacion: esPaquete ? 'paquete' : 'simple',
    });
    return null;
  } catch (err) {
    console.error(`[productos] no se pudo crear la presentación de "${registro.nombre}":`, err.message);
    return err.message;
  }
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
    precio_kg: merge('precio_kg'),
    multipresentacion: merge('multipresentacion'),
    por_lotes: merge('por_lotes'),
    destacado: merge('destacado'),
    activo: merge('activo'),
  };
  await model.actualizar(id, registro);

  // Un producto que se dio de alta sin precio por kilo se quedó sin
  // presentación. En cuanto se le pone precio, se le crea: si no, había que
  // saber que existe una pantalla aparte para capturarla a mano.
  const variantes = await model.variantesDe(id, null);
  if (registro.precio_kg != null && !variantes.some((v) => v.tipo_presentacion !== 'cono')) {
    await _crearPresentacionInicial(id, registro);
  }
  return obtener(id);
}

async function eliminar(id) {
  const producto = await model.obtener(id);
  if (!producto) throw new AppError(404, 'NO_ENCONTRADO', 'Producto no encontrado');
  await model.eliminar(id);
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
