-- Dump de la base de datos 'desarrollo' (192.168.100.122)
-- Generado: 2026-07-24T20:44:07.902Z
-- Tablas: 37 · Vistas: 3
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------- Tabla: almacenes ----------
DROP TABLE IF EXISTS `almacenes`;
CREATE TABLE `almacenes` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `direccion` varchar(255) DEFAULT NULL,
  `es_punto_venta` tinyint(1) NOT NULL DEFAULT 0,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `almacenes` (`id`, `nombre`, `direccion`, `es_punto_venta`, `activo`) VALUES
  (1, 'Tienda principal', 'Sucursal centro', 1, 1),
  (2, 'Bodega', 'Almacén general', 0, 1);

-- ---------- Tabla: auditoria ----------
DROP TABLE IF EXISTS `auditoria`;
CREATE TABLE `auditoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `accion` varchar(80) NOT NULL,
  `entidad` varchar(80) NOT NULL,
  `entidad_id` varchar(80) DEFAULT NULL,
  `detalle` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_auditoria_usuario` (`usuario_id`),
  KEY `idx_auditoria_entidad` (`entidad`,`entidad_id`),
  CONSTRAINT `auditoria_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: cajas ----------
DROP TABLE IF EXISTS `cajas`;
CREATE TABLE `cajas` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `almacen_id` smallint(5) unsigned NOT NULL,
  `nombre` varchar(60) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `almacen_id` (`almacen_id`),
  CONSTRAINT `cajas_ibfk_1` FOREIGN KEY (`almacen_id`) REFERENCES `almacenes` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `cajas` (`id`, `almacen_id`, `nombre`, `activo`) VALUES
  (1, 1, 'Caja 1784847341530', 1),
  (2, 1, 'Caja 1784847438985', 1),
  (3, 1, 'Caja Rep 1784847926034', 1);

-- ---------- Tabla: carritos ----------
DROP TABLE IF EXISTS `carritos`;
CREATE TABLE `carritos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `cliente_id` bigint(20) unsigned DEFAULT NULL,
  `token_sesion` varchar(100) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `cliente_id` (`cliente_id`),
  CONSTRAINT `carritos_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: carrito_items ----------
DROP TABLE IF EXISTS `carrito_items`;
CREATE TABLE `carrito_items` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `carrito_id` bigint(20) unsigned NOT NULL,
  `variante_id` bigint(20) unsigned NOT NULL,
  `cantidad` decimal(12,3) NOT NULL CHECK (`cantidad` > 0),
  PRIMARY KEY (`id`),
  UNIQUE KEY `carrito_id` (`carrito_id`,`variante_id`),
  KEY `variante_id` (`variante_id`),
  CONSTRAINT `carrito_items_ibfk_1` FOREIGN KEY (`carrito_id`) REFERENCES `carritos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `carrito_items_ibfk_2` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: categorias ----------
DROP TABLE IF EXISTS `categorias`;
CREATE TABLE `categorias` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `padre_id` int(10) unsigned DEFAULT NULL,
  `nombre` varchar(100) NOT NULL,
  `slug` varchar(120) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `imagen_url` varchar(255) DEFAULT NULL,
  `orden` smallint(6) DEFAULT 0,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `idx_categorias_padre` (`padre_id`),
  CONSTRAINT `categorias_ibfk_1` FOREIGN KEY (`padre_id`) REFERENCES `categorias` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `categorias` (`id`, `padre_id`, `nombre`, `slug`, `descripcion`, `imagen_url`, `orden`, `activo`) VALUES
  (5, NULL, 'Accesorios', 'accesorios', 'Agujas, tijeras y complementos', NULL, 0, 1),
  (6, NULL, 'Hilos de prueba E2E', 'hilos-de-prueba-e2e', NULL, NULL, 0, 1),
  (7, NULL, 'Cat Inv 1784846590473', 'cat-inv-1784846590473', NULL, NULL, 0, 1),
  (8, NULL, 'Cat Venta 1784847341530', 'cat-venta-1784847341530', NULL, NULL, 0, 1),
  (9, NULL, 'Cat Venta 1784847438985', 'cat-venta-1784847438985', NULL, NULL, 0, 1),
  (10, NULL, 'Cat Rep 1784847926034', 'cat-rep-1784847926034', NULL, NULL, 0, 1),
  (11, NULL, 'acrilan', 'hilo para sueter', NULL, NULL, 0, 1),
  (12, NULL, 'acrilan azul', 'acrilan mas delgado', NULL, NULL, 0, 1),
  (13, NULL, 'Cat Tienda 1784906291405', 'cat-tienda-1784906291405', NULL, NULL, 0, 1),
  (14, NULL, 'Cat Tienda 1784906313721', 'cat-tienda-1784906313721', NULL, NULL, 0, 1),
  (15, NULL, 'Cat Cod 1784911226912', 'cat-cod-1784911226912', NULL, NULL, 0, 1);

-- ---------- Tabla: clientes ----------
DROP TABLE IF EXISTS `clientes`;
CREATE TABLE `clientes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(120) NOT NULL,
  `correo` varchar(160) DEFAULT NULL,
  `telefono` varchar(20) DEFAULT NULL,
  `contrasena_hash` varchar(255) DEFAULT NULL,
  `acepta_marketing` tinyint(1) NOT NULL DEFAULT 0,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `correo` (`correo`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `clientes` (`id`, `nombre`, `correo`, `telefono`, `contrasena_hash`, `acepta_marketing`, `activo`, `creado_en`, `actualizado_en`) VALUES
  (1, 'antonio tristan gutierrez', 'cwars0539@gmail.com', NULL, '$2b$12$N63bja94PU9hWR4FjBeHQusIWgdSPPdh3bYwD6OAL8JycsIHYypom', 0, 1, '2026-07-23 16:26:57', '2026-07-23 16:26:57'),
  (2, 'Cli', 'cli1784847341530@x.mx', NULL, '$2b$12$iVoIfgpv19JjvCKycJ83z.Fvwvfy9idRsPWhwtC/pLd/KEn1erlGm', 0, 1, '2026-07-23 16:55:15', '2026-07-23 16:55:15'),
  (3, 'Cli', 'cli1784847438985@x.mx', NULL, '$2b$12$lkGdMO0ZTN5uz8UkgeSYEu7SR40QLRAg29M7.2O61nb3WZQkk79VO', 0, 1, '2026-07-23 16:56:53', '2026-07-23 16:56:53'),
  (4, 'Clienta Web', 'c1784906291405@t.mx', NULL, '$2b$12$S0yqFj1WiVq/9c8aKND4iO2BG2jvmW2aP9INL3eE4IGeYY7r1.Ane', 0, 1, '2026-07-24 09:17:43', '2026-07-24 09:17:43'),
  (5, 'Clienta Web', 'c1784906313721@t.mx', NULL, '$2b$12$T3yx5SMDiDWpN9aI16OxOukiyfT3tP7rVH09G2cQyVKs9hO2FLxiq', 0, 1, '2026-07-24 09:18:05', '2026-07-24 09:18:05');

-- ---------- Tabla: colores ----------
DROP TABLE IF EXISTS `colores`;
CREATE TABLE `colores` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(60) NOT NULL,
  `codigo_hex` char(7) DEFAULT NULL,
  `codigo_fabricante` varchar(30) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`,`codigo_fabricante`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: cupones ----------
