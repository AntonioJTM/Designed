'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requireRol } = require('../../middlewares/auth');

const router = Router();
const soloStaff = [authRequired, requireTipo('usuario')];

const cajaSchema = z
  .object({
    almacen_id: z.coerce.number().int().positive(),
    nombre: z.string().trim().min(1).max(60),
    activo: z.coerce.boolean().optional(),
  })
  .strict();

const actualizarCajaSchema = cajaSchema.partial();

const abrirSchema = z
  .object({
    caja_id: z.coerce.number().int().positive(),
    monto_inicial: z.coerce.number().nonnegative().optional(),
  })
  .strict();

const movimientoSchema = z
  .object({
    tipo: z.enum(['ingreso', 'retiro']),
    monto: z.coerce.number().positive(),
    motivo: z.string().trim().max(255).optional(),
  })
  .strict();

const cerrarSchema = z.object({ monto_final: z.coerce.number().nonnegative() }).strict();

// Todo el módulo es de staff.
router.use(...soloStaff);

// Cualquier cajero necesita ver las cajas para abrir su turno, pero darlas de
// alta o modificarlas es configuración: solo administradores.
const soloAdmin = requireRol('administrador');

router.get('/cajas', controller.listarCajas);
router.post('/cajas', soloAdmin, validate(cajaSchema), controller.crearCaja);
router.put('/cajas/:id', soloAdmin, validate(actualizarCajaSchema), controller.actualizarCaja);
router.delete('/cajas/:id', soloAdmin, controller.eliminarCaja);

router.post('/sesiones', validate(abrirSchema), controller.abrirSesion);
router.get('/sesiones/abierta', controller.sesionAbierta); // ?caja_id=
router.get('/sesiones/:id', controller.obtenerSesion);
router.post('/sesiones/:id/movimientos', validate(movimientoSchema), controller.registrarMovimiento);
router.post('/sesiones/:id/cerrar', validate(cerrarSchema), controller.cerrarSesion);

module.exports = router;
