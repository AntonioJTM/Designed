'use strict';

const service = require('./service');

async function ventas(req, res, next) {
  try {
    res.json({ data: await service.ventas(req.query.desde, req.query.hasta), error: null });
  } catch (err) { next(err); }
}

async function masVendidos(req, res, next) {
  try {
    const limite = req.query.limite ? Number(req.query.limite) : 10;
    res.json({ data: await service.masVendidos(limite), error: null });
  } catch (err) { next(err); }
}

async function porReabastecer(req, res, next) {
  try {
    res.json({ data: await service.porReabastecer(), error: null });
  } catch (err) { next(err); }
}

async function cortesCaja(req, res, next) {
  try {
    res.json({ data: await service.cortesCaja(req.query.desde, req.query.hasta), error: null });
  } catch (err) { next(err); }
}

module.exports = { ventas, masVendidos, porReabastecer, cortesCaja };
