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

// producto_id no cambia en update; se toma del registro existente.
const actualizarSchema = crearSchema.partial().omit({ producto_id: true });

const soloStaff = [authRequired, requireTipo('usuario')];

router.get('/', controller.listar); // requiere ?producto_id=
router.get('/:id', controller.obtener);

router.post('/', ...soloStaff, validate(crearSchema), controller.crear);
router.put('/:id', ...soloStaff, validate(actualizarSchema), controller.actualizar);
router.delete('/:id', ...soloStaff, controller.eliminar);

module.exports = router;
