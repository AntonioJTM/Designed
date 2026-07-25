'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');
const { paginado } = require('../../utils/query');

async function listar(filtros) {
  const { rows, total } = await model.listar(filtros);
  return paginado(rows, total, filtros.page, filtros.limit);
}

async function obtener(id) {
  const cat = await model.obtener(id);
  if (!cat) throw new AppError(404, 'NO_ENCONTRADO', 'Categoría no encontrada');
  return cat;
}

/**
 * Normaliza la lista de calibres: recorta espacios, quita repetidos y vacíos,
 * y la deja como "1/30,2/30". null si no se especificó ninguno.
 */
function _normalizarCalibres(valor) {
  if (valor === undefined || valor === null) return null;
  const lista = [...new Set(String(valor).split(',').map((c) => c.trim()).filter(Boolean))];
  return lista.length ? lista.join(',') : null;
}

async function crear(datos) {
  const registro = {
    nombre: datos.nombre,
    descripcion: datos.descripcion ?? null,
    calibres: _normalizarCalibres(datos.calibres),
    imagen_url: datos.imagen_url ?? null,
    orden: datos.orden ?? 0,
    activo: datos.activo ?? true,
  };
  return model.crear(registro);
}

async function actualizar(id, datos) {
  const actual = await obtener(id);
  const registro = {
    nombre: datos.nombre ?? actual.nombre,
    descripcion: datos.descripcion !== undefined ? datos.descripcion : actual.descripcion,
    calibres:
      datos.calibres !== undefined ? _normalizarCalibres(datos.calibres) : actual.calibres,
    imagen_url: datos.imagen_url !== undefined ? datos.imagen_url : actual.imagen_url,
    orden: datos.orden !== undefined ? datos.orden : actual.orden,
    activo: datos.activo !== undefined ? datos.activo : actual.activo,
  };
  return model.actualizar(id, registro);
}

async function eliminar(id) {
  await obtener(id);
  const dep = await model.contarDependencias(id);
  if (dep.productos > 0) {
    throw new AppError(
      409,
      'CATEGORIA_EN_USO',
      `No se puede eliminar: ${dep.productos} producto(s) usan esta categoría. ` +
        `Reasígnalos a otra categoría o desactiva esta en lugar de borrarla.`
    );
  }
  await model.eliminar(id);
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
