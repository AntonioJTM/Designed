'use strict';

const { Router } = require('express');
const controller = require('./controller');

// Catálogos auxiliares de solo lectura (públicos).
const router = Router();

router.get('/lineas', controller.lineas);
router.get('/colores', controller.colores);
router.get('/unidades', controller.unidades);
router.get('/impuestos', controller.impuestos);
router.get('/metodos-pago', controller.metodosPago);

module.exports = router;
