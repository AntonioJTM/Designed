'use strict';

const service = require('./service');
const { parsePagination, parseBool } = require('../../utils/query');
const permisos = require('../permisos/service');
const almacenesModel = require('../almacenes/model');
const { AppError } = require('../../middlewares/error');

/**
 * `disponible` son los kilos del almacén de la tienda en línea (apagada). Se quitan a
 * quien no ve ese almacén, también sin sesión (2026-10-26, auditoría: cualquiera leía
 * los kilos de Almacén General); queda `hay_existencias`, que es lo que necesitaba la
 * tienda para decir "agotado".
 */
async function _sinKilosAjenos(req, items) {
  const auth = permisos.authOpcional(req);
  if (auth?.tipo === 'usuario') {
    const mias = await permisos.almacenesDe(auth);
    if (mias === null) return;
    const id = await almacenesModel.idTiendaLinea();
    if (id != null && mias.includes(Number(id))) return;
  }
  for (const it of items ?? []) {
    if (!('disponible' in it)) continue;
    it.hay_existencias = Number(it.disponible) > 0;
    it.disponible = null;
  }
}

async function listar(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listar({
      q: req.query.q,
      categoria_id: req.query.categoria_id ? Number(req.query.categoria_id) : undefined,
      activo: parseBool(req.query.activo),
      destacado: parseBool(req.query.destacado),
      page,
      limit,
      offset,
    });
    await _sinKilosAjenos(req, data.items ?? data.rows ?? []);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function obtener(req, res, next) {
  try {
    const data = await service.obtener(Number(req.params.id));
    // La ruta es pública (la usaba la tienda en línea): el precio de compra no.
    await permisos.sinCostosSiNoVe(req, data.variantes);
    await _sinKilosAjenos(req, [data, ...(data.variantes ?? [])]);
    // Los precios por lista, solo al personal: un visitante no ve a cuánto se
    // le vende a mayoreo. La pantalla de presentaciones los necesita.
    if (permisos.authOpcional(req)?.tipo === 'usuario') await service.conPreciosLista(data.variantes);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function crear(req, res, next) {
  try {
    const data = await service.crear(req.body);
    // Sin el costo a quien no lo ve (2026-10-26, auditoría: guardar un hilo lo mandaba).
    await permisos.sinCostosSiNoVe(req, data?.variantes);
    return res.status(201).json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function actualizar(req, res, next) {
  try {
    // El precio por kilo le pone precio a sus presentaciones en $0 (y a sus conos):
    // pide «Cambiar precios», como «Precio y peso» (2026-10-26, auditoría: con solo
    // Productos se cambiaba).
    if (req.body.precio_kg !== undefined) {
      const actual = await require('./model').obtener(Number(req.params.id));
      const cambia = actual && Number(actual.precio_kg ?? 0) !== Number(req.body.precio_kg ?? 0);
      if (cambia && !(await permisos.puede(req.auth, 'hacer:cambiar_precios'))) {
        throw new AppError(403, 'SIN_PERMISO',
          'Cambiar el precio por kilo pide «Cambiar precios». Pídeselo a quien lo tenga.');
      }
    }
    const data = await service.actualizar(Number(req.params.id), req.body);
    await permisos.sinCostosSiNoVe(req, data?.variantes);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function eliminar(req, res, next) {
  try {
    await service.eliminar(Number(req.params.id));
    return res.json({ data: { eliminado: true }, error: null });
  } catch (err) {
    return next(err);
  }
}

/** ¿Se puede borrar? y, si no, por qué. */
async function eliminacion(req, res, next) {
  try {
    return res.json({ data: await service.eliminacion(Number(req.params.id)), error: null });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listar, obtener, crear, actualizar, eliminar, eliminacion };