DROP TABLE IF EXISTS `cupones`;
CREATE TABLE `cupones` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `codigo` varchar(40) NOT NULL,
  `tipo` varchar(15) NOT NULL CHECK (`tipo` in ('porcentaje','monto_fijo')),
  `valor` decimal(12,2) NOT NULL CHECK (`valor` >= 0),
  `compra_minima` decimal(12,2) NOT NULL DEFAULT 0.00,
  `usos_maximos` int(11) DEFAULT NULL,
  `usos_actuales` int(11) NOT NULL DEFAULT 0,
  `fecha_inicio` date DEFAULT NULL,
  `fecha_fin` date DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `codigo` (`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: direcciones ----------
DROP TABLE IF EXISTS `direcciones`;
CREATE TABLE `direcciones` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `cliente_id` bigint(20) unsigned NOT NULL,
  `tipo` varchar(15) NOT NULL DEFAULT 'envio' CHECK (`tipo` in ('envio','facturacion')),
  `nombre_receptor` varchar(120) DEFAULT NULL,
  `calle` varchar(160) NOT NULL,
  `numero_ext` varchar(20) DEFAULT NULL,
  `numero_int` varchar(20) DEFAULT NULL,
  `colonia` varchar(100) DEFAULT NULL,
  `ciudad` varchar(100) NOT NULL,
  `estado` varchar(100) NOT NULL,
  `codigo_postal` varchar(15) NOT NULL,
  `pais` varchar(60) NOT NULL DEFAULT 'México',
  `telefono` varchar(20) DEFAULT NULL,
  `referencias` varchar(255) DEFAULT NULL,
  `es_predeterminada` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_direcciones_cliente` (`cliente_id`),
  CONSTRAINT `direcciones_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: envios ----------
DROP TABLE IF EXISTS `envios`;
CREATE TABLE `envios` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `pedido_id` bigint(20) unsigned NOT NULL,
  `paqueteria_id` smallint(5) unsigned DEFAULT NULL,
  `numero_guia` varchar(80) DEFAULT NULL,
  `costo` decimal(12,2) NOT NULL DEFAULT 0.00,
  `estado` varchar(20) NOT NULL DEFAULT 'preparando' CHECK (`estado` in ('preparando','enviado','en_transito','entregado','devuelto')),
  `fecha_envio` datetime DEFAULT NULL,
  `fecha_entrega_estimada` date DEFAULT NULL,
  `fecha_entrega_real` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `paqueteria_id` (`paqueteria_id`),
  KEY `idx_envios_pedido` (`pedido_id`),
  CONSTRAINT `envios_ibfk_1` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `envios_ibfk_2` FOREIGN KEY (`paqueteria_id`) REFERENCES `paqueterias` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: impuestos ----------
DROP TABLE IF EXISTS `impuestos`;
CREATE TABLE `impuestos` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(40) NOT NULL,
  `porcentaje` decimal(5,2) NOT NULL CHECK (`porcentaje` >= 0),
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `impuestos` (`id`, `nombre`, `porcentaje`, `activo`) VALUES
  (1, 'IVA', '16.00', 1);

-- ---------- Tabla: inventario ----------
DROP TABLE IF EXISTS `inventario`;
CREATE TABLE `inventario` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `variante_id` bigint(20) unsigned NOT NULL,
  `almacen_id` smallint(5) unsigned NOT NULL,
  `cantidad` decimal(12,3) NOT NULL DEFAULT 0.000 CHECK (`cantidad` >= 0),
  `cantidad_reservada` decimal(12,3) NOT NULL DEFAULT 0.000 CHECK (`cantidad_reservada` >= 0),
  `stock_minimo` decimal(12,3) NOT NULL DEFAULT 0.000,
  `stock_maximo` decimal(12,3) DEFAULT NULL,
  `ubicacion_fisica` varchar(60) DEFAULT NULL,
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `variante_id` (`variante_id`,`almacen_id`),
  KEY `almacen_id` (`almacen_id`),
  KEY `idx_inventario_variante` (`variante_id`),
  CONSTRAINT `inventario_ibfk_1` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inventario_ibfk_2` FOREIGN KEY (`almacen_id`) REFERENCES `almacenes` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `inventario` (`id`, `variante_id`, `almacen_id`, `cantidad`, `cantidad_reservada`, `stock_minimo`, `stock_maximo`, `ubicacion_fisica`, `actualizado_en`) VALUES
  (1, 4, 2, '40.000', '0.000', '50.000', NULL, NULL, '2026-07-23 16:42:44'),
  (5, 4, 1, '25.000', '0.000', '0.000', NULL, NULL, '2026-07-23 16:42:44'),
  (7, 5, 1, '7.000', '0.000', '0.000', NULL, NULL, '2026-07-23 16:55:15'),
  (10, 6, 1, '7.000', '0.000', '0.000', NULL, NULL, '2026-07-23 16:56:52'),
  (13, 7, 1, '2.000', '0.000', '10.000', NULL, NULL, '2026-07-23 17:05:00'),
  (16, 8, 2, '67.000', '0.000', '0.000', NULL, NULL, '2026-07-24 10:24:37'),
  (19, 9, 2, '17.000', '0.000', '0.000', NULL, NULL, '2026-07-24 09:18:05');

-- ---------- Tabla: listas_deseos ----------
DROP TABLE IF EXISTS `listas_deseos`;
CREATE TABLE `listas_deseos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `cliente_id` bigint(20) unsigned NOT NULL,
  `variante_id` bigint(20) unsigned NOT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `cliente_id` (`cliente_id`,`variante_id`),
  KEY `variante_id` (`variante_id`),
  CONSTRAINT `listas_deseos_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `listas_deseos_ibfk_2` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: marcas ----------
DROP TABLE IF EXISTS `marcas`;
CREATE TABLE `marcas` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `logo_url` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: materiales ----------
DROP TABLE IF EXISTS `materiales`;
CREATE TABLE `materiales` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(60) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `materiales` (`id`, `nombre`) VALUES
  (4, 'Acrílico'),
  (1, 'Algodón'),
  (3, 'Lana'),
  (6, 'Lino'),
  (7, 'Mezcla'),
  (2, 'Poliéster'),
  (5, 'Seda');

-- ---------- Tabla: metodos_pago ----------
DROP TABLE IF EXISTS `metodos_pago`;
CREATE TABLE `metodos_pago` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(40) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `metodos_pago` (`id`, `nombre`, `activo`) VALUES
  (1, 'Efectivo', 1),
  (2, 'Tarjeta débito/crédito', 1),
  (3, 'Transferencia', 1),
  (4, 'PayPal', 1),
  (5, 'Mercado Pago', 1);

-- ---------- Tabla: movimientos_caja ----------
DROP TABLE IF EXISTS `movimientos_caja`;
CREATE TABLE `movimientos_caja` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `sesion_caja_id` bigint(20) unsigned NOT NULL,
  `tipo` varchar(15) NOT NULL CHECK (`tipo` in ('venta','ingreso','retiro','devolucion')),
  `monto` decimal(12,2) NOT NULL,
  `referencia_id` bigint(20) unsigned DEFAULT NULL,
  `motivo` varchar(255) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_movcaja_sesion` (`sesion_caja_id`),
  CONSTRAINT `movimientos_caja_ibfk_1` FOREIGN KEY (`sesion_caja_id`) REFERENCES `sesiones_caja` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `movimientos_caja` (`id`, `sesion_caja_id`, `tipo`, `monto`, `referencia_id`, `motivo`, `creado_en`) VALUES
  (1, 1, 'venta', '250.00', 1, 'Venta POS-1784847341875-5AA5', '2026-07-23 16:55:15'),
  (2, 2, 'venta', '232.00', 3, 'Venta POS-1784847439337-D2CE', '2026-07-23 16:56:52'),
  (3, 3, 'venta', '348.00', 5, 'Venta POS-1784847926954-F3CD', '2026-07-23 17:05:00');

-- ---------- Tabla: movimientos_inventario ----------
DROP TABLE IF EXISTS `movimientos_inventario`;
CREATE TABLE `movimientos_inventario` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `variante_id` bigint(20) unsigned NOT NULL,
  `almacen_id` smallint(5) unsigned NOT NULL,
  `tipo` varchar(20) NOT NULL CHECK (`tipo` in ('entrada','salida','ajuste','transferencia','devolucion','merma')),
  `cantidad` decimal(12,3) NOT NULL,
  `costo_unitario` decimal(12,2) DEFAULT NULL,
  `referencia_tipo` varchar(30) DEFAULT NULL,
  `referencia_id` bigint(20) unsigned DEFAULT NULL,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `motivo` varchar(255) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `almacen_id` (`almacen_id`),
  KEY `usuario_id` (`usuario_id`),
  KEY `idx_movinv_variante` (`variante_id`),
  KEY `idx_movinv_fecha` (`creado_en`),
  CONSTRAINT `movimientos_inventario_ibfk_1` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`),
  CONSTRAINT `movimientos_inventario_ibfk_2` FOREIGN KEY (`almacen_id`) REFERENCES `almacenes` (`id`),
  CONSTRAINT `movimientos_inventario_ibfk_3` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `movimientos_inventario` (`id`, `variante_id`, `almacen_id`, `tipo`, `cantidad`, `costo_unitario`, `referencia_tipo`, `referencia_id`, `usuario_id`, `motivo`, `creado_en`) VALUES
  (1, 4, 2, 'entrada', '100.000', '30.00', NULL, NULL, 4, 'Compra inicial', '2026-07-23 16:42:44'),
  (2, 4, 2, 'salida', '-30.000', NULL, NULL, NULL, 4, 'Venta mostrador', '2026-07-23 16:42:44'),
  (3, 4, 2, 'ajuste', '-5.000', NULL, NULL, NULL, 4, 'Conteo físico', '2026-07-23 16:42:44'),
  (4, 4, 2, 'transferencia', '-25.000', NULL, 'transferencia', NULL, 4, 'Surtir tienda', '2026-07-23 16:42:44'),
  (5, 4, 1, 'transferencia', '25.000', NULL, 'transferencia', NULL, 4, 'Surtir tienda', '2026-07-23 16:42:44'),
  (6, 5, 1, 'entrada', '10.000', NULL, NULL, NULL, 6, NULL, '2026-07-23 16:55:15'),
  (7, 5, 1, 'salida', '-2.000', NULL, 'pedido', 1, 6, 'Venta POS-1784847341875-5AA5', '2026-07-23 16:55:15'),
  (8, 5, 1, 'salida', '-1.000', NULL, 'pedido', 2, 6, 'Venta WEB-1784847341941-4B12', '2026-07-23 16:55:15'),
  (9, 6, 1, 'entrada', '10.000', NULL, NULL, NULL, 7, NULL, '2026-07-23 16:56:52'),
  (10, 6, 1, 'salida', '-2.000', NULL, 'pedido', 3, 7, 'Venta POS-1784847439337-D2CE', '2026-07-23 16:56:52'),
  (11, 6, 1, 'salida', '-1.000', NULL, 'pedido', 4, 7, 'Venta WEB-1784847439390-9795', '2026-07-23 16:56:52'),
  (12, 7, 1, 'entrada', '5.000', NULL, NULL, NULL, 8, NULL, '2026-07-23 17:05:00'),
  (13, 7, 1, 'salida', '-3.000', NULL, 'pedido', 5, 8, 'Venta POS-1784847926954-F3CD', '2026-07-23 17:05:00'),
  (14, 8, 2, 'entrada', '20.000', NULL, NULL, NULL, 9, NULL, '2026-07-24 09:17:43'),
  (15, 8, 2, 'salida', '-2.000', NULL, 'pedido', 6, NULL, 'Venta WEB-1784906292101-479F', '2026-07-24 09:17:43'),
  (16, 8, 2, 'salida', '-1.000', NULL, 'pedido', 7, NULL, 'Venta WEB-1784906292122-47C1', '2026-07-24 09:17:43'),
  (17, 9, 2, 'entrada', '20.000', NULL, NULL, NULL, 10, NULL, '2026-07-24 09:18:05'),
  (18, 9, 2, 'salida', '-2.000', NULL, 'pedido', 8, NULL, 'Venta WEB-1784906314288-9A4C', '2026-07-24 09:18:05'),
  (19, 9, 2, 'salida', '-1.000', NULL, 'pedido', 9, NULL, 'Venta WEB-1784906314299-71FE', '2026-07-24 09:18:05'),
  (20, 8, 2, 'devolucion', '50.000', '500.00', NULL, NULL, 1, 'no sirve', '2026-07-24 10:24:37');

