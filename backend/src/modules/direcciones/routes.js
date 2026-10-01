'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo } = require('../../middlewares/auth');

const router = Router();

// Lo que de verdad hace falta para que llegue un paquete: calle, ciudad,
// estado y código postal. Lo demás ayuda pero no se exige.
const crearSchema = z
  .object({
    tipo: z.enum(['envio', 'facturacion']).optional(),
    nombre_receptor: z.string().trim().max(120).nullable().optional(),
    calle: z.string().trim().min(1).max(160),
    numero_ext: z.string().trim().max(20).nullable().optional(),
    numero_int: z.string().trim().max(20).nullable().optional(),
    colonia: z.string().trim().max(100).nullable().optional(),
    ciudad: z.string().trim().min(1).max(100),
    estado: z.string().trim().min(1).max(100),
    codigo_postal: z.string().trim().min(1).max(15),
    pais: z.string().trim().max(60).optional(),
    telefono: z.string().trim().max(20).nullable().optional(),
    referencias: z.string().trim().max(255).nullable().optional(),
    es_predeterminada: z.coerce.boolean().optional(),
  })
  .strict();

const actualizarSchema = crearSchema.partial();

// Son del cliente y solo del cliente: el staff no las administra desde aquí.
const soloCliente = [authRequired, requireTipo('cliente')];

router.get('/', ...soloCliente, controller.listar);
router.get('/:id', ...soloCliente, controller.obtener);
router.post('/', ...soloCliente, validate(crearSchema), controller.crear);
router.put('/:id', ...soloCliente, validate(actualizarSchema), controller.actualizar);
router.delete('/:id', ...soloCliente, controller.eliminar);

module.exports = router;
