'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');
const { slugify } = require('../../utils/slug');
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

async function crear(datos) {
  const registro = {
    padre_id: datos.padre_id ?? null,
    nombre: datos.nombre,
    slug: datos.slug?.trim() || slugify(datos.nombre),
    descripcion: datos.descripcion ?? null,
    imagen_url: datos.imagen_url ?? null,
    orden: datos.orden ?? 0,
    activo: datos.activo ?? true,
  };
  return model.crear(registro);
}

async function actualizar(id, datos) {
  const actual = await obtener(id);
  if (datos.padre_id === id) {
    throw new AppError(422, 'PADRE_INVALIDO', 'Una categoría no puede ser su propio padre');
  }
  const registro = {
    padre_id: datos.padre_id !== undefined ? datos.padre_id : actual.padre_id,
    nombre: datos.nombre ?? actual.nombre,
    slug: datos.slug?.trim() || (datos.nombre ? slugify(datos.nombre) : actual.slug),
    descripcion: datos.descripcion !== undefined ? datos.descripcion : actual.descripcion,
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
