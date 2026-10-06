'use strict';

const service = require('./service');
const lista = require('./lista');
const reportes = require('./reportes');
const permisos = require('../permisos/service');
const { parsePagination } = require('../../utils/query');
const { AppError } = require('../../middlewares/error');

/**
 * Lee el archivo y devuelve la vista previa sin tocar la base.
 * El cuerpo llega como bytes crudos del .xlsx (ver routes.js).
 */
async function previa(req, res, next) {
  try {
    if (!req.body || !req.body.length) {
      throw new AppError(422, 'ARCHIVO_REQUERIDO', 'Sube el archivo de la lista de empaque');
    }
    const nombre = req.get('X-Nombre-Archivo') || null;
    res.json({ data: await service.previa(req.body, nombre), error: null });
  } catch (err) {
    next(err);
  }
}

/** Vista previa de la lista completa del proveedor (varios hilos). */
async function previaLista(req, res, next) {
  try {
    if (!req.body || !req.body.length) {
      throw new AppError(422, 'ARCHIVO_REQUERIDO', 'Sube el archivo del inventario del proveedor');
    }
    const nombre = req.get('X-Nombre-Archivo') || null;
    res.json({ data: await lista.previaLista(req.body, nombre), error: null });
  } catch (err) {
    next(err);
  }
}

/**
 * Carga la lista completa. Con `?progreso=1` (la pantalla) la respuesta llega
 * POR PARTES, un JSON por renglón (NDJSON): qué hilo se está creando, cuántos
 * bultos van… y al final `{ tipo: 'fin', data }` o `{ tipo: 'error', error }`.
 * Así la pantalla dice qué está haciendo en vez de un "Cargando…" mudo. Sin el
 * parámetro contesta un JSON normal, como cualquier otra ruta.
 *
 * Los errores de validación (zod) salen antes, como siempre: con 422 y JSON.
 */
/**
 * El costo por kilo es solo de quien ve costos (administrador y contabilidad):
 * si alguien más lo manda, 403 y no se carga nada. La pantalla ni lo enseña.
 */
async function _exigirCostoSiLoMandan(req, costos) {
  if (!costos.some((c) => c != null)) return;
  if (!(await permisos.veCostos(req))) {
    throw new AppError(403, 'SIN_PERMISO', 'El costo por kilo solo lo capturan administración y contabilidad.');
  }
}

