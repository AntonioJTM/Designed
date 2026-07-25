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
    // Línea de procedencia: turco, nacional, chino.
    linea_id: z.coerce.number().int().positive().nullable().optional(),
    unidad_medida_id: z.coerce.number().int().positive(),
    impuesto_id: z.coerce.number().int().positive().nullable().optional(),
    nombre: z.string().trim().min(1).max(160),
    descripcion: z.string().trim().optional(),
    grosor_calibre: z.string().trim().max(30).optional(),
    // Habilita las presentaciones paquete/cono de este producto.
    multipresentacion: z.coerce.boolean().optional(),
    // Habilita etiquetar sus presentaciones por lote.
    por_lotes: z.coerce.boolean().optional(),
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
