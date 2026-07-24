'use strict';

const model = require('./model');
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

async function crear(datos) {
  const registro = {
    producto_id: datos.producto_id,
    color_id: datos.color_id ?? null,
    sku: datos.sku.trim(),
    codigo_barras: datos.codigo_barras?.trim() || null,
    presentacion: datos.presentacion ?? null,
    precio: datos.precio,
    precio_oferta: datos.precio_oferta ?? null,
    costo: datos.costo ?? null,
    activo: datos.activo ?? true,
  };
  return model.crear(registro);
}

async function actualizar(id, datos) {
  const actual = await obtener(id);
  const merge = (campo) => (datos[campo] !== undefined ? datos[campo] : actual[campo]);
  const registro = {
    color_id: merge('color_id'),
    sku: datos.sku !== undefined ? datos.sku.trim() : actual.sku,
    codigo_barras:
      datos.codigo_barras !== undefined ? datos.codigo_barras?.trim() || null : actual.codigo_barras,
    presentacion: merge('presentacion'),
    precio: merge('precio'),
    precio_oferta: merge('precio_oferta'),
    costo: merge('costo'),
    activo: merge('activo'),
  };
  return model.actualizar(id, registro);
}

async function eliminar(id) {
  await obtener(id);
  await model.eliminar(id);
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
  listarCodigos,
  agregarCodigo,
  eliminarCodigo,
};
