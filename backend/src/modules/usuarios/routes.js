'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requirePermiso } = require('../../middlewares/auth');

const router = Router();

const loginSchema = z
  .object({
    correo: z.string().trim().toLowerCase().email().max(160),
    contrasena: z.string().min(1).max(72),
  })
  .strict();

// Correo y contraseña son obligatorios para quien ENTRA al sistema y no se
// mandan para un puesto que no entra (el cargador): eso lo revisa el servicio,
// que es el que sabe de qué puesto se trata.
const crearSchema = z
  .object({
    rol_id: z.coerce.number().int().positive(),
    nombre: z.string().trim().min(2).max(120),
    correo: z.string().trim().toLowerCase().email().max(160).optional(),
    telefono: z.string().trim().max(20).optional(),
    contrasena: z.string().min(8).max(72).optional(),
    // Sus DEMÁS puestos (el principal es rol_id). Puede lo de todos.
    otros_roles: z.array(z.coerce.number().int().positive()).max(30).optional(),
  })
  .strict();

const actualizarSchema = z
  .object({
    rol_id: z.coerce.number().int().positive().optional(),
    nombre: z.string().trim().min(2).max(120).optional(),
    telefono: z.string().trim().max(20).nullable().optional(),
    activo: z.coerce.boolean().optional(),
    // Solo para quien NO entraba (un cargador) y pasa a un puesto que sí entra:
    // el correo de quien ya entra no se cambia.
    correo: z.string().trim().toLowerCase().email().max(160).optional(),
    contrasena: z.string().min(8).max(72).optional(),
    otros_roles: z.array(z.coerce.number().int().positive()).max(30).optional(),
  })
  .strict();

// El alta de staff es exclusiva de administradores (ya no hay registro público).
const soloAdmin = [authRequired, requireTipo('usuario'), requirePermiso('ver:personal')];

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