-- ---------- Tabla: ordenes_compra ----------
DROP TABLE IF EXISTS `ordenes_compra`;
CREATE TABLE `ordenes_compra` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `proveedor_id` bigint(20) unsigned NOT NULL,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `folio` varchar(40) NOT NULL,
  `estado` varchar(20) NOT NULL DEFAULT 'pendiente' CHECK (`estado` in ('pendiente','recibida','parcial','cancelada')),
  `subtotal` decimal(12,2) NOT NULL DEFAULT 0.00,
  `impuestos` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `fecha_pedido` date NOT NULL DEFAULT curdate(),
  `fecha_recepcion` date DEFAULT NULL,
  `notas` text DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `folio` (`folio`),
  KEY `usuario_id` (`usuario_id`),
  KEY `idx_ordenes_compra_proveedor` (`proveedor_id`),
  CONSTRAINT `ordenes_compra_ibfk_1` FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores` (`id`),
  CONSTRAINT `ordenes_compra_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: orden_compra_detalle ----------
DROP TABLE IF EXISTS `orden_compra_detalle`;
CREATE TABLE `orden_compra_detalle` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `orden_compra_id` bigint(20) unsigned NOT NULL,
  `variante_id` bigint(20) unsigned NOT NULL,
  `cantidad` decimal(12,3) NOT NULL CHECK (`cantidad` > 0),
  `cantidad_recibida` decimal(12,3) NOT NULL DEFAULT 0.000,
  `costo_unitario` decimal(12,2) NOT NULL CHECK (`costo_unitario` >= 0),
  PRIMARY KEY (`id`),
  KEY `variante_id` (`variante_id`),
  KEY `idx_oc_detalle_orden` (`orden_compra_id`),
  CONSTRAINT `orden_compra_detalle_ibfk_1` FOREIGN KEY (`orden_compra_id`) REFERENCES `ordenes_compra` (`id`) ON DELETE CASCADE,
  CONSTRAINT `orden_compra_detalle_ibfk_2` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: pagos ----------
