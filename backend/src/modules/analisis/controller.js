'use strict';

const service = require('./service');

const responder = (fn) => async (req, res, next) => {
  try {
    res.json({ data: await fn(req.query), error: null });
  } catch (err) { next(err); }
};

module.exports = {
  tablero: responder(service.tablero),
};
