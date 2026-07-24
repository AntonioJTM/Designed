'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo } = require('../../middlewares/auth');

const router = Router();

const registroSchema = z
  .object({
    nombre: z.string().trim().min(2).max(120),
    correo: z.string().trim().toLowerCase().email().max(160),
    telefono: z.string().trim().max(20).optional(),
    contrasena: z.string().min(8).max(72), // bcrypt trunca a 72 bytes
    acepta_marketing: z.coerce.boolean().optional().default(false),
  })
  .strict();

const loginSchema = z
  .object({
    correo: z.string().trim().toLowerCase().email().max(160),
    contrasena: z.string().min(1).max(72),
  })
  .strict();

// POST /api/v1/clientes/registro  → alta de cuenta de cliente
router.post('/registro', validate(registroSchema), controller.registrar);

// POST /api/v1/clientes/login  → inicio de sesión de cliente
router.post('/login', validate(loginSchema), controller.iniciarSesion);

// GET /api/v1/clientes/perfil  → perfil del cliente autenticado
router.get('/perfil', authRequired, requireTipo('cliente'), controller.perfil);

module.exports = router;