DROP TABLE IF EXISTS `pagos`;
CREATE TABLE `pagos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `pedido_id` bigint(20) unsigned NOT NULL,
  `metodo_pago_id` smallint(5) unsigned NOT NULL,
  `monto` decimal(12,2) NOT NULL CHECK (`monto` > 0),
  `estado` varchar(15) NOT NULL DEFAULT 'completado' CHECK (`estado` in ('pendiente','procesando','completado','fallido','reembolsado')),
  `referencia_transaccion` varchar(120) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `metodo_pago_id` (`metodo_pago_id`),
  KEY `idx_pagos_pedido` (`pedido_id`),
  CONSTRAINT `pagos_ibfk_1` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `pagos_ibfk_2` FOREIGN KEY (`metodo_pago_id`) REFERENCES `metodos_pago` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `pagos` (`id`, `pedido_id`, `metodo_pago_id`, `monto`, `estado`, `referencia_transaccion`, `creado_en`) VALUES
  (1, 1, 1, '250.00', 'completado', NULL, '2026-07-23 16:55:15'),
  (2, 3, 1, '250.00', 'completado', NULL, '2026-07-23 16:56:52'),
  (3, 5, 1, '348.00', 'completado', NULL, '2026-07-23 17:05:00');

-- ---------- Tabla: paqueterias ----------
DROP TABLE IF EXISTS `paqueterias`;
CREATE TABLE `paqueterias` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(60) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `paqueterias` (`id`, `nombre`, `activo`) VALUES
  (1, 'Estafeta', 1),
  (2, 'DHL', 1),
  (3, 'FedEx', 1),
  (4, 'Correos de México', 1),
  (5, 'Paquetexpress', 1);

-- ---------- Tabla: pedidos ----------
DROP TABLE IF EXISTS `pedidos`;
CREATE TABLE `pedidos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `numero_pedido` varchar(40) NOT NULL,
  `canal` varchar(15) NOT NULL CHECK (`canal` in ('tienda_linea','punto_venta')),
  `cliente_id` bigint(20) unsigned DEFAULT NULL,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `sesion_caja_id` bigint(20) unsigned DEFAULT NULL,
  `almacen_id` smallint(5) unsigned DEFAULT NULL,
  `direccion_envio_id` bigint(20) unsigned DEFAULT NULL,
  `cupon_id` bigint(20) unsigned DEFAULT NULL,
  `estado` varchar(20) NOT NULL DEFAULT 'pendiente' CHECK (`estado` in ('pendiente','pagado','en_preparacion','enviado','entregado','cancelado','devuelto')),
  `subtotal` decimal(12,2) NOT NULL DEFAULT 0.00,
  `descuento` decimal(12,2) NOT NULL DEFAULT 0.00,
  `impuestos` decimal(12,2) NOT NULL DEFAULT 0.00,
  `costo_envio` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `notas` text DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `numero_pedido` (`numero_pedido`),
  KEY `usuario_id` (`usuario_id`),
  KEY `sesion_caja_id` (`sesion_caja_id`),
  KEY `almacen_id` (`almacen_id`),
  KEY `direccion_envio_id` (`direccion_envio_id`),
  KEY `cupon_id` (`cupon_id`),
  KEY `idx_pedidos_cliente` (`cliente_id`),
  KEY `idx_pedidos_estado` (`estado`),
  KEY `idx_pedidos_fecha` (`creado_en`),
  CONSTRAINT `pedidos_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`),
  CONSTRAINT `pedidos_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `pedidos_ibfk_3` FOREIGN KEY (`sesion_caja_id`) REFERENCES `sesiones_caja` (`id`),
  CONSTRAINT `pedidos_ibfk_4` FOREIGN KEY (`almacen_id`) REFERENCES `almacenes` (`id`),
  CONSTRAINT `pedidos_ibfk_5` FOREIGN KEY (`direccion_envio_id`) REFERENCES `direcciones` (`id`),
  CONSTRAINT `pedidos_ibfk_6` FOREIGN KEY (`cupon_id`) REFERENCES `cupones` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `pedidos` (`id`, `numero_pedido`, `canal`, `cliente_id`, `usuario_id`, `sesion_caja_id`, `almacen_id`, `direccion_envio_id`, `cupon_id`, `estado`, `subtotal`, `descuento`, `impuestos`, `costo_envio`, `total`, `notas`, `creado_en`, `actualizado_en`) VALUES
  (1, 'POS-1784847341875-5AA5', 'punto_venta', NULL, 6, 1, 1, NULL, NULL, 'pagado', '200.00', '0.00', '32.00', '0.00', '232.00', NULL, '2026-07-23 16:55:15', '2026-07-23 16:55:15'),
  (2, 'WEB-1784847341941-4B12', 'tienda_linea', NULL, 6, NULL, 1, NULL, NULL, 'pendiente', '100.00', '0.00', '16.00', '0.00', '116.00', NULL, '2026-07-23 16:55:15', '2026-07-23 16:55:15'),
  (3, 'POS-1784847439337-D2CE', 'punto_venta', NULL, 7, 2, 1, NULL, NULL, 'pagado', '200.00', '0.00', '32.00', '0.00', '232.00', NULL, '2026-07-23 16:56:52', '2026-07-23 16:56:52'),
  (4, 'WEB-1784847439390-9795', 'tienda_linea', NULL, 7, NULL, 1, NULL, NULL, 'pendiente', '100.00', '0.00', '16.00', '0.00', '116.00', NULL, '2026-07-23 16:56:52', '2026-07-23 16:56:52'),
  (5, 'POS-1784847926954-F3CD', 'punto_venta', NULL, 8, 3, 1, NULL, NULL, 'pagado', '300.00', '0.00', '48.00', '0.00', '348.00', NULL, '2026-07-23 17:05:00', '2026-07-23 17:05:00'),
  (6, 'WEB-1784906292101-479F', 'tienda_linea', 4, NULL, NULL, 2, NULL, NULL, 'pendiente', '240.00', '0.00', '38.40', '0.00', '278.40', NULL, '2026-07-24 09:17:43', '2026-07-24 09:17:43'),
  (7, 'WEB-1784906292122-47C1', 'tienda_linea', 4, NULL, NULL, 2, NULL, NULL, 'pendiente', '120.00', '0.00', '19.20', '0.00', '139.20', NULL, '2026-07-24 09:17:43', '2026-07-24 09:17:43'),
  (8, 'WEB-1784906314288-9A4C', 'tienda_linea', 5, NULL, NULL, 2, NULL, NULL, 'pendiente', '240.00', '0.00', '38.40', '0.00', '278.40', NULL, '2026-07-24 09:18:05', '2026-07-24 09:18:05'),
  (9, 'WEB-1784906314299-71FE', 'tienda_linea', 5, NULL, NULL, 2, NULL, NULL, 'pendiente', '120.00', '0.00', '19.20', '0.00', '139.20', NULL, '2026-07-24 09:18:05', '2026-07-24 09:18:05');

-- ---------- Tabla: pedido_detalle ----------
DROP TABLE IF EXISTS `pedido_detalle`;
CREATE TABLE `pedido_detalle` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `pedido_id` bigint(20) unsigned NOT NULL,
  `variante_id` bigint(20) unsigned NOT NULL,
  `descripcion` varchar(200) NOT NULL,
  `cantidad` decimal(12,3) NOT NULL CHECK (`cantidad` > 0),
  `precio_unitario` decimal(12,2) NOT NULL CHECK (`precio_unitario` >= 0),
  `descuento` decimal(12,2) NOT NULL DEFAULT 0.00,
  `impuesto` decimal(12,2) NOT NULL DEFAULT 0.00,
  `subtotal` decimal(12,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `variante_id` (`variante_id`),
  KEY `idx_pedido_detalle_pedido` (`pedido_id`),
  CONSTRAINT `pedido_detalle_ibfk_1` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `pedido_detalle_ibfk_2` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `pedido_detalle` (`id`, `pedido_id`, `variante_id`, `descripcion`, `cantidad`, `precio_unitario`, `descuento`, `impuesto`, `subtotal`) VALUES
  (1, 1, 5, 'Prod Venta 1784847341530', '2.000', '100.00', '0.00', '32.00', '200.00'),
  (2, 2, 5, 'Prod Venta 1784847341530', '1.000', '100.00', '0.00', '16.00', '100.00'),
  (3, 3, 6, 'Prod Venta 1784847438985', '2.000', '100.00', '0.00', '32.00', '200.00'),
  (4, 4, 6, 'Prod Venta 1784847438985', '1.000', '100.00', '0.00', '16.00', '100.00'),
  (5, 5, 7, 'Prod Rep 1784847926034', '3.000', '100.00', '0.00', '48.00', '300.00'),
  (6, 6, 8, 'Estambre Tienda 1784906291405 · Madeja 100g', '2.000', '120.00', '0.00', '38.40', '240.00'),
  (7, 7, 8, 'Estambre Tienda 1784906291405 · Madeja 100g', '1.000', '120.00', '0.00', '19.20', '120.00'),
  (8, 8, 9, 'Estambre Tienda 1784906313721 · Madeja 100g', '2.000', '120.00', '0.00', '38.40', '240.00'),
  (9, 9, 9, 'Estambre Tienda 1784906313721 · Madeja 100g', '1.000', '120.00', '0.00', '19.20', '120.00');

-- ---------- Tabla: permisos ----------
DROP TABLE IF EXISTS `permisos`;
CREATE TABLE `permisos` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `clave` varchar(80) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `clave` (`clave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: productos ----------
DROP TABLE IF EXISTS `productos`;
CREATE TABLE `productos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `categoria_id` int(10) unsigned NOT NULL,
  `marca_id` int(10) unsigned DEFAULT NULL,
  `material_id` smallint(5) unsigned DEFAULT NULL,
  `unidad_medida_id` smallint(5) unsigned NOT NULL,
  `impuesto_id` smallint(5) unsigned DEFAULT NULL,
  `nombre` varchar(160) NOT NULL,
  `slug` varchar(180) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `grosor_calibre` varchar(30) DEFAULT NULL,
  `peso_gramos` decimal(8,2) DEFAULT NULL,
  `longitud_metros` decimal(8,2) DEFAULT NULL,
  `destacado` tinyint(1) NOT NULL DEFAULT 0,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `material_id` (`material_id`),
  KEY `unidad_medida_id` (`unidad_medida_id`),
  KEY `impuesto_id` (`impuesto_id`),
  KEY `idx_productos_categoria` (`categoria_id`),
  KEY `idx_productos_marca` (`marca_id`),
  CONSTRAINT `productos_ibfk_1` FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`),
  CONSTRAINT `productos_ibfk_2` FOREIGN KEY (`marca_id`) REFERENCES `marcas` (`id`),
  CONSTRAINT `productos_ibfk_3` FOREIGN KEY (`material_id`) REFERENCES `materiales` (`id`),
  CONSTRAINT `productos_ibfk_4` FOREIGN KEY (`unidad_medida_id`) REFERENCES `unidades_medida` (`id`),
  CONSTRAINT `productos_ibfk_5` FOREIGN KEY (`impuesto_id`) REFERENCES `impuestos` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `productos` (`id`, `categoria_id`, `marca_id`, `material_id`, `unidad_medida_id`, `impuesto_id`, `nombre`, `slug`, `descripcion`, `grosor_calibre`, `peso_gramos`, `longitud_metros`, `destacado`, `activo`, `creado_en`, `actualizado_en`) VALUES
  (1, 6, NULL, NULL, 1, 1, 'Hilo Crochet Fino E2E', 'hilo-crochet-fino-e2e', 'prueba', NULL, NULL, NULL, 1, 1, '2026-07-23 16:30:00', '2026-07-23 16:30:00'),
  (3, 7, NULL, NULL, 1, NULL, 'Prod Inv 1784846590473', 'prod-inv-1784846590473', NULL, NULL, NULL, NULL, 0, 1, '2026-07-23 16:42:44', '2026-07-23 16:42:44'),
  (4, 8, NULL, NULL, 1, 1, 'Prod Venta 1784847341530', 'prod-venta-1784847341530', NULL, NULL, NULL, NULL, 0, 1, '2026-07-23 16:55:15', '2026-07-23 16:55:15'),
  (5, 9, NULL, NULL, 1, 1, 'Prod Venta 1784847438985', 'prod-venta-1784847438985', NULL, NULL, NULL, NULL, 0, 1, '2026-07-23 16:56:52', '2026-07-23 16:56:52'),
  (6, 10, NULL, NULL, 1, 1, 'Prod Rep 1784847926034', 'prod-rep-1784847926034', NULL, NULL, NULL, NULL, 0, 1, '2026-07-23 17:04:59', '2026-07-23 17:04:59'),
  (7, 11, NULL, 4, 5, NULL, 'hilo azul c', 'que es el slug', NULL, '15', '15000.00', '5.00', 0, 1, '2026-07-23 17:10:31', '2026-07-23 17:10:31'),
  (8, 13, NULL, NULL, 1, 1, 'Estambre Tienda 1784906291405', 'estambre-tienda-1784906291405', NULL, NULL, NULL, NULL, 0, 1, '2026-07-24 09:17:43', '2026-07-24 09:17:43'),
  (9, 14, NULL, NULL, 1, 1, 'Estambre Tienda 1784906313721', 'estambre-tienda-1784906313721', NULL, NULL, NULL, NULL, 0, 1, '2026-07-24 09:18:05', '2026-07-24 09:18:05'),
  (10, 15, NULL, NULL, 1, NULL, 'Estambre Rojo 1784911226912', 'estambre-rojo-1784911226912', NULL, NULL, NULL, NULL, 0, 1, '2026-07-24 10:39:58', '2026-07-24 10:39:58'),
  (11, 11, NULL, 4, 6, NULL, 'hdfghdfghdfgh', 'dfghdfgh', NULL, '67', '678.00', '4564.00', 0, 1, '2026-07-24 10:44:16', '2026-07-24 10:46:25');

