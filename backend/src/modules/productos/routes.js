'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requirePermiso } = require('../../middlewares/auth');

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
    // Precio de lista del hilo por kilo. Las presentaciones que se creen después
    // arrancan con este precio; el que se cobra es el de la variante.
    precio_kg: z.coerce.number().nonnegative().max(99999999).nullable().optional(),
    // Habilita las presentaciones paquete/cono de este producto.
    multipresentacion: z.coerce.boolean().optional(),
    // Habilita etiquetar sus presentaciones por lote.
    por_lotes: z.coerce.boolean().optional(),
    destacado: z.coerce.boolean().optional(),
    activo: z.coerce.boolean().optional(),
  })
  .strict();

const actualizarSchema = crearSchema.partial();

// Dar de alta o cambiar el catálogo es de quien tenga "Productos y Materiales".
const soloStaff = [authRequired, requireTipo('usuario'), requirePermiso('ver:catalogo')];

router.get('/', controller.listar);
router.get('/:id', controller.obtener);

router.post('/', ...soloStaff, validate(crearSchema), controller.crear);
router.put('/:id', ...soloStaff, validate(actualizarSchema), controller.actualizar);
router.get('/:id/eliminacion', ...soloStaff, controller.eliminacion);
router.delete('/:id', ...soloStaff, controller.eliminar);

module.exports = router;
