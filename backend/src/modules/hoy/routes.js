'use strict';

const { Router } = require('express');
const model = require('./model');
const { authRequired, requireTipo, requirePermiso } = require('../../middlewares/auth');

const router = Router();

router.get('/', authRequired, requireTipo('usuario'), requirePermiso('ver:hoy'), async (req, res, next) => {
  try {
    res.json({ data: await model.resumen(), error: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