-- ---------- Tabla: producto_imagenes ----------
DROP TABLE IF EXISTS `producto_imagenes`;
CREATE TABLE `producto_imagenes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `producto_id` bigint(20) unsigned NOT NULL,
  `variante_id` bigint(20) unsigned DEFAULT NULL,
  `url` varchar(255) NOT NULL,
  `es_principal` tinyint(1) NOT NULL DEFAULT 0,
  `orden` smallint(6) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `variante_id` (`variante_id`),
  KEY `idx_imagenes_producto` (`producto_id`),
  CONSTRAINT `producto_imagenes_ibfk_1` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `producto_imagenes_ibfk_2` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `producto_imagenes` (`id`, `producto_id`, `variante_id`, `url`, `es_principal`, `orden`) VALUES
  (1, 1, NULL, 'https://cdn.ejemplo.mx/hilo-e2e.jpg', 1, 0),
  (2, 8, NULL, 'https://cdn.x/estambre.jpg', 1, 0),
  (3, 9, NULL, 'https://cdn.x/estambre.jpg', 1, 0);

-- ---------- Tabla: producto_variantes ----------
DROP TABLE IF EXISTS `producto_variantes`;
CREATE TABLE `producto_variantes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `producto_id` bigint(20) unsigned NOT NULL,
  `color_id` int(10) unsigned DEFAULT NULL,
  `sku` varchar(60) NOT NULL,
  `codigo_barras` varchar(60) DEFAULT NULL,
  `presentacion` varchar(40) DEFAULT NULL,
  `precio` decimal(12,2) NOT NULL CHECK (`precio` >= 0),
  `precio_oferta` decimal(12,2) DEFAULT NULL CHECK (`precio_oferta` >= 0),
  `costo` decimal(12,2) DEFAULT NULL CHECK (`costo` >= 0),
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `sku` (`sku`),
  UNIQUE KEY `codigo_barras` (`codigo_barras`),
  KEY `idx_variantes_producto` (`producto_id`),
  KEY `idx_variantes_color` (`color_id`),
  CONSTRAINT `producto_variantes_ibfk_1` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `producto_variantes_ibfk_2` FOREIGN KEY (`color_id`) REFERENCES `colores` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `producto_variantes` (`id`, `producto_id`, `color_id`, `sku`, `codigo_barras`, `presentacion`, `precio`, `precio_oferta`, `costo`, `activo`, `creado_en`, `actualizado_en`) VALUES
  (1, 1, NULL, 'E2E-1784845827049-A', NULL, 'Madeja 50g', '29.90', NULL, NULL, 1, '2026-07-23 16:30:00', '2026-07-23 16:30:00'),
  (2, 1, NULL, 'E2E-1784845827049-B', NULL, 'Cono 200g', '89.00', '79.00', NULL, 1, '2026-07-23 16:30:00', '2026-07-23 16:30:00'),
  (4, 3, NULL, 'INV-1784846590473', NULL, NULL, '50.00', NULL, NULL, 1, '2026-07-23 16:42:44', '2026-07-23 16:42:44'),
  (5, 4, NULL, 'VEN-1784847341530', NULL, NULL, '100.00', NULL, NULL, 1, '2026-07-23 16:55:15', '2026-07-23 16:55:15'),
  (6, 5, NULL, 'VEN-1784847438985', NULL, NULL, '100.00', NULL, NULL, 1, '2026-07-23 16:56:52', '2026-07-23 16:56:52'),
  (7, 6, NULL, 'REP-1784847926034', NULL, NULL, '100.00', NULL, NULL, 1, '2026-07-23 17:04:59', '2026-07-23 17:04:59'),
  (8, 8, NULL, 'TDA-1784906291405', NULL, 'Madeja 100g', '120.00', NULL, NULL, 1, '2026-07-24 09:17:43', '2026-07-24 09:17:43'),
  (9, 9, NULL, 'TDA-1784906313721', NULL, 'Madeja 100g', '120.00', NULL, NULL, 1, '2026-07-24 09:18:05', '2026-07-24 09:18:05'),
  (10, 10, NULL, 'ROJO-1784911226912', 'PRIN-1784911226912', NULL, '50.00', NULL, NULL, 1, '2026-07-24 10:39:58', '2026-07-24 10:39:58'),
  (11, 10, NULL, 'AZUL-1784911226912', NULL, NULL, '50.00', NULL, NULL, 1, '2026-07-24 10:39:58', '2026-07-24 10:39:58');

