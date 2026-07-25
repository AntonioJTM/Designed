'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requireRol } = require('../../middlewares/auth');

const router = Router();

const crearSchema = z
  .object({
    nombre: z.string().trim().min(1).max(60),
    orden: z.coerce.number().int().min(0).max(999).optional(),
    activo: z.coerce.boolean().optional(),
  })
  .strict();

const actualizarSchema = crearSchema.partial();

// Los cajeros necesitan la lista para elegir con qué precio cobrar; definirla
// es configuración de administrador.
const soloStaff = [authRequired, requireTipo('usuario')];
const soloAdmin = [authRequired, requireTipo('usuario'), requireRol('administrador')];

router.get('/', ...soloStaff, controller.listar);
router.get('/:id', ...soloStaff, controller.obtener);
router.post('/', ...soloAdmin, validate(crearSchema), controller.crear);
router.put('/:id', ...soloAdmin, validate(actualizarSchema), controller.actualizar);
router.delete('/:id', ...soloAdmin, controller.eliminar);

module.exports = router;
