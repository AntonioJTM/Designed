'use strict';

const model = require('./model');
const productosModel = require('../productos/model');
const tiposModel = require('../tipos-cliente/model');
const { AppError } = require('../../middlewares/error');
const { paginado } = require('../../utils/query');

async function listar(filtros) {
  const { rows, total } = await model.listar(filtros);
  return paginado(rows, total, filtros.page, filtros.limit);
}

async function obtener(id) {
  const v = await model.obtener(id);
  if (!v) throw new AppError(404, 'NO_ENCONTRADO', 'Variante no encontrada');
  return v;
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

/**
 * Precio de la presentación. Si no se capturó, hereda el precio de lista del
 * producto (`productos.precio_kg`): la tienda lo piensa así —el precio es del
 * hilo— y evita teclear lo mismo en cada presentación. Solo falla si no hay
 * ninguno de los dos.
 */
function _exigirPrecio(precio, producto = null) {
  if (precio != null) return precio;
  if (producto?.precio_kg != null) return producto.precio_kg;
  throw new AppError(422, 'PRECIO_REQUERIDO',
    'Falta el precio: captúralo en la presentación o pon el precio por kilo del producto');
}

/**
 * Precio de un cono: el MISMO precio por kilo del paquete. No hay precio por
 * pieza —el cono es el mismo hilo, solo enconado, y se vende por peso—. Lo que
 * gana la tienda al enconar viene del DESTARE: el tubo suma kilos vendibles.
 */
function precioDelCono({ precio_kg }) {
  return round2(Number(precio_kg));
}

/**
 * Valida la coherencia de la presentación y normaliza sus campos.
 * Un 'paquete' necesita peso; un 'cono' necesita de qué paquete sale y
 * cuántos salen. Devuelve el bloque de campos listo para el modelo.
 */
async function _resolverPresentacion(datos, actual = null, producto = null) {
  const tipo = datos.tipo_presentacion ?? actual?.tipo_presentacion ?? 'simple';

  // Paquete y cono solo existen si el producto está marcado multipresentación.
  if (tipo !== 'simple' && producto && !producto.multipresentacion) {
    throw new AppError(422, 'NO_MULTIPRESENTACION',
      'Marca el producto como "multipresentación" para poder manejarlo en paquetes y conos');
  }

  if (tipo === 'simple') {
    return {
      tipo_presentacion: 'simple',
      peso_kg: datos.peso_kg !== undefined ? datos.peso_kg : (actual?.peso_kg ?? null),
      origen_variante_id: null,
      piezas_por_origen: null,
      modo_precio: 'manual',
      precio: _exigirPrecio(datos.precio !== undefined ? datos.precio : actual?.precio, producto),
    };
  }

  if (tipo === 'paquete') {
    // El peso puede quedar PENDIENTE: cuando el producto se acaba de dar de alta
    // todavía no ha llegado mercancía, y el peso real lo pone la carga del Excel
    // (el promedio de los bultos). Se exige al desarmar, que es cuando importa.
    const peso = datos.peso_kg !== undefined ? datos.peso_kg : actual?.peso_kg;
    return {
      tipo_presentacion: 'paquete',
      peso_kg: peso && Number(peso) > 0 ? peso : null,
      origen_variante_id: null,
      piezas_por_origen: null,
      // El paquete lleva precio por kilo: el capturado, o el del producto.
      modo_precio: 'manual',
      precio: _exigirPrecio(datos.precio !== undefined ? datos.precio : actual?.precio, producto),
    };
  }

  // ---- cono ----
  const origenId = datos.origen_variante_id ?? actual?.origen_variante_id;
  const piezas = datos.piezas_por_origen ?? actual?.piezas_por_origen;
  const modo = datos.modo_precio ?? actual?.modo_precio ?? 'manual';

  if (!origenId) {
    throw new AppError(422, 'ORIGEN_REQUERIDO',
      'Un cono debe indicar de qué paquete se desarma');
  }
  if (!piezas || Number(piezas) <= 0) {
    throw new AppError(422, 'PIEZAS_REQUERIDAS',
      'Indica cuántos conos salen de un paquete');
  }

  const paquete = await model.obtener(origenId);
  if (!paquete) {
    throw new AppError(422, 'ORIGEN_INVALIDO', 'El paquete de origen no existe');
  }
  if (paquete.tipo_presentacion !== 'paquete') {
    throw new AppError(422, 'ORIGEN_NO_ES_PAQUETE',
      `La variante ${paquete.sku} no es un paquete; un cono solo puede salir de un paquete`);
  }
  const productoId = actual?.producto_id ?? datos.producto_id;
  if (Number(paquete.producto_id) !== Number(productoId)) {
    throw new AppError(422, 'ORIGEN_OTRO_PRODUCTO',
      'El paquete de origen debe ser del mismo producto');
  }
  if (actual && Number(origenId) === Number(actual.id)) {
    throw new AppError(422, 'ORIGEN_CIRCULAR', 'Una variante no puede derivarse de sí misma');
  }

  // Con modo 'calculado' el precio lo manda el paquete; con 'manual' lo pone
  // el usuario y aquí solo se exige que venga.
  let precio;
  if (modo === 'calculado') {
    precio = precioDelCono({ precio_kg: paquete.precio });
  } else {
    precio = datos.precio !== undefined ? datos.precio : actual?.precio;
    if (precio == null) {
      throw new AppError(422, 'PRECIO_REQUERIDO',
        'Con precio propio tienes que capturar el precio por kilo del cono');
    }
  }

  return {
    tipo_presentacion: 'cono',
    // Peso de un cono: el del paquete repartido entre las piezas que salen.
    peso_kg: round3(Number(paquete.peso_kg) / Number(piezas)),
    origen_variante_id: origenId,
    piezas_por_origen: piezas,
    modo_precio: modo,
    precio,
  };
}

/**
 * Reajusta el precio de los conos que dependen de un paquete. Se llama cuando
 * cambia el precio por kilo o el peso del paquete, para que el mostrador no
 * quede cobrando con datos viejos.
 */
async function _sincronizarConos(paqueteId) {
  const paquete = await model.obtener(paqueteId);
  if (!paquete || paquete.tipo_presentacion !== 'paquete') return;

  for (const cono of await model.derivadasDe(paqueteId)) {
    await model.fijarPrecio(
      cono.id,
      precioDelCono({ precio_kg: paquete.precio })
    );
  }
}

/**
 * SKU a partir del nombre del producto, único. "MARINO OSCURO 2/30" pasa a
 * MARINO-OSCURO-2-30. Se usa al crear la presentación sola: la tienda no maneja
 * SKU propios, el identificador es el nombre del color.
 */
async function skuDesdeNombre(nombre) {
  const base =
    String(nombre ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 45) || 'PRESENTACION';

  for (let i = 0; i < 50; i++) {
    const sku = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await model.porSku(sku))) return sku;
  }
  throw new AppError(409, 'SKU_OCUPADO',
    `No se pudo generar un SKU libre a partir de "${nombre}"`);
}

