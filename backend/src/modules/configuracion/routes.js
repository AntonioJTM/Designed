'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requireRol } = require('../../middlewares/auth');

const router = Router();

// Cada clave llega como texto o null; el service valida las que son números.
// No es `.strict()` con una lista fija a propósito: las claves las define la
// migración y el service rechaza las que no existan, así que agregar una opción
// nueva es una línea de SQL y no tocar este archivo.
const guardarSchema = z.record(
  z.string().trim().max(60),
  z.string().trim().max(500).nullable()
);

const soloAdmin = [authRequired, requireTipo('usuario'), requireRol('administrador')];

// Lo que la tienda necesita para pintar el checkout: tarifa de envío, datos
// para depositar, dónde recoger. Público: lo lee un visitante sin cuenta.
router.get('/', controller.publica);

// El formulario del panel, con descripciones y claves internas.
router.get('/completa', ...soloAdmin, controller.completa);
router.put('/', ...soloAdmin, validate(guardarSchema), controller.guardar);

module.exports = router;
