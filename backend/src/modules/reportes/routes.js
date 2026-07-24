'use strict';

const { Router } = require('express');
const controller = require('./controller');
const { authRequired, requireTipo } = require('../../middlewares/auth');

const router = Router();

// Reportes: solo staff.
router.use(authRequired, requireTipo('usuario'));

router.get('/ventas', controller.ventas); // ?desde=&hasta= (por defecto hoy)
router.get('/mas-vendidos', controller.masVendidos); // ?limite=
router.get('/por-reabastecer', controller.porReabastecer);
router.get('/cortes-caja', controller.cortesCaja); // ?desde=&hasta=

module.exports = router;
