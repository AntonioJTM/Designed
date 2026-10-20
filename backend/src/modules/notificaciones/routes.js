'use strict';

const { Router } = require('express');
const model = require('./model');
const { authRequired, requireTipo } = require('../../middlewares/auth');
const { almacenesDe, puede } = require('../permisos/service');
const autorizaciones = require('../autorizaciones/service');

const router = Router();

/**
 * La campana del panel: lo que está esperando a alguien. Cualquiera del staff la
 * ve, porque cualquiera puede surtir o firmar de recibido.
 */
router.get('/', authRequired, requireTipo('usuario'), async (req, res, next) => {
  try {
    const data = await model.pendientes(await almacenesDe(req.auth));
    // Las solicitudes que esperan SU autorización (2026-10-19): un aviso.
    // Si falla (p. ej. falta la migración) la campana sigue funcionando sin este aviso.
    const porAutorizar = (await puede(req.auth, 'ver:autorizaciones'))
      ? await autorizaciones.cuantasPorAutorizar(req.auth).catch(() => 0)
      : 0;
    data.autorizaciones = { num: porAutorizar };
    if (porAutorizar > 0) data.total += 1;
    // Su clave para autorizar se apagó por equivocadas: solo la vuelve a poner él.
    data.mi_clave_apagada = await require('../usuarios/service').claveApagada(req.auth.sub).catch(() => null);
    if (data.mi_clave_apagada) data.total += 1;
    res.json({ data, error: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
