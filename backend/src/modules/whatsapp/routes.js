'use strict';

const express = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requirePermiso } = require('../../middlewares/auth');

/**
 * El WhatsApp de la tienda (2026-10-16): enlazarlo con el QR es de quien entra a
 * Configuración («ver:config»); mandar un ticket, de cualquiera del personal que
 * pueda imprimirlo.
 */
const router = express.Router();

const soloStaff = [authRequired, requireTipo('usuario')];
const soloConfig = [authRequired, requireTipo('usuario'), requirePermiso('ver:config')];
const pdfEnCrudo = express.raw({ type: () => true, limit: '8mb' });

// El QR cambia cada ~20 s y el estado cambia solo: que nadie lo guarde en caché.
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/estado', ...soloStaff, controller.estado);
router.get('/enlace', ...soloConfig, controller.enlace);
router.post('/enlazar', ...soloConfig, controller.enlazar);
router.post('/desenlazar', ...soloConfig, controller.desenlazar);
router.post('/prueba', ...soloConfig, validate(z.object({ telefono: z.string().trim().min(1).max(30) })), controller.prueba);
router.post('/enviar', ...soloStaff, pdfEnCrudo, controller.enviar);

module.exports = router;
