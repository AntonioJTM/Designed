'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requireRol } = require('../../middlewares/auth');

const router = Router();

const loginSchema = z
  .object({
    correo: z.string().trim().toLowerCase().email().max(160),
    contrasena: z.string().min(1).max(72),
  })
  .strict();

const crearSchema = z
  .object({
    rol_id: z.coerce.number().int().positive(),
    nombre: z.string().trim().min(2).max(120),
    correo: z.string().trim().toLowerCase().email().max(160),
    telefono: z.string().trim().max(20).optional(),
    contrasena: z.string().min(8).max(72),
  })
  .strict();

const actualizarSchema = z
  .object({
    rol_id: z.coerce.number().int().positive().optional(),
    nombre: z.string().trim().min(2).max(120).optional(),
    telefono: z.string().trim().max(20).nullable().optional(),
    activo: z.coerce.boolean().optional(),
    contrasena: z.string().min(8).max(72).optional(),
  })
  .strict();

// El alta de staff es exclusiva de administradores (ya no hay registro público).
const soloAdmin = [authRequired, requireRol('administrador')];

// Sesión propia
router.post('/login', validate(loginSchema), controller.iniciarSesion);
router.get('/perfil', authRequired, requireTipo('usuario'), controller.perfil);

// Catálogo de roles (para el formulario del panel)
router.get('/roles', ...soloAdmin, controller.roles);

// Gestión de personal (solo administradores)
router.get('/', ...soloAdmin, controller.listar);
router.post('/', ...soloAdmin, validate(crearSchema), controller.crear);
router.put('/:id', ...soloAdmin, validate(actualizarSchema), controller.actualizar);

module.exports = router;
