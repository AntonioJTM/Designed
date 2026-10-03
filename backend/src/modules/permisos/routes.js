'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireRol } = require('../../middlewares/auth');

const router = Router();

// Permisos es SOLO del administrador, siempre. Si se pudiera dar como permiso,
// alguien podría darse a sí mismo todo lo demás.
const soloAdmin = [authRequired, requireRol('administrador')];

const guardarSchema = z.object({ claves: z.array(z.string().trim().min(1).max(80)).max(100) }).strict();
const rolSchema = z
  .object({
    nombre: z.string().trim().min(2).max(50),
    descripcion: z.string().trim().max(255).nullable().optional(),
    copiar_de: z.coerce.number().int().positive().nullable().optional(),
  })
  .strict();

router.get('/', ...soloAdmin, controller.matriz);
router.put('/roles/:id', ...soloAdmin, validate(guardarSchema), controller.guardar);
router.post('/roles', ...soloAdmin, validate(rolSchema), controller.crearRol);

module.exports = router;
