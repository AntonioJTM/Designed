'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo } = require('../../middlewares/auth');

const router = Router();

const crearSchema = z
  .object({
    nombre: z.string().trim().min(1).max(100),
    direccion: z.string().trim().max(255).optional(),
    es_punto_venta: z.coerce.boolean().optional(),
    activo: z.coerce.boolean().optional(),
  })
  .strict();

const actualizarSchema = crearSchema.partial();
const soloStaff = [authRequired, requireTipo('usuario')];

router.get('/', controller.listar);
router.get('/:id', controller.obtener);
router.post('/', ...soloStaff, validate(crearSchema), controller.crear);
router.put('/:id', ...soloStaff, validate(actualizarSchema), controller.actualizar);

module.exports = router;
