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
    descripcion: z.string().trim().optional(),
    // Calibres válidos de este material, separados por coma: "1/30,2/30".
    calibres: z.string().trim().max(255).nullable().optional(),
    imagen_url: z.string().trim().max(255).optional(),
    orden: z.coerce.number().int().optional(),
    activo: z.coerce.boolean().optional(),
  })
  .strict();

const actualizarSchema = crearSchema.partial();

// Escritura: solo staff autenticado.
const soloStaff = [authRequired, requireTipo('usuario')];

// Lecturas públicas (catálogo).
router.get('/', controller.listar);
router.get('/:id', controller.obtener);

// Escrituras protegidas.
router.post('/', ...soloStaff, validate(crearSchema), controller.crear);
router.put('/:id', ...soloStaff, validate(actualizarSchema), controller.actualizar);
router.delete('/:id', ...soloStaff, controller.eliminar);

module.exports = router;
