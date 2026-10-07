'use strict';

const model = require('./model');
const variantesService = require('../variantes/service');
const variantesModel = require('../variantes/model');
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

/**
 * Le pega a cada presentación sus precios por lista (`precios`, como en
 * `GET /variantes/:id`). Sin esto, la pantalla de presentaciones guardaba los
 * precios por lista y al recargar los enseñaba vacíos, como si no se hubieran
 * guardado (2026-10-06).
 */
async function conPreciosLista(variantes) {
  const mapa = await variantesModel.preciosDeVarias(variantes.map((v) => v.id));
  for (const v of variantes) v.precios = mapa.get(v.id) ?? [];
  return variantes;
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

  // Un hilo que entró con la lista completa del proveedor llega SIN precio: su
  // presentación quedó en $0 y no se puede vender. Al ponerle precio por kilo,
  // la presentación en $0 lo toma (y sus conos de precio calculado lo siguen).
  // Las que YA tienen precio no se tocan: cambiar el precio por kilo no
  // propaga, a propósito.
  if (registro.precio_kg != null && Number(registro.precio_kg) > 0) {
    for (const v of variantes) {
      if (v.tipo_presentacion !== 'cono' && !(Number(v.precio) > 0)) {
        await variantesService.actualizar(v.id, { precio: Number(registro.precio_kg) });
      }
    }
  }
  return obtener(id);
}

/**
 * Qué impide borrar el producto, dicho en palabras: "tiene 9 bultos", "177.91 kg
 * en existencia"… Lista vacía = se puede borrar.
 */
function motivos(c) {
  const n = (x, uno, varios) => `${x.toLocaleString('en-US')} ${x === 1 ? uno : varios}`;
  const lista = [];
  if (c.cargas) lista.push(n(c.cargas, 'carga de mercancía', 'cargas de mercancía'));
  if (c.bultos) lista.push(n(c.bultos, 'bulto', 'bultos'));
  if (c.saldos) lista.push(`${Number(c.kg).toLocaleString('en-US', { maximumFractionDigits: 3 })} kg en existencia`);
  if (c.movimientos) lista.push(n(c.movimientos, 'movimiento en el kardex', 'movimientos en el kardex'));
  if (c.ventas) lista.push(n(c.ventas, 'venta', 'ventas'));
  if (c.traspasos) lista.push(n(c.traspasos, 'traspaso', 'traspasos'));
  if (c.desarmes) lista.push(n(c.desarmes, 'desarme a conos', 'desarmes a conos'));
  if (c.compras) lista.push(n(c.compras, 'orden de compra', 'órdenes de compra'));
  if (c.carritos) lista.push(n(c.carritos, 'carrito de la tienda en línea', 'carritos de la tienda en línea'));
  return lista;
}

/** "a, b y c". */
function enLista(xs) {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
}

/**
 * ¿Se puede borrar? Lo pregunta el modal del producto antes de ofrecer el botón,
 * para decir POR QUÉ no en vez de dejar que el usuario lo intente y falle.
 */
async function eliminacion(id) {
  const producto = await model.obtener(id);
  if (!producto) throw new AppError(404, 'NO_ENCONTRADO', 'Producto no encontrado');
  const lista = motivos(await model.cargado(id));
  return {
    se_puede: lista.length === 0,
    motivos: lista,
    mensaje: lista.length ? `No se puede eliminar: tiene ${enLista(lista)}.` : null,
  };
}

/**
 * Solo se borra un producto SIN nada cargado (regla del usuario, 2026-10-03):
 * si tiene bultos, existencias, movimientos, ventas, traspasos o desarmes, se
 * rechaza con 409 y se dice qué tiene. Para dejar de ofrecerlo está "Activo".
 */
async function eliminar(id) {
  const resultado = await model.eliminarSiVacio(id);
  if (resultado?.noExiste) throw new AppError(404, 'NO_ENCONTRADO', 'Producto no encontrado');
  if (resultado) {
    throw new AppError(409, 'PRODUCTO_CON_MOVIMIENTOS',
      `No se puede eliminar: tiene ${enLista(motivos(resultado))}. ` +
      'Para dejar de venderlo, desmárcalo como Activo.');
  }
}

module.exports = { listar, obtener, conPreciosLista, crear, actualizar, eliminar, eliminacion };
