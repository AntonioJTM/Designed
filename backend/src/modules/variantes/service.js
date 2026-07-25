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

/** Exige precio capturado en las presentaciones que no lo derivan del paquete. */
function _exigirPrecio(precio) {
  if (precio == null) {
    throw new AppError(422, 'PRECIO_REQUERIDO', 'Falta el precio de la variante');
  }
  return precio;
}

/**
 * Precio de un cono derivado de su paquete: se reparte el valor del paquete
 * completo entre los conos que salen de él.
 *
 *   paquete de 10 kg a $200/kg = $2,000 · 8 conos → $250 por cono
 */
function precioDelCono({ precio_kg, peso_kg, piezas }) {
  return round2((Number(precio_kg) * Number(peso_kg)) / Number(piezas));
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
      precio: _exigirPrecio(datos.precio !== undefined ? datos.precio : actual?.precio),
    };
  }

  if (tipo === 'paquete') {
    const peso = datos.peso_kg !== undefined ? datos.peso_kg : actual?.peso_kg;
    if (!peso || Number(peso) <= 0) {
      throw new AppError(422, 'PESO_REQUERIDO',
        'Un paquete necesita su peso en kilos para poder desarmarlo y calcular precios');
    }
    return {
      tipo_presentacion: 'paquete',
      peso_kg: peso,
      origen_variante_id: null,
      piezas_por_origen: null,
      // El paquete siempre lleva precio por kilo capturado a mano.
      modo_precio: 'manual',
      precio: _exigirPrecio(datos.precio !== undefined ? datos.precio : actual?.precio),
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
    precio = precioDelCono({
      precio_kg: paquete.precio,
      peso_kg: paquete.peso_kg,
      piezas,
    });
  } else {
    precio = datos.precio !== undefined ? datos.precio : actual?.precio;
    if (precio == null) {
      throw new AppError(422, 'PRECIO_REQUERIDO',
        'Con precio por pieza tienes que capturar el precio del cono');
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
      precioDelCono({
        precio_kg: paquete.precio,
        peso_kg: paquete.peso_kg,
        piezas: cono.piezas_por_origen,
      })
    );
  }
}

async function crear(datos) {
  const producto = await productosModel.obtener(datos.producto_id);
  if (!producto) throw new AppError(422, 'PRODUCTO_INVALIDO', 'El producto no existe');

  const presentacion = await _resolverPresentacion(datos, null, producto);
  const registro = {
    producto_id: datos.producto_id,
    color_id: datos.color_id ?? null,
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
    color_id: merge('color_id'),
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

async function agregarCodigo(varianteId, { codigo, etiqueta }) {
  await obtener(varianteId);
  const cod = codigo.trim();
  const dueno = await model.variantePorCodigo(cod);
  if (dueno && dueno !== varianteId) {
    throw new AppError(409, 'CODIGO_EN_USO', 'Ese código ya está asignado a otra variante');
  }
  if (dueno === varianteId) {
    throw new AppError(409, 'CODIGO_DUPLICADO', 'Esa variante ya tiene ese código');
  }
  return model.agregarCodigo(varianteId, cod, etiqueta);
}

async function eliminarCodigo(codigoId) {
  const c = await model.obtenerCodigo(codigoId);
  if (!c) throw new AppError(404, 'NO_ENCONTRADO', 'Código no encontrado');
  await model.eliminarCodigo(codigoId);
}

module.exports = {
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
};
