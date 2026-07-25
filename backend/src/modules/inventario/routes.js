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

// Desarmar paquetes en conos. El peso del paquete y cuántos conos salen ya
// están en la variante cono; aquí solo se dice cuántos paquetes se abren.
const desarmarSchema = z
  .object({
    cono_variante_id: z.coerce.number().int().positive(),
    almacen_origen_id: z.coerce.number().int().positive(),
    almacen_destino_id: z.coerce.number().int().positive(),
    paquetes: z.coerce.number().positive().max(100000),
    // Kilos reales a consumir. Sin este dato se usa paquetes × peso del paquete;
    // sirve cuando el bulto no pesó exactamente lo nominal.
    kg: z.coerce.number().positive().max(1000000).nullable().optional(),
    motivo: z.string().trim().max(255).optional(),
  })
  .strict();

// Traspaso de matriz a sucursal. Cada línea manda `paquetes` (si la variante
// es un paquete) o `cantidad` en la unidad de la variante.
const traspasoSchema = z
  .object({
    almacen_origen_id: z.coerce.number().int().positive(),
    almacen_destino_id: z.coerce.number().int().positive(),
    notas: z.string().trim().max(1000).optional(),
    items: z
      .array(
        z
          .object({
            variante_id: z.coerce.number().int().positive(),
            paquetes: z.coerce.number().positive().max(1000000).optional(),
            cantidad: z.coerce.number().positive().max(1000000).optional(),
          })
          .strict()
      )
      .min(1),
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
// Panorama de qué hay en cada almacén (totales + matriz producto × almacén).
router.get('/resumen', ...soloStaff, controller.resumenPorAlmacen);
router.get('/movimientos', ...soloStaff, controller.listarMovimientos);
router.get('/conversiones', ...soloStaff, controller.listarConversiones);
router.get('/traspasos', ...soloStaff, controller.listarTraspasos);
router.get('/traspasos/:id', ...soloStaff, controller.obtenerTraspaso);

// Escrituras (staff): movimientos, transferencias y configuración de umbrales.
router.post('/movimientos', ...soloStaff, validate(movimientoSchema), controller.registrarMovimiento);
router.post('/transferencias', ...soloStaff, validate(transferenciaSchema), controller.transferir);
router.post('/desarmes', ...soloStaff, validate(desarmarSchema), controller.desarmar);
router.post('/traspasos', ...soloStaff, validate(traspasoSchema), controller.crearTraspaso);
router.put('/configuracion', ...soloStaff, validate(configurarSchema), controller.configurar);

module.exports = router;
