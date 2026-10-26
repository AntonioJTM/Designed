'use strict';

const { AppError } = require('../../middlewares/error');
const service = require('./service');
const anteriores = require('./anteriores');

/** Un id de la consulta (?almacen_id=3), o null. */
const idDe = (v) => (v == null || v === '' ? null : Number(v));

const responder = (fn) => async (req, res, next) => {
  try {
    res.json({ data: await fn(req), error: null });
  } catch (err) {
    next(err);
  }
};

const resumen = responder((req) => service.resumen({ almacenId: idDe(req.query.almacen_id), productoId: idDe(req.query.producto_id) }));
const temporadas = responder((req) => service.temporadas({ almacenId: idDe(req.query.almacen_id), anio: req.query.anio || null }));
const hilo = responder((req) => service.hilo(idDe(req.params.productoId)));
const quePedir = responder(() => service.quePedir());
const ajustes = responder(() => service.ajustes());
const guardarAjustes = responder((req) => service.guardarAjustes(req.body));

/** El CSV para el proveedor: ?hilos=1,2,3. */
async function quePedirCsv(req, res, next) {
  try {
    const ids = String(req.query.hilos ?? '').split(',').map((x) => Number(x)).filter((x) => x > 0);
    if (!ids.length) throw new AppError(422, 'SIN_HILOS', 'Elige qué hilos van en el pedido.');
    const csv = await service.quePedirCsv(ids);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pedido-al-proveedor.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

/** El archivo de ventas anteriores llega en crudo (como la lista del proveedor). */
const archivo = (req) => {
  if (!req.body || !req.body.length) throw new AppError(422, 'ARCHIVO_REQUERIDO', 'Sube el Excel con las ventas de años anteriores.');
  return req.body;
};
const anterioresResumen = responder(() => anteriores.resumen());
const anterioresPrevia = responder((req) => anteriores.previa(archivo(req)));
const anterioresCargar = responder((req) => anteriores.confirmar(archivo(req), req.auth?.sub));
const anterioresBorrar = responder(() => anteriores.borrar());

module.exports = {
  resumen, temporadas, hilo, quePedir, quePedirCsv, ajustes, guardarAjustes,
  anterioresResumen, anterioresPrevia, anterioresCargar, anterioresBorrar,
};
