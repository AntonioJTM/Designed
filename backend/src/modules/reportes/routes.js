'use strict';

const { Router } = require('express');
const controller = require('./controller');
const { authRequired, requireTipo, requirePermiso, requireTodasLasTiendas } = require('../../middlewares/auth');

const router = Router();

// Reportes: quien tiene la pantalla y ve TODAS las tiendas (2026-10-15: suman
// las dos tiendas; "eso solo lo ve el administrador").
router.use(authRequired, requireTipo('usuario'), requirePermiso('ver:reportes'), requireTodasLasTiendas);

router.get('/ventas', controller.ventas); // ?desde=&hasta= (por defecto hoy)
router.get('/mas-vendidos', controller.masVendidos); // ?limite=
router.get('/por-reabastecer', controller.porReabastecer);
router.get('/cortes-caja', controller.cortesCaja); // ?desde=&hasta=
// Kilos vendidos por hilo (color + calibre) en el rango, su parte del periodo,
// lo vendido desde siempre y lo que queda en inventario.
router.get('/venta-por-color', controller.ventaPorColor); // ?desde=&hasta=&q=

module.exports = router;