-- ---------- Tabla: proveedores ----------
DROP TABLE IF EXISTS `proveedores`;
CREATE TABLE `proveedores` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(160) NOT NULL,
  `contacto` varchar(120) DEFAULT NULL,
  `correo` varchar(160) DEFAULT NULL,
  `telefono` varchar(20) DEFAULT NULL,
  `direccion` varchar(255) DEFAULT NULL,
  `rfc_id_fiscal` varchar(30) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: resenas ----------
DROP TABLE IF EXISTS `resenas`;
CREATE TABLE `resenas` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `producto_id` bigint(20) unsigned NOT NULL,
  `cliente_id` bigint(20) unsigned DEFAULT NULL,
  `calificacion` tinyint(4) NOT NULL CHECK (`calificacion` between 1 and 5),
  `comentario` text DEFAULT NULL,
  `aprobada` tinyint(1) NOT NULL DEFAULT 0,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `cliente_id` (`cliente_id`),
  KEY `idx_resenas_producto` (`producto_id`),
  CONSTRAINT `resenas_ibfk_1` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `resenas_ibfk_2` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: roles ----------
DROP TABLE IF EXISTS `roles`;
CREATE TABLE `roles` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(50) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `roles` (`id`, `nombre`, `descripcion`, `creado_en`) VALUES
  (1, 'administrador', 'Acceso total al sistema', '2026-07-23 16:08:16'),
  (2, 'gerente', 'Gestión de inventario, compras y reportes', '2026-07-23 16:08:16'),
  (3, 'cajero', 'Operación del punto de venta', '2026-07-23 16:08:16'),
  (4, 'almacenista', 'Recepción de mercancía y ajustes de inventario', '2026-07-23 16:08:16');

