'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requirePermiso } = require('../../middlewares/auth');

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
// Lo decide Permisos (antes: solo administradores).
const soloAdmin = [authRequired, requireTipo('usuario'), requirePermiso('ver:almacenes')];

router.get('/', ...soloStaff, controller.listar);
router.post('/', ...soloAdmin, validate(crearSchema), controller.crear);
router.put('/:id', ...soloAdmin, validate(actualizarSchema), controller.actualizar);
router.delete('/:id', ...soloAdmin, controller.eliminar);

module.exports = router;
