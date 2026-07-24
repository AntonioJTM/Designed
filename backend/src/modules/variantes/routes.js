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
    color_id: z.coerce.number().int().positive().nullable().optional(),
    sku: z.string().trim().min(1).max(60),
    codigo_barras: z.string().trim().max(60).nullable().optional(),
    presentacion: z.string().trim().max(40).optional(),
    precio: z.coerce.number().nonnegative(),
    precio_oferta: z.coerce.number().nonnegative().nullable().optional(),
    costo: z.coerce.number().nonnegative().nullable().optional(),
    activo: z.coerce.boolean().optional(),
  })
  .strict();

// En update no se permite cambiar producto_id (la variante pertenece a su producto).
const actualizarSchema = crearSchema.partial().omit({ producto_id: true });

const codigoSchema = z
  .object({
    codigo: z.string().trim().min(1).max(60),
    etiqueta: z.string().trim().max(60).optional(),
  })
  .strict();

const soloStaff = [authRequired, requireTipo('usuario')];

router.get('/', controller.listar);
router.get('/:id', controller.obtener);

router.post('/', ...soloStaff, validate(crearSchema), controller.crear);
router.put('/:id', ...soloStaff, validate(actualizarSchema), controller.actualizar);
router.delete('/:id', ...soloStaff, controller.eliminar);

// Códigos de barras adicionales de una variante
router.get('/:id/codigos', controller.listarCodigos);
router.post('/:id/codigos', ...soloStaff, validate(codigoSchema), controller.agregarCodigo);
router.delete('/codigos/:codigoId', ...soloStaff, controller.eliminarCodigo);

module.exports = router;