-- ---------- Tabla: rol_permisos ----------
DROP TABLE IF EXISTS `rol_permisos`;
CREATE TABLE `rol_permisos` (
  `rol_id` smallint(5) unsigned NOT NULL,
  `permiso_id` smallint(5) unsigned NOT NULL,
  PRIMARY KEY (`rol_id`,`permiso_id`),
  KEY `permiso_id` (`permiso_id`),
  CONSTRAINT `rol_permisos_ibfk_1` FOREIGN KEY (`rol_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `rol_permisos_ibfk_2` FOREIGN KEY (`permiso_id`) REFERENCES `permisos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------- Tabla: sesiones_caja ----------
DROP TABLE IF EXISTS `sesiones_caja`;
CREATE TABLE `sesiones_caja` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `caja_id` smallint(5) unsigned NOT NULL,
  `usuario_id` bigint(20) unsigned NOT NULL,
  `monto_inicial` decimal(12,2) NOT NULL DEFAULT 0.00,
  `monto_esperado` decimal(12,2) DEFAULT NULL,
  `monto_final` decimal(12,2) DEFAULT NULL,
  `diferencia` decimal(12,2) DEFAULT NULL,
  `estado` varchar(10) NOT NULL DEFAULT 'abierta' CHECK (`estado` in ('abierta','cerrada')),
  `fecha_apertura` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_cierre` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `caja_id` (`caja_id`),
  KEY `idx_sesiones_caja_usuario` (`usuario_id`),
  CONSTRAINT `sesiones_caja_ibfk_1` FOREIGN KEY (`caja_id`) REFERENCES `cajas` (`id`),
  CONSTRAINT `sesiones_caja_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `sesiones_caja` (`id`, `caja_id`, `usuario_id`, `monto_inicial`, `monto_esperado`, `monto_final`, `diferencia`, `estado`, `fecha_apertura`, `fecha_cierre`) VALUES
  (1, 1, 6, '500.00', '750.00', '700.00', '-50.00', 'cerrada', '2026-07-23 16:55:15', '2026-07-23 16:55:15'),
  (2, 2, 7, '500.00', '732.00', '700.00', '-32.00', 'cerrada', '2026-07-23 16:56:52', '2026-07-23 16:56:52'),
  (3, 3, 8, '0.00', '348.00', '348.00', '0.00', 'cerrada', '2026-07-23 17:05:00', '2026-07-23 17:05:00'),
  (4, 1, 5, '0.00', '0.00', '500.00', '500.00', 'cerrada', '2026-07-23 17:13:03', '2026-07-23 17:13:25'),
  (5, 1, 1, '0.00', '0.00', '1800.00', '1800.00', 'cerrada', '2026-07-24 09:31:28', '2026-07-24 10:42:06');

-- ---------- Tabla: unidades_medida ----------
DROP TABLE IF EXISTS `unidades_medida`;
CREATE TABLE `unidades_medida` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(30) NOT NULL,
  `abreviatura` varchar(10) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`),
  UNIQUE KEY `abreviatura` (`abreviatura`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `unidades_medida` (`id`, `nombre`, `abreviatura`) VALUES
  (1, 'Pieza', 'pza'),
  (2, 'Madeja', 'mad'),
  (3, 'Cono', 'cono'),
  (4, 'Metro', 'm'),
  (5, 'Gramo', 'g'),
  (6, 'Bolsa', 'bolsa');

-- ---------- Tabla: usuarios ----------
DROP TABLE IF EXISTS `usuarios`;
CREATE TABLE `usuarios` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `rol_id` smallint(5) unsigned NOT NULL,
  `nombre` varchar(120) NOT NULL,
  `correo` varchar(160) NOT NULL,
  `telefono` varchar(20) DEFAULT NULL,
  `contrasena_hash` varchar(255) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `ultimo_acceso` datetime DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `correo` (`correo`),
  KEY `rol_id` (`rol_id`),
  CONSTRAINT `usuarios_ibfk_1` FOREIGN KEY (`rol_id`) REFERENCES `roles` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `usuarios` (`id`, `rol_id`, `nombre`, `correo`, `telefono`, `contrasena_hash`, `activo`, `ultimo_acceso`, `creado_en`, `actualizado_en`) VALUES
  (1, 1, 'Antonio Tristan', 'ceitor12345@gmail.com', '7713036351', '$2b$12$2PBWLqihrwGvIvLgNqB89uiLTtCxnLaaVOkbrc2Oujr6j3xK8KOoO', 1, '2026-07-24 10:43:04', '2026-07-23 16:22:17', '2026-07-24 10:43:04'),
  (2, 1, 'Tester Catalogo', 'catalogo@tienda.mx', NULL, '$2b$12$uvv0BsSlBdDp/R3Dv9W7dua9qSmerGTRDm1zvxZMKPp/mUlY4Cfay', 1, NULL, '2026-07-23 16:29:09', '2026-07-23 16:29:09'),
  (3, 1, 'Tester Catalogo', 'catalogo1784845827049@tienda.mx', NULL, '$2b$12$vlHjcBxV77WoF4BOcOH.5ehnJmaWZ8A1UVCzZaalsINBZC0nDuQ4C', 1, NULL, '2026-07-23 16:30:00', '2026-07-23 16:30:00'),
  (4, 1, 'Inv Tester', 'inv1784846590473@tienda.mx', NULL, '$2b$12$LsUgNhgrL.9eEd8vwpK60eCg.LjuLcOnt81Wia4K4BaE/pBSEexjW', 1, NULL, '2026-07-23 16:42:44', '2026-07-23 16:42:44'),
  (5, 3, 'juan luis', 'juan@gmail.com', '1234567890', '$2b$12$9Z3e7.d9mmd9dZsrKOlIeubf8uvyUmFkUS2fv29UAEhWqjEpe5qsq', 1, NULL, '2026-07-23 16:53:43', '2026-07-23 16:53:43'),
  (6, 1, 'Ventas Tester', 'ventas1784847341530@tienda.mx', NULL, '$2b$12$MkSO3tkh1QGJkCwZD95ZqOuh.mIM1G7NtBJTf0O/Jvai094bEZnFu', 1, NULL, '2026-07-23 16:55:15', '2026-07-23 16:55:15'),
  (7, 1, 'Ventas Tester', 'ventas1784847438985@tienda.mx', NULL, '$2b$12$41wXEVyVlvJL7sXO/otfWO2Dk5YEqvxLK3dQjMbxEjIkHEwO6./XK', 1, NULL, '2026-07-23 16:56:52', '2026-07-23 16:56:52'),
  (8, 1, 'Rep Tester', 'rep1784847926034@tienda.mx', NULL, '$2b$12$GQBnO3rGm8vXt5dEZUGaJuueiMryRnwb1zg7pi1jVBECtiKwcxAb6', 1, NULL, '2026-07-23 17:04:59', '2026-07-23 17:04:59'),
  (9, 1, 'Staff Tienda', 's1784906291405@t.mx', NULL, '$2b$12$YadtFADg.vonU9TkMlHOYeJrLVqt/xvxBUJ9LR7VuxH2QrV3hAZYO', 1, NULL, '2026-07-24 09:17:43', '2026-07-24 09:17:43'),
  (10, 1, 'Staff Tienda', 's1784906313721@t.mx', NULL, '$2b$12$1atlI4pzjM7TphsySmSNpOfEliWJTjaNIDc1PppRTIpk0YewuhgoO', 1, NULL, '2026-07-24 09:18:05', '2026-07-24 09:18:05'),
  (11, 1, 'Admin Seed', 'admin1784908172029@t.mx', NULL, '$2b$12$PYnxBjvrAaySsaxp/zYMsOvQ8nqCEwFu48BA/QxNjDT.iPlp7b9lq', 1, '2026-07-24 09:49:07', '2026-07-24 09:49:04', '2026-07-24 09:49:07'),
  (12, 3, 'Caj Prueba', 'caj1784908175819@t.mx', NULL, '$2b$12$SnSbfaGBJ78oXncfi29GruIeUmLkCqiBz1IxeJtvH4pQTpJJA2VRe', 1, '2026-07-24 09:49:07', '2026-07-24 09:49:07', '2026-07-24 09:49:07'),
  (13, 1, 'Admin Cod', 'admincod1784911223323@t.mx', NULL, '$2b$12$vR.Z2WqHL3eKNuMEXHRE6OzdvsfMIsvaAdESvH5IUoLFgHo3L59gW', 1, '2026-07-24 10:39:58', '2026-07-24 10:39:55', '2026-07-24 10:39:58');

-- ---------- Tabla: variante_codigos ----------
DROP TABLE IF EXISTS `variante_codigos`;
CREATE TABLE `variante_codigos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `variante_id` bigint(20) unsigned NOT NULL,
  `codigo` varchar(60) NOT NULL,
  `etiqueta` varchar(60) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `codigo` (`codigo`),
  KEY `idx_variante_codigos_variante` (`variante_id`),
  CONSTRAINT `variante_codigos_ibfk_1` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `variante_codigos` (`id`, `variante_id`, `codigo`, `etiqueta`, `creado_en`) VALUES
  (2, 10, 'LOTEB-1784911226912', 'Lote B', '2026-07-24 10:39:58');

-- ---------- Vista: v_alertas_stock ----------
DROP VIEW IF EXISTS `v_alertas_stock`;
CREATE OR REPLACE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_alertas_stock` AS select `v_stock_disponible`.`variante_id` AS `variante_id`,`v_stock_disponible`.`sku` AS `sku`,`v_stock_disponible`.`producto` AS `producto`,`v_stock_disponible`.`color` AS `color`,`v_stock_disponible`.`almacen` AS `almacen`,`v_stock_disponible`.`cantidad` AS `cantidad`,`v_stock_disponible`.`cantidad_reservada` AS `cantidad_reservada`,`v_stock_disponible`.`disponible` AS `disponible`,`v_stock_disponible`.`stock_minimo` AS `stock_minimo` from `v_stock_disponible` where `v_stock_disponible`.`disponible` <= `v_stock_disponible`.`stock_minimo`;

-- ---------- Vista: v_mas_vendidos ----------
DROP VIEW IF EXISTS `v_mas_vendidos`;
CREATE OR REPLACE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_mas_vendidos` AS select `pv`.`id` AS `variante_id`,`pv`.`sku` AS `sku`,`p`.`nombre` AS `producto`,sum(`pd`.`cantidad`) AS `unidades_vendidas`,sum(`pd`.`subtotal`) AS `ingresos` from (((`pedido_detalle` `pd` join `producto_variantes` `pv` on(`pv`.`id` = `pd`.`variante_id`)) join `productos` `p` on(`p`.`id` = `pv`.`producto_id`)) join `pedidos` `ped` on(`ped`.`id` = `pd`.`pedido_id`)) where `ped`.`estado` not in ('cancelado','devuelto') group by `pv`.`id`,`pv`.`sku`,`p`.`nombre`;

-- ---------- Vista: v_stock_disponible ----------
DROP VIEW IF EXISTS `v_stock_disponible`;
CREATE OR REPLACE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_stock_disponible` AS select `i`.`variante_id` AS `variante_id`,`pv`.`sku` AS `sku`,`p`.`nombre` AS `producto`,`c`.`nombre` AS `color`,`a`.`nombre` AS `almacen`,`i`.`cantidad` AS `cantidad`,`i`.`cantidad_reservada` AS `cantidad_reservada`,`i`.`cantidad` - `i`.`cantidad_reservada` AS `disponible`,`i`.`stock_minimo` AS `stock_minimo` from ((((`inventario` `i` join `producto_variantes` `pv` on(`pv`.`id` = `i`.`variante_id`)) join `productos` `p` on(`p`.`id` = `pv`.`producto_id`)) left join `colores` `c` on(`c`.`id` = `pv`.`color_id`)) join `almacenes` `a` on(`a`.`id` = `i`.`almacen_id`));

SET FOREIGN_KEY_CHECKS = 1;
