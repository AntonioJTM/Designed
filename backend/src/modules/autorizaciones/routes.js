'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { authRequired, requireTipo, requirePermiso } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const service = require('./service');

// /api/v1/autorizaciones (2026-10-19). Lo ve todo el personal: cada quien sus
// solicitudes y, si autoriza algo, las que le tocan. Quién autoriza qué lo
// decide `service.puedeAutorizar` (hace la operación directo y ve su tienda).

const router = Router();
router.use(authRequired, requireTipo('usuario'), requirePermiso('ver:autorizaciones'));

const VISTAS = ['por_autorizar', 'mias', 'historial'];

router.get('/', async (req, res, next) => {
  try {
    const vista = VISTAS.includes(req.query.vista) ? req.query.vista : 'por_autorizar';
    res.json({ data: await service.listar(req.auth, vista), error: null });
  } catch (err) { next(err); }
});

// `ajustes`: autorizar MENOS de lo pedido (un pedido a otra tienda: los
// paquetes de cada hilo); la operación revisa que no pase de lo pedido.
const aprobarSchema = z.object({ ajustes: z.record(z.string(), z.any()).optional() }).strict();
router.post('/:id/aprobar', validate(aprobarSchema), async (req, res, next) => {
  try {
    res.json({ data: await service.aprobar(Number(req.params.id), req.auth, { ajustes: req.body.ajustes ?? null }), error: null });
  } catch (err) { next(err); }
});

const rechazoSchema = z.object({ motivo: z.string().trim().min(1, 'Escribe por qué se rechaza').max(255) }).strict();
router.post('/:id/rechazar', validate(rechazoSchema), async (req, res, next) => {
  try {
    res.json({ data: await service.rechazar(Number(req.params.id), req.auth, req.body.motivo), error: null });
  } catch (err) { next(err); }
});

router.post('/:id/cancelar', async (req, res, next) => {
  try {
    res.json({ data: await service.cancelar(Number(req.params.id), req.auth), error: null });
  } catch (err) { next(err); }
});

module.exports = router;