async function crear(datos) {
  const producto = await productosModel.obtener(datos.producto_id);
  if (!producto) throw new AppError(422, 'PRODUCTO_INVALIDO', 'El producto no existe');

  const presentacion = await _resolverPresentacion(datos, null, producto);
  const registro = {
    producto_id: datos.producto_id,
    sku: datos.sku.trim(),
    codigo_barras: datos.codigo_barras?.trim() || null,
    presentacion: datos.presentacion ?? null,
    // El lote solo se guarda si el producto se maneja por lotes.
    lote: producto.por_lotes ? datos.lote?.trim() || null : null,
    precio_oferta: datos.precio_oferta ?? null,
    costo: datos.costo ?? null,
    activo: datos.activo ?? true,
    ...presentacion,
  };
  return model.crear(registro);
}

async function actualizar(id, datos) {
  const actual = await obtener(id);
  const producto = await productosModel.obtener(actual.producto_id);
  const merge = (campo) => (datos[campo] !== undefined ? datos[campo] : actual[campo]);
  const presentacion = await _resolverPresentacion(datos, actual, producto);

  const registro = {
    sku: datos.sku !== undefined ? datos.sku.trim() : actual.sku,
    codigo_barras:
      datos.codigo_barras !== undefined ? datos.codigo_barras?.trim() || null : actual.codigo_barras,
    presentacion: merge('presentacion'),
    lote: producto?.por_lotes
      ? datos.lote !== undefined
        ? datos.lote?.trim() || null
        : actual.lote
      : null,
    precio_oferta: merge('precio_oferta'),
    costo: merge('costo'),
    activo: merge('activo'),
    ...presentacion,
  };
  const actualizada = await model.actualizar(id, registro);

  // Si se movió el precio por kilo o el peso del paquete, los conos que
  // cuelgan de él tienen que recalcularse.
  if (actualizada.tipo_presentacion === 'paquete') await _sincronizarConos(id);
  return model.obtener(id);
}

