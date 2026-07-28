'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');

async function listar(filtros) {
  return model.listar(filtros);
}

async function obtener(id) {
  const a = await model.obtener(id);
  if (!a) throw new AppError(404, 'NO_ENCONTRADO', 'Almacén no encontrado');
  return a;
}

async function crear(datos) {
  const creado = await model.crear({
    nombre: datos.nombre,
    direccion: datos.direccion ?? null,
    es_punto_venta: datos.es_punto_venta ?? false,
    es_tienda_linea: datos.es_tienda_linea ?? false,
    es_matriz: datos.es_matriz ?? false,
    activo: datos.activo ?? true,
  });
  // Cada marca vive en un solo almacén.
  if (datos.es_tienda_linea) await model.marcarUnicoTiendaLinea(creado.id);
  if (datos.es_matriz) await model.marcarUnicaMatriz(creado.id);
  return datos.es_tienda_linea || datos.es_matriz ? model.obtener(creado.id) : creado;
}

async function actualizar(id, datos) {
  const actual = await obtener(id);
  _validarNoDejarTiendaHuerfana(actual, datos);
  const esTiendaLinea =
    datos.es_tienda_linea !== undefined ? datos.es_tienda_linea : !!actual.es_tienda_linea;

  const actualizado = await model.actualizar(id, {
    nombre: datos.nombre ?? actual.nombre,
    direccion: datos.direccion !== undefined ? datos.direccion : actual.direccion,
    es_punto_venta: datos.es_punto_venta !== undefined ? datos.es_punto_venta : actual.es_punto_venta,
    es_tienda_linea: esTiendaLinea,
    es_matriz: datos.es_matriz !== undefined ? datos.es_matriz : !!actual.es_matriz,
    activo: datos.activo !== undefined ? datos.activo : actual.activo,
  });

  // Al encender una marca aquí, se apaga en los demás.
  if (datos.es_tienda_linea === true) await model.marcarUnicoTiendaLinea(id);
  if (datos.es_matriz === true) await model.marcarUnicaMatriz(id);
  if (datos.es_tienda_linea === true || datos.es_matriz === true) return model.obtener(id);
  return actualizado;
}

/**
 * Impide dejar la tienda en línea sin almacén: si este es el marcado y se va a
 * apagar la marca o a desactivar, hay que designar otro primero.
 */
function _validarNoDejarTiendaHuerfana(actual, datos) {
  if (!actual.es_tienda_linea) return;
  const apagaMarca = datos.es_tienda_linea === false;
  const desactiva = datos.activo === false;
  if (apagaMarca || desactiva) {
    throw new AppError(409, 'TIENDA_SIN_ALMACEN',
      `"${actual.nombre}" es el almacén que surte la tienda en línea. ` +
      'Marca otro como tienda en línea antes de desactivarlo o quitarle la marca.');
  }
}

/** Etiquetas legibles para explicar qué impide borrar un almacén. */
const ETIQUETA_DEP = {
  inventario: 'existencias registradas',
  movimientos: 'movimientos en el kardex',
  cajas: 'cajas asignadas',
  pedidos: 'pedidos despachados',
  conversiones: 'desarmes de paquetes',
};

async function eliminar(id) {
  const almacen = await obtener(id);

  const deps = await model.dependencias(id);
  const enUso = Object.entries(deps)
    .filter(([, n]) => Number(n) > 0)
    .map(([k, n]) => `${n} ${ETIQUETA_DEP[k] ?? k}`);

  if (enUso.length) {
    throw new AppError(409, 'ALMACEN_EN_USO',
      `No se puede eliminar "${almacen.nombre}": tiene ${enUso.join(', ')}. ` +
      'Desactívalo en vez de borrarlo para conservar su historial.');
  }
  if (almacen.es_tienda_linea) {
    throw new AppError(409, 'ALMACEN_TIENDA_LINEA',
      `"${almacen.nombre}" es el almacén que surte la tienda en línea. ` +
      'Marca otro antes de eliminarlo.');
  }
  await model.eliminar(id);
}

/** Almacén que surte la tienda en línea (para consultarlo desde el panel). */
async function tiendaLinea() {
  const id = await model.idTiendaLinea();
  return id ? model.obtener(id) : null;
}

/** Almacén matriz: el que surte a las sucursales. */
async function matriz() {
  const id = await model.idMatriz();
  return id ? model.obtener(id) : null;
}

module.exports = { listar, obtener, crear, actualizar, eliminar, tiendaLinea, matriz };
