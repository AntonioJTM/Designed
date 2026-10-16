'use strict';

const service = require('./service');
const { parseBool } = require('../../utils/query');
const permisos = require('../permisos/service');

async function listar(req, res, next) {
  try {
    let data = await service.listar({ activo: parseBool(req.query.activo) });
    // CADA QUIEN, SUS TIENDAS (2026-10-15): al personal de una sola tienda se le
    // dan las suyas y la Matriz (a la que le pide mercancía), marcadas con `mio`.
    const auth = permisos.authOpcional(req);
    if (auth?.tipo === 'usuario') {
      const almacenes = await permisos.almacenesDe(auth);
      const mio = (a) => almacenes === null || almacenes.includes(Number(a.id));
      // Quien es de la MATRIZ surte a las demás: las ve todas (solo sus nombres),
      // para poder mandarles (2026-10-16).
      const surte = data.some((a) => mio(a) && Number(a.es_matriz));
      data = data.filter((a) => surte || mio(a) || Number(a.es_matriz)).map((a) => ({ ...a, mio: mio(a) }));
    }
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

/** Almacén del que descuenta la tienda en línea. */
async function tiendaLinea(req, res, next) {
  try {
    const data = await service.tiendaLinea();
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function crear(req, res, next) {
  try {
    const data = await service.crear(req.body);
    res.status(201).json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function actualizar(req, res, next) {
  try {
    const data = await service.actualizar(Number(req.params.id), req.body);
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function eliminar(req, res, next) {
  try {
    await service.eliminar(Number(req.params.id));
    res.json({ data: { eliminado: true }, error: null });
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, tiendaLinea, crear, actualizar, eliminar };
