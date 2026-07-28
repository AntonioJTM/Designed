'use strict';

const { Router } = require('express');
const usuariosRoutes = require('./modules/usuarios/routes');
const clientesRoutes = require('./modules/clientes/routes');
const tiposClienteRoutes = require('./modules/tipos-cliente/routes');
const categoriasRoutes = require('./modules/categorias/routes');
const productosRoutes = require('./modules/productos/routes');
const variantesRoutes = require('./modules/variantes/routes');
const imagenesRoutes = require('./modules/imagenes/routes');
const opcionesRoutes = require('./modules/opciones/routes');
const almacenesRoutes = require('./modules/almacenes/routes');
const inventarioRoutes = require('./modules/inventario/routes');
const remesasRoutes = require('./modules/remesas/routes');
const cajaRoutes = require('./modules/caja/routes');
const pedidosRoutes = require('./modules/pedidos/routes');
const nominaRoutes = require('./modules/nomina/routes');
const reportesRoutes = require('./modules/reportes/routes');
const notificacionesRoutes = require('./modules/notificaciones/routes');

// Enrutador raíz de la API v1. Aquí se montan los módulos por dominio.
const router = Router();

router.get('/', (req, res) => {
  res.json({ data: { api: 'tienda-hilos', version: 'v1' }, error: null });
});

// Seguridad / cuentas
router.use('/usuarios', usuariosRoutes);
router.use('/clientes', clientesRoutes);
router.use('/tipos-cliente', tiposClienteRoutes);

// Catálogo
router.use('/categorias', categoriasRoutes);
router.use('/productos', productosRoutes);
router.use('/variantes', variantesRoutes);
router.use('/imagenes', imagenesRoutes);
router.use('/opciones', opcionesRoutes);

// Inventario
router.use('/almacenes', almacenesRoutes);
router.use('/inventario', inventarioRoutes);
// Lo que está esperando a alguien (la campana del panel).
router.use('/notificaciones', notificacionesRoutes);
router.use('/remesas', remesasRoutes);

// Ventas y caja
router.use('/caja', cajaRoutes);
router.use('/pedidos', pedidosRoutes);

// Nómina del personal
router.use('/nomina', nominaRoutes);

// Reportes
router.use('/reportes', reportesRoutes);

module.exports = router;
