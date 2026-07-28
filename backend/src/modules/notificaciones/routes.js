'use strict';

const { Router } = require('express');
const model = require('./model');
const { authRequired, requireTipo } = require('../../middlewares/auth');

const router = Router();

/**
 * La campana del panel: lo que está esperando a alguien. Cualquiera del staff la
 * ve, porque cualquiera puede surtir o firmar de recibido.
 */
router.get('/', authRequired, requireTipo('usuario'), async (req, res, next) => {
  try {
    res.json({ data: await model.pendientes(), error: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
