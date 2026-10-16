'use strict';

const service = require('./service');
const permisos = require('../permisos/service');
const { parsePagination, parseBool } = require('../../utils/query');

/**
 * Cuánto hay en un almacén solo se le dice al personal de ESA tienda
 * (2026-10-15). Al público (la ruta no pide sesión) no se le dice de ninguno.
 */
async function _almacenVisible(req, almacenId) {
  if (!almacenId) return undefined;
  const auth = permisos.authOpcional(req);
  if (auth?.tipo !== 'usuario') return undefined;
  permisos.exigirAlmacen(await permisos.almacenesDe(auth), almacenId, 'Ese almacén');
  return almacenId;
}

/**
 * Una presentación trae TODOS sus bultos (`codigos`), con dónde está cada uno y
 * en qué venta salió. A quien es de una sola tienda, solo los de las suyas
 * (2026-10-16: el lector de la caja mandaba los de todas las tiendas).
 */
async function _bultosDeSusTiendas(req, variante) {
  if (!variante?.codigos) return variante;
  const almacenes = await permisos.almacenesDe(permisos.authOpcional(req));
  if (almacenes === null) return variante;
  variante.codigos = variante.codigos.filter((b) => b.almacen_id != null && almacenes.includes(Number(b.almacen_id)));
  return variante;
}

async function listar(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const almacenId = await _almacenVisible(req, req.query.almacen_id ? Number(req.query.almacen_id) : undefined);
    const data = await service.listar({
      producto_id: req.query.producto_id ? Number(req.query.producto_id) : undefined,
      q: req.query.q,
      activo: parseBool(req.query.activo),
      tipo_presentacion: req.query.tipo_presentacion,
      // La caja busca con su almacén: así cada presentación dice cuánto hay AHÍ.
      almacen_id: almacenId,
      page,
      limit,
      offset,
    });
    // Ruta pública y la usa la caja para buscar: el costo solo a quien lo puede ver.
    await permisos.sinCostosSiNoVe(req, data.items ?? data);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function crear(req, res, next) {
  try {
    await permisos.exigirVerCostos(req, req.body.costo);
    const data = await _bultosDeSusTiendas(req, await service.crear(req.body));
    return res.status(201).json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function actualizar(req, res, next) {
  try {
    await permisos.exigirVerCostos(req, req.body.costo);
    const data = await _bultosDeSusTiendas(req, await service.actualizar(Number(req.params.id), req.body));
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

// ---- Códigos de barras adicionales ----

async function fijarPrecioTipo(req, res, next) {
  try {
    const data = await service.fijarPrecioTipo(
      Number(req.params.id),
      req.body.tipo_cliente_id,
      req.body.precio
    );
    res.json({ data: await _bultosDeSusTiendas(req, data), error: null });
  } catch (err) {
    next(err);
  }
}

async function listarCodigos(req, res, next) {
  try {
    // Los bultos de SUS tiendas (2026-10-15); los de otra no se listan.
    const almacenes = await permisos.almacenesDe(req.auth);
    const data = (await service.listarCodigos(Number(req.params.id)))
      .filter((b) => almacenes === null || (b.almacen_id != null && almacenes.includes(Number(b.almacen_id))));
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

/** Resuelve un código escaneado: presentación + el bulto, si lo es. */
async function resolverCodigo(req, res, next) {
  try {
    const data = await service.resolverCodigo(req.params.codigo);
    await permisos.sinCostosSiNoVe(req, data?.variante);
    // Un paquete de otra tienda: se dice que no está aquí, no dónde está ni en
    // qué venta o envío salió.
    const almacenes = await permisos.almacenesDe(req.auth);
    if (data?.bulto?.almacen_id != null && !permisos.puedeAlmacen(almacenes, data.bulto.almacen_id)) {
      data.bulto.almacen = 'otra tienda';
      data.bulto.consumido_folio = null;
      data.bulto.en_camino_folio = null;
    }
    await _bultosDeSusTiendas(req, data?.variante);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function agregarCodigo(req, res, next) {
  try {
    const data = await service.agregarCodigo(
      Number(req.params.id), req.body, req.auth?.sub, await permisos.almacenesDe(req.auth)
    );
    return res.status(201).json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function eliminarCodigo(req, res, next) {
  try {
    const data = await service.eliminarCodigo(
      Number(req.params.codigoId), req.auth?.sub, await permisos.almacenesDe(req.auth)
    );
    return res.json({ data: { eliminado: true, ...data }, error: null });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listar,
  crear,
  actualizar,
  eliminar,
  fijarPrecioTipo,
  listarCodigos,
  agregarCodigo,
  eliminarCodigo,
  resolverCodigo,
};
