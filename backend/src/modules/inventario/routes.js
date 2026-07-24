'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo } = require('../../middlewares/auth');

const router = Router();
const soloStaff = [authRequired, requireTipo('usuario')];

const movimientoSchema = z
  .object({
    variante_id: z.coerce.number().int().positive(),
    almacen_id: z.coerce.number().int().positive(),
    tipo: z.enum(['entrada', 'salida', 'ajuste', 'devolucion', 'merma']),
    cantidad: z.coerce.number().nonnegative(),
    costo_unitario: z.coerce.number().nonnegative().nullable().optional(),
    referencia_tipo: z.string().trim().max(30).optional(),
    referencia_id: z.coerce.number().int().positive().nullable().optional(),
    motivo: z.string().trim().max(255).optional(),
  })
  .strict();

const transferenciaSchema = z
  .object({
    variante_id: z.coerce.number().int().positive(),
    almacen_origen_id: z.coerce.number().int().positive(),
    almacen_destino_id: z.coerce.number().int().positive(),
    cantidad: z.coerce.number().positive(),
    costo_unitario: z.coerce.number().nonnegative().nullable().optional(),
    motivo: z.string().trim().max(255).optional(),
  })
  .strict();

const configurarSchema = z
  .object({
    variante_id: z.coerce.number().int().positive(),
    almacen_id: z.coerce.number().int().positive(),
    stock_minimo: z.coerce.number().nonnegative().optional(),
    stock_maximo: z.coerce.number().nonnegative().nullable().optional(),
    ubicacion_fisica: z.string().trim().max(60).optional(),
  })
  .strict();

// Lecturas (staff): existencias, alertas y kardex.
router.get('/', ...soloStaff, controller.listarStock);
router.get('/alertas', ...soloStaff, controller.alertas);
router.get('/movimientos', ...soloStaff, controller.listarMovimientos);

// Escrituras (staff): movimientos, transferencias y configuración de umbrales.
router.post('/movimientos', ...soloStaff, validate(movimientoSchema), controller.registrarMovimiento);
router.post('/transferencias', ...soloStaff, validate(transferenciaSchema), controller.transferir);
router.put('/configuracion', ...soloStaff, validate(configurarSchema), controller.configurar);

module.exports = router;
