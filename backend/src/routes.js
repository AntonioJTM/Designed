'use strict';

const { Router } = require('express');
const usuariosRoutes = require('./modules/usuarios/routes');
const clientesRoutes = require('./modules/clientes/routes');
const direccionesRoutes = require('./modules/direcciones/routes');
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
const analisisRoutes = require('./modules/analisis/routes');
const asistenteRoutes = require('./modules/asistente/routes');
const notificacionesRoutes = require('./modules/notificaciones/routes');
const configuracionRoutes = require('./modules/configuracion/routes');
const permisosRoutes = require('./modules/permisos/routes');
const hoyRoutes = require('./modules/hoy/routes');

// Enrutador raíz de la API v1. Aquí se montan los módulos por dominio.
const router = Router();

// Seguridad / cuentas
router.use('/usuarios', usuariosRoutes);
router.use('/clientes', clientesRoutes);
router.use('/direcciones', direccionesRoutes);
router.use('/tipos-cliente', tiposClienteRoutes);
// Qué ve y qué puede hacer cada puesto (solo el administrador lo cambia).
router.use('/permisos', permisosRoutes);

// Configuración de la tienda (tarifa de envío, datos para depositar).
router.use('/configuracion', configuracionRoutes);

// Catálogo
router.use('/categorias', categoriasRoutes);
router.use('/productos', productosRoutes);
router.use('/variantes', variantesRoutes);
router.use('/imagenes', imagenesRoutes);
router.use('/opciones', opcionesRoutes);

// Inventario
router.use('/almacenes', almacenesRoutes);
router.use('/inventario', inventarioRoutes);
// Lo del día: lo vendido, por hora y las cajas abiertas (pantalla Hoy).
router.use('/hoy', hoyRoutes);
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
// El tablero del negocio: cobranza, clientes que no vuelven, hilo parado y margen.
router.use('/analisis', analisisRoutes);

// El asistente: se le pregunta en palabras normales y contesta con los datos de
// la tienda. La IA elige entre consultas ya programadas; nunca escribe SQL.
router.use('/asistente', asistenteRoutes);

module.exports = router;
