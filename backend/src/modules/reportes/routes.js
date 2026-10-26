'use strict';

const { Router } = require('express');
const controller = require('./controller');
const {
  authRequired, requireTipo, requirePermiso, requirePermisoAlguno, requireTodasLasTiendas,
} = require('../../middlewares/auth');

const router = Router();

// Reportes: quien ve TODAS las tiendas (2026-10-15: suman las dos tiendas; "eso
// solo lo ve el administrador"). Va en el router.use para que una ruta nueva no
// quede abierta por olvidar la guarda; el permiso, ruta por ruta.
router.use(authRequired, requireTipo('usuario'), requireTodasLasTiendas);

const reportes = requirePermiso('ver:reportes');
// Las VENTAS del periodo también las pinta «Cómo va el negocio» (2026-10-22: un
// puesto con esa pantalla y sin Reportes recibía 403 y sus cifras salían vacías).
const ventas = requirePermisoAlguno('ver:reportes', 'ver:negocio');

router.get('/ventas', ventas, controller.ventas); // ?desde=&hasta= (por defecto hoy)
router.get('/mas-vendidos', reportes, controller.masVendidos); // ?limite=
router.get('/por-reabastecer', reportes, controller.porReabastecer);
router.get('/cortes-caja', reportes, controller.cortesCaja); // ?desde=&hasta=
// Kilos vendidos por hilo (color + calibre) en el rango, su parte del periodo,
// lo vendido desde siempre y lo que queda en inventario.
router.get('/venta-por-color', reportes, controller.ventaPorColor); // ?desde=&hasta=&q=

module.exports = router;