async function eliminar(id) {
  const variante = await obtener(id);
  if (variante.tipo_presentacion === 'paquete') {
    const conos = await model.derivadasDe(id);
    if (conos.length > 0) {
      throw new AppError(409, 'PAQUETE_CON_CONOS',
        'No se puede eliminar: hay conos que se desarman de este paquete. Bórralos primero.');
    }
  }
  await model.eliminar(id);
}

// ---- Precios por tipo de cliente ----

/**
 * Fija (o borra) el precio de una variante para un tipo de cliente.
 * El público NO se guarda aquí: su precio es `producto_variantes.precio`.
 */
async function fijarPrecioTipo(varianteId, tipoClienteId, precio) {
  await obtener(varianteId);
  const tipo = await tiposModel.obtener(tipoClienteId);
  if (!tipo) throw new AppError(404, 'NO_ENCONTRADO', 'Tipo de cliente no encontrado');
  if (tipo.es_publico) {
    throw new AppError(422, 'TIPO_PUBLICO',
      'El precio del público es el precio de la presentación; edítalo ahí.');
  }
  await model.fijarPrecioTipo(varianteId, tipoClienteId, precio ?? null);
  return obtener(varianteId);
}

// ---- Códigos de barras adicionales ----

async function listarCodigos(varianteId) {
  await obtener(varianteId); // 404 si no existe
  return model.codigosDe(varianteId);
}

async function agregarCodigo(varianteId, datos) {
  await obtener(varianteId);
  const cod = datos.codigo.trim();
  const dueno = await model.variantePorCodigo(cod);
  if (dueno && dueno !== varianteId) {
    throw new AppError(409, 'CODIGO_EN_USO', 'Ese código ya está asignado a otra variante');
  }
  if (dueno === varianteId) {
    throw new AppError(409, 'CODIGO_DUPLICADO', 'Esa variante ya tiene ese código');
  }
  return model.agregarCodigo(varianteId, { ...datos, codigo: cod });
}

/**
 * Lo que necesita el lector de códigos: la presentación que se vende y, si el
 * código escaneado es de un bulto concreto, ese bulto con su peso real.
 *
 * Con eso el POS cobra por lo que pesa el bulto que tiene en la mano, que es el
 * punto de registrar los bultos uno por uno.
 */
async function resolverCodigo(codigo) {
  const cod = String(codigo).trim();
  if (!cod) throw new AppError(422, 'CODIGO_REQUERIDO', 'Escanea o teclea un código');

  const varianteId = await model.variantePorCodigo(cod);
  if (!varianteId) {
    throw new AppError(404, 'CODIGO_DESCONOCIDO', `El código ${cod} no está registrado`);
  }
  const variante = await obtener(varianteId);
  // null cuando el código es el principal de la presentación: no es un bulto y
  // no tiene peso propio, así que el POS usará la cantidad que se teclee.
  const bulto = await model.bultoPorCodigo(cod);
  return { variante, bulto };
}

async function eliminarCodigo(codigoId) {
  const c = await model.obtenerCodigo(codigoId);
  if (!c) throw new AppError(404, 'NO_ENCONTRADO', 'Código no encontrado');
  await model.eliminarCodigo(codigoId);
}

module.exports = {
  skuDesdeNombre,
  listar,
  obtener,
  crear,
  actualizar,
  eliminar,
  precioDelCono,
  fijarPrecioTipo,
  listarCodigos,
  agregarCodigo,
  eliminarCodigo,
  resolverCodigo,
};
