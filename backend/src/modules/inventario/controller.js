'use strict';

const service = require('./service');
const hilo = require('./hilo');
const traspasoPdf = require('./traspaso-pdf');
const { parsePagination, parseBool } = require('../../utils/query');
const { AppError } = require('../../middlewares/error');
const permisos = require('../permisos/service');
const { pool } = require('../../config/db');

/** Los almacenes que puede ver quien pregunta (null = todos). */
const alcance = (req) => permisos.almacenesDe(req.auth);

/** Un almacén que viene en la petición tiene que ser de SUS tiendas (404 si no). */
async function _suAlmacen(req, almacenId) {
  const almacenes = await alcance(req);
  if (almacenId != null && almacenId !== '') permisos.exigirAlmacen(almacenes, almacenId, 'Ese almacén');
  return almacenes;
}

/**
 * CADA QUIEN, SUS TIENDAS (2026-10-15): un traspaso se ve si sale de una de sus
 * tiendas o llega a una de ellas. Corre para toda ruta con `:id` (router.param).
 * Deja el traspaso en `req.traspasoAlcance` para que enviar y recibir revisen su
 * lado: surte quien es del origen y recibe quien es del destino.
 */
async function traspasoDeSusTiendas(req, res, next, id) {
  try {
    // router.param corre ANTES de authRequired: el token se lee aquí.
    const auth = req.auth ?? permisos.authOpcional(req);
    if (auth?.tipo !== 'usuario' || !(Number(id) > 0)) return next();
    const almacenes = await permisos.almacenesDe(auth);
    if (almacenes === null) return next();
    const [[t]] = await pool.query(
      'SELECT almacen_origen_id, almacen_destino_id FROM traspasos WHERE id = :id', { id: Number(id) }
    );
    if (!t) return next();
    if (!permisos.puedeAlmacen(almacenes, t.almacen_origen_id) && !permisos.puedeAlmacen(almacenes, t.almacen_destino_id)) {
      permisos.exigirAlmacen(almacenes, t.almacen_origen_id, 'Ese envío');
    }
    req.traspasoAlcance = { almacenes, ...t };
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Surtir (enviar o guardar lo escaneado) es de quien está en el ORIGEN. */
function _exigirLado(req, lado, que) {
  const t = req.traspasoAlcance;
  if (!t) return;
  permisos.exigirAlmacen(t.almacenes, lado === 'origen' ? t.almacen_origen_id : t.almacen_destino_id, que);
}

/** Un día 'YYYY-MM-DD' o undefined: el filtro de fechas del kardex. */
function fechaDia(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

async function listarStock(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const almacenes = await _suAlmacen(req, req.query.almacen_id);
    const data = await service.listarStock({
      almacenes,
      almacen_id: req.query.almacen_id ? Number(req.query.almacen_id) : undefined,
      variante_id: req.query.variante_id ? Number(req.query.variante_id) : undefined,
      q: req.query.q,
      bajo_stock: parseBool(req.query.bajo_stock),
      apartado: parseBool(req.query.apartado),
      // La pantalla quiere saber qué fue lo último que le pasó a cada renglón.
      conUltimoMovimiento: parseBool(req.query.ultimo_movimiento),
      page,
      limit,
      offset,
    });
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function resumenPorAlmacen(req, res, next) {
  try {
    res.json({ data: await service.resumenPorAlmacen(await alcance(req)), error: null });
  } catch (err) {
    next(err);
  }
}

async function alertas(req, res, next) {
  try {
    const data = await service.alertas(await alcance(req));
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function listarMovimientos(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const almacenes = await _suAlmacen(req, req.query.almacen_id);
    const data = await service.listarMovimientos({
      almacenes,
      variante_id: req.query.variante_id ? Number(req.query.variante_id) : undefined,
      almacen_id: req.query.almacen_id ? Number(req.query.almacen_id) : undefined,
      tipo: req.query.tipo,
      // Agrupación en lenguaje de tienda: ventas, traspasos, desarmes…
      concepto: req.query.concepto,
      // Color, calibre, SKU, folio o código de bulto.
      q: req.query.q,
      // Días (YYYY-MM-DD), los dos inclusive. Lo que no tenga esa forma se
      // ignora en vez de llegar al SQL.
      desde: fechaDia(req.query.desde),
      hasta: fechaDia(req.query.hasta),
      page,
      limit,
      offset,
    });
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function registrarMovimiento(req, res, next) {
  try {
    await _suAlmacen(req, req.body.almacen_id);
    await permisos.exigirVerCostos(req, req.body.costo_unitario);
    const data = await service.registrarMovimiento(req.body, req.auth.sub);
    res.status(201).json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

/** Qué trae el bulto escaneado: paquete, kilos, conos y dónde hay existencias. */
async function previaDesarmeBulto(req, res, next) {
  try {
    const data = await service.previaDesarmeBulto(req.params.codigo, await alcance(req));
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function desarmar(req, res, next) {
  try {
    await _suAlmacen(req, req.body.almacen_origen_id);
    const almacenes = await _suAlmacen(req, req.body.almacen_destino_id);
    const data = await service.desarmar(req.body, req.auth.sub, almacenes);
    res.status(201).json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function listarConversiones(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listarConversiones({
      variante_id: req.query.variante_id ? Number(req.query.variante_id) : null,
      page, limit, offset,
      almacenes: await alcance(req),
    });
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

/** Cuántos paquetes son X kilos, con los pesos reales de la bodega. */
/** El detalle de un hilo: saldos por presentación y almacén, y sus lotes. */
async function detalleHilo(req, res, next) {
  try {
    const data = await hilo.detalleHilo(Number(req.params.productoId), await alcance(req));
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

/** Los bultos de un lote del hilo. `?sin_lote=1` trae los que no traen lote. */
async function bultosDeLote(req, res, next) {
  try {
    const sinLote = req.query.sin_lote === '1' || req.query.sin_lote === 'true';
    const lote = sinLote ? null : String(req.query.lote ?? '').trim();
    if (!sinLote && !lote) throw new AppError(422, 'FALTA_LOTE', 'Falta decir de qué lote');
    const data = await hilo.bultosDeLote(Number(req.params.productoId), lote, await alcance(req));
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function equivalenciaPaquetes(req, res, next) {
  try {
    await _suAlmacen(req, req.query.almacen_id);
    const data = await service.equivalenciaPaquetes({
      variante_id: Number(req.query.variante_id),
      almacen_id: Number(req.query.almacen_id),
      kg: req.query.kg != null ? Number(req.query.kg) : null,
    });
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function solicitarTraspaso(req, res, next) {
  try {
    // Pide quien es del destino (para su tienda) o surte quien es del origen.
    // Si solo es del destino, pide A CIEGAS: no se le dice cuánto hay allá.
    const almacenes = await alcance(req);
    const suyoOrigen = permisos.puedeAlmacen(almacenes, req.body.almacen_origen_id);
    const suyoDestino = permisos.puedeAlmacen(almacenes, req.body.almacen_destino_id);
    if (!suyoOrigen && !suyoDestino) permisos.exigirAlmacen(almacenes, req.body.almacen_destino_id, 'Ese almacén');
    // A ciegas se le pide a la MATRIZ (la que surte), no a cualquier tienda (2026-10-16).
    if (!suyoOrigen) {
      const [[origen]] = await pool.query('SELECT es_matriz FROM almacenes WHERE id = :id', { id: Number(req.body.almacen_origen_id) });
      if (!Number(origen?.es_matriz)) permisos.exigirAlmacen(almacenes, req.body.almacen_origen_id, 'Ese almacén');
    }
    const data = await service.solicitarTraspaso(req.body, req.auth.sub, { aCiegas: !suyoOrigen });
    res.status(201).json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function enviarTraspaso(req, res, next) {
  try {
    _exigirLado(req, 'origen', 'Ese envío');
    const data = await service.enviarTraspaso(Number(req.params.id), req.auth.sub, req.body);
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function guardarEscaneos(req, res, next) {
  try {
    _exigirLado(req, 'origen', 'Ese envío');
    const data = await service.guardarEscaneos(Number(req.params.id), req.auth.sub, req.body);
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function recibirTraspaso(req, res, next) {
  try {
    _exigirLado(req, 'destino', 'Ese envío');
    const data = await service.recibirTraspaso(Number(req.params.id), req.auth.sub, req.body);
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function cancelarTraspaso(req, res, next) {
  try {
    const data = await service.cancelarTraspaso(
      Number(req.params.id),
      req.auth.sub,
      req.body?.motivo
    );
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function listarTraspasos(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listarTraspasos({
      almacen_destino_id: req.query.almacen_destino_id ? Number(req.query.almacen_destino_id) : null,
      page, limit, offset,
      almacenes: await alcance(req),
    });
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function obtenerTraspaso(req, res, next) {
  try {
    res.json({ data: await service.obtenerTraspaso(Number(req.params.id)), error: null });
  } catch (err) {
    next(err);
  }
}

async function configurar(req, res, next) {
  try {
    await _suAlmacen(req, req.body.almacen_id);
    const data = await service.configurar(req.body);
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

/**
 * El PDF de un envío (lo que salió, con cada paquete) o de su recepción (lo que
 * llegó y lo que faltó), 2026-10-20. Las tiendas ya las revisó router.param.
 */
async function pdfTraspaso(req, res, next) {
  try {
    const tipo = req.query.tipo === 'recepcion' ? 'recepcion' : 'envio';
    const { buffer, folio } = tipo === 'recepcion'
      ? await traspasoPdf.pdfRecepcion(Number(req.params.id), { usuarioId: req.auth.sub })
      : await traspasoPdf.pdfEnvio(Number(req.params.id), { usuarioId: req.auth.sub });
    require('../../utils/pdf').enviar(res, buffer, `${tipo === 'recepcion' ? 'Recepción' : 'Envío'} ${folio}.pdf`);
  } catch (err) {
    next(err);
  }
}

/** Mínimo en paquetes para varios hilos de un almacén (vista previa o guardar). */
async function minimos(req, res, next) {
  try {
    await _suAlmacen(req, req.body.almacen_id);
    res.json({ data: await service.minimos(req.body), error: null });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  minimos,
  pdfTraspaso,
  traspasoDeSusTiendas,
  listarStock,
  resumenPorAlmacen,
  alertas,
  listarMovimientos,
  registrarMovimiento,
  desarmar,
  previaDesarmeBulto,
  listarConversiones,
  solicitarTraspaso,
  enviarTraspaso,
  guardarEscaneos,
  recibirTraspaso,
  cancelarTraspaso,
  equivalenciaPaquetes,
  detalleHilo,
  bultosDeLote,
  listarTraspasos,
  obtenerTraspaso,
  configurar,
};
