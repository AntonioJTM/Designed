'use strict';

const service = require('./service');
const { parsePagination, parseBool } = require('../../utils/query');

async function listarStock(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listarStock({
      almacen_id: req.query.almacen_id ? Number(req.query.almacen_id) : undefined,
      variante_id: req.query.variante_id ? Number(req.query.variante_id) : undefined,
      q: req.query.q,
      bajo_stock: parseBool(req.query.bajo_stock),
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
    res.json({ data: await service.resumenPorAlmacen(), error: null });
  } catch (err) {
    next(err);
  }
}

async function alertas(req, res, next) {
  try {
    const data = await service.alertas();
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function listarMovimientos(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listarMovimientos({
      variante_id: req.query.variante_id ? Number(req.query.variante_id) : undefined,
      almacen_id: req.query.almacen_id ? Number(req.query.almacen_id) : undefined,
      tipo: req.query.tipo,
      // Agrupación en lenguaje de tienda: ventas, traspasos, desarmes…
      concepto: req.query.concepto,
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
    const data = await service.registrarMovimiento(req.body, req.auth.sub);
    res.status(201).json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

/** Qué trae el bulto escaneado: paquete, kilos, conos y dónde hay existencias. */
async function previaDesarmeBulto(req, res, next) {
  try {
    const data = await service.previaDesarmeBulto(req.params.codigo);
    return res.json({ data, error: null });
  } catch (err) {
    return next(err);
  }
}

async function desarmar(req, res, next) {
  try {
    const data = await service.desarmar(req.body, req.auth.sub);
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
    });
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

/** Cuántos paquetes son X kilos, con los pesos reales de la bodega. */
async function equivalenciaPaquetes(req, res, next) {
  try {
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
    const data = await service.solicitarTraspaso(req.body, req.auth.sub);
    res.status(201).json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function enviarTraspaso(req, res, next) {
  try {
    const data = await service.enviarTraspaso(Number(req.params.id), req.auth.sub);
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

async function recibirTraspaso(req, res, next) {
  try {
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
    const data = await service.configurar(req.body);
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

module.exports = {
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
  recibirTraspaso,
  cancelarTraspaso,
  equivalenciaPaquetes,
  listarTraspasos,
  obtenerTraspaso,
  configurar,
};
