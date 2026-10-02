'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo } = require('../../middlewares/auth');

const router = Router();

const crearSchema = z
  .object({
    producto_id: z.coerce.number().int().positive(),
    variante_id: z.coerce.number().int().positive().nullable().optional(),
    url: z.string().trim().min(1).max(255),
    es_principal: z.coerce.boolean().optional(),
    orden: z.coerce.number().int().optional(),
  })
  .strict();

const soloStaff = [authRequired, requireTipo('usuario')];

// Las imágenes se LEEN dentro de GET /productos/:id; aquí solo se agregan y se quitan.
router.post('/', ...soloStaff, validate(crearSchema), controller.crear);
router.delete('/:id', ...soloStaff, controller.eliminar);

module.exports = router;