async function confirmarLista(req, res, next) {
  try {
    await _exigirCostoSiLoMandan(req, (req.body.hilos ?? []).map((h) => h.costo_kg));
  } catch (err) {
    return next(err);
  }
  if (req.query.progreso !== '1') {
    try {
      res.status(201).json({ data: await lista.confirmarLista(req.body, req.auth.sub), error: null });
    } catch (err) {
      next(err);
    }
    return;
  }

  res.status(200).set({
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    // Que nginx no junte las partes hasta el final: se perdería el avance.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const escribir = (evento) => res.write(`${JSON.stringify(evento)}\n`);
  try {
    const data = await lista.confirmarLista(req.body, req.auth.sub, escribir);
    escribir({ tipo: 'fin', data });
  } catch (err) {
    // La transacción ya se revirtió: no quedó nada a medias.
    if (!(err instanceof AppError)) console.error('[remesas/lista]', err);
    escribir({
      tipo: 'error',
      status: err instanceof AppError ? err.status : 500,
      error: {
        code: err instanceof AppError ? err.code : 'ERROR_INTERNO',
        message: err instanceof AppError
          ? err.message
          : 'No se pudo cargar la lista y no se guardó nada. Vuelve a intentarlo.',
      },
    });
  }
  res.end();
}

async function confirmar(req, res, next) {
  try {
    await _exigirCostoSiLoMandan(req, [req.body.costo_kg]);
    res.status(201).json({ data: await service.confirmar(req.body, req.auth.sub), error: null });
  } catch (err) {
    next(err);
  }
}

/** Completar o corregir proveedor, factura, pedimento, contenedor, fecha y costo. */
async function editarDatos(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new AppError(404, 'NO_ENCONTRADO', 'Esa carga no existe');
    if (req.body.costo_kg !== undefined) {
      if (!(await permisos.veCostos(req))) {
        throw new AppError(403, 'SIN_PERMISO', 'El costo por kilo solo lo capturan administración y contabilidad.');
      }
    }
    const data = await service.editarDatos(id, req.body, req.auth.sub);
    res.json({ data: await _sinCostoSiNoVe(req, data), error: null });
  } catch (err) {
    next(err);
  }
}

/** El historial no enseña el costo a quien no lo ve: tampoco lo manda. */
async function _sinCostoSiNoVe(req, filas) {
  if (await permisos.veCostos(req)) return filas;
  for (const f of [].concat(filas ?? [])) if (f && typeof f === 'object') delete f.costo_kg;
  return filas;
}

async function listar(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const data = await service.listar({
      variante_id: req.query.variante_id ? Number(req.query.variante_id) : null,
      // Las cargas de un hilo (todas sus presentaciones): para su reporte.
      producto_id: req.query.producto_id ? Number(req.query.producto_id) : null,
      proveedor_id: req.query.proveedor_id ? Number(req.query.proveedor_id) : null,
      page,
      limit,
      offset,
    });
    await _sinCostoSiNoVe(req, data.items);
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
}

/** Manda un PDF. El nombre del archivo lo pone la pantalla al guardarlo. */
function enviarPdf(res, buffer, nombre) {
  const ascii = nombre.normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/["\\/]/g, '-');
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': buffer.length,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    'Cache-Control': 'no-store',
  });
  res.send(buffer);
}

/** Fechas tecleadas en un <input type="date">: lo que no tenga forma de fecha se ignora. */
const fecha = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** El comprobante de una carga. El precio de compra, solo a quien ve costos. */
async function pdfCarga(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new AppError(404, 'NO_ENCONTRADO', 'Esa carga no existe');
    const { buffer, folio } = await reportes.pdfCarga(id, {
      usuarioId: req.auth.sub,
      veCostos: await permisos.veCostos(req),
    });
    enviarPdf(res, buffer, `Carga ${folio}.pdf`);
  } catch (err) {
    next(err);
  }
}

/** Varias cargas en un PDF: el resumen de la lista y luego cada hilo con sus bultos. */
async function pdfCargas(req, res, next) {
  try {
    const ids = [...new Set(String(req.query.ids ?? '').split(',').map(Number))]
      .filter((x) => Number.isInteger(x) && x > 0);
    if (!ids.length || ids.length > 200) {
      throw new AppError(422, 'IDS_INVALIDOS', 'Indica de qué cargas es el reporte (?ids=1,2,3)');
    }
    const { buffer, nombre } = await reportes.pdfCargas(ids, {
      usuarioId: req.auth.sub,
      veCostos: await permisos.veCostos(req),
    });
    enviarPdf(res, buffer, nombre);
  } catch (err) {
    next(err);
  }
}

/** Todas las entradas de un hilo, con periodo opcional (?desde=&hasta=). */
async function pdfProducto(req, res, next) {
  try {
    const id = Number(req.params.productoId);
    if (!Number.isInteger(id) || id <= 0) throw new AppError(404, 'NO_ENCONTRADO', 'Ese producto no existe');
    const { buffer, hilo } = await reportes.pdfProducto(id, {
      usuarioId: req.auth.sub,
      veCostos: await permisos.veCostos(req),
      desde: fecha(req.query.desde),
      hasta: fecha(req.query.hasta),
    });
    enviarPdf(res, buffer, `Entradas ${hilo.replace(/\//g, '-')}.pdf`);
  } catch (err) {
    next(err);
  }
}

module.exports = { previa, confirmar, previaLista, confirmarLista, listar, editarDatos, pdfCarga, pdfCargas, pdfProducto };
