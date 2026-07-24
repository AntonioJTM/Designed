'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo } = require('../../middlewares/auth');

const router = Router();

const crearSchema = z
  .object({
    categoria_id: z.coerce.number().int().positive(),
    marca_id: z.coerce.number().int().positive().nullable().optional(),
    material_id: z.coerce.number().int().positive().nullable().optional(),
    unidad_medida_id: z.coerce.number().int().positive(),
    impuesto_id: z.coerce.number().int().positive().nullable().optional(),
    nombre: z.string().trim().min(1).max(160),
    slug: z.string().trim().max(180).optional(),
    descripcion: z.string().trim().optional(),
    grosor_calibre: z.string().trim().max(30).optional(),
    peso_gramos: z.coerce.number().nonnegative().nullable().optional(),
    longitud_metros: z.coerce.number().nonnegative().nullable().optional(),
    destacado: z.coerce.boolean().optional(),
    activo: z.coerce.boolean().optional(),
  })
  .strict();

const actualizarSchema = crearSchema.partial();

const soloStaff = [authRequired, requireTipo('usuario')];

router.get('/', controller.listar);
router.get('/:id', controller.obtener);

router.post('/', ...soloStaff, validate(crearSchema), controller.crear);
router.put('/:id', ...soloStaff, validate(actualizarSchema), controller.actualizar);
router.delete('/:id', ...soloStaff, controller.eliminar);

module.exports = router;
