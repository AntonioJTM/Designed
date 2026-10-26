'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requirePermiso, requireTodasLasTiendas } = require('../../middlewares/auth');

const router = Router();

const crearSchema = z
  .object({
    nombre: z.string().trim().min(1).max(60),
    orden: z.coerce.number().int().min(0).max(999).optional(),
    activo: z.coerce.boolean().optional(),
  })
  .strict();

const actualizarSchema = crearSchema.partial();

// Los cajeros necesitan la lista para elegir con qué precio cobrar; definirla
// es configuración de administrador.
const soloStaff = [authRequired, requireTipo('usuario')];
// Lo decide Permisos (antes: solo administradores). Y solo quien ve TODAS las
// tiendas, como Almacenes (2026-10-22, revisor de tiendas): la pantalla ya se le
// escondía a quien es de una sola, pero el servidor lo dejaba cambiar o borrar la
// lista con la que cobran todas las tiendas.
const soloAdmin = [authRequired, requireTipo('usuario'), requirePermiso('ver:almacenes'), requireTodasLasTiendas];

router.get('/', ...soloStaff, controller.listar);
router.post('/', ...soloAdmin, validate(crearSchema), controller.crear);
router.put('/:id', ...soloAdmin, validate(actualizarSchema), controller.actualizar);
router.delete('/:id', ...soloAdmin, controller.eliminar);

module.exports = router;
