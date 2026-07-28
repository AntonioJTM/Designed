-- =====================================================================
--  SISTEMA DE GESTIÓN PARA TIENDA DE HILOS  ·  Esquema MySQL / MariaDB
--  Tienda en línea · Administrador · Inventario · Punto de venta · Nómina
-- ---------------------------------------------------------------------
--  ARCHIVO GENERADO desde la base 'desarrollo'. No lo edites a mano:
--  cambia la base y vuelve a correr  node scripts/dump-db.js --estructura
-- =====================================================================
-- Generado: 2026-07-28T17:46:01.738Z
-- Tablas: 46 · Vistas: 4
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
--  MÓDULO 1 · SEGURIDAD Y ADMINISTRACIÓN
-- ---------------------------------------------------------------------

-- ---------- Tabla: roles ----------
DROP TABLE IF EXISTS `roles`;
CREATE TABLE `roles` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(50) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: permisos ----------
DROP TABLE IF EXISTS `permisos`;
CREATE TABLE `permisos` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `clave` varchar(80) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `clave` (`clave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: auditoria ----------
DROP TABLE IF EXISTS `auditoria`;
CREATE TABLE `auditoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `accion` varchar(80) NOT NULL,
  `entidad` varchar(80) NOT NULL,
  `entidad_id` varchar(80) DEFAULT NULL,
  `detalle` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`detalle`)),
  `ip` varchar(45) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_auditoria_usuario` (`usuario_id`),
  KEY `idx_auditoria_entidad` (`entidad`,`entidad_id`),
  CONSTRAINT `auditoria_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  MÓDULO 2 · CATÁLOGO DE PRODUCTOS (HILOS)
-- ---------------------------------------------------------------------

-- ---------- Tabla: categorias ----------
DROP TABLE IF EXISTS `categorias`;
CREATE TABLE `categorias` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `calibres` varchar(255) DEFAULT NULL,
  `imagen_url` varchar(255) DEFAULT NULL,
  `orden` smallint(6) DEFAULT 0,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: lineas ----------
DROP TABLE IF EXISTS `lineas`;
CREATE TABLE `lineas` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `logo_url` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: unidades_medida ----------
DROP TABLE IF EXISTS `unidades_medida`;
CREATE TABLE `unidades_medida` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(30) NOT NULL,
  `abreviatura` varchar(10) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`),
  UNIQUE KEY `abreviatura` (`abreviatura`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: impuestos ----------
DROP TABLE IF EXISTS `impuestos`;
CREATE TABLE `impuestos` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(40) NOT NULL,
  `porcentaje` decimal(5,2) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  CONSTRAINT `impuestos_chk_1` CHECK (`porcentaje` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: productos ----------
DROP TABLE IF EXISTS `productos`;
CREATE TABLE `productos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `categoria_id` int(10) unsigned NOT NULL,
  `linea_id` int(10) unsigned DEFAULT NULL,
  `unidad_medida_id` smallint(5) unsigned NOT NULL,
  `impuesto_id` smallint(5) unsigned DEFAULT NULL,
  `nombre` varchar(160) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `grosor_calibre` varchar(30) DEFAULT NULL,
  `precio_kg` decimal(12,2) DEFAULT NULL,
  `multipresentacion` tinyint(1) NOT NULL DEFAULT 0,
  `por_lotes` tinyint(1) NOT NULL DEFAULT 0,
  `destacado` tinyint(1) NOT NULL DEFAULT 0,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `unidad_medida_id` (`unidad_medida_id`),
  KEY `impuesto_id` (`impuesto_id`),
  KEY `idx_productos_categoria` (`categoria_id`),
  KEY `idx_productos_linea` (`linea_id`),
  CONSTRAINT `fk_productos_linea` FOREIGN KEY (`linea_id`) REFERENCES `lineas` (`id`),
  CONSTRAINT `productos_ibfk_1` FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`),
  CONSTRAINT `productos_ibfk_4` FOREIGN KEY (`unidad_medida_id`) REFERENCES `unidades_medida` (`id`),
  CONSTRAINT `productos_ibfk_5` FOREIGN KEY (`impuesto_id`) REFERENCES `impuestos` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: producto_variantes ----------
DROP TABLE IF EXISTS `producto_variantes`;
CREATE TABLE `producto_variantes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `producto_id` bigint(20) unsigned NOT NULL,
  `sku` varchar(60) NOT NULL,
  `codigo_barras` varchar(60) DEFAULT NULL,
  `presentacion` varchar(40) DEFAULT NULL,
  `lote` varchar(40) DEFAULT NULL,
  `tipo_presentacion` varchar(10) NOT NULL DEFAULT 'simple',
  `peso_kg` decimal(12,3) DEFAULT NULL,
  `origen_variante_id` bigint(20) unsigned DEFAULT NULL,
  `piezas_por_origen` int(10) unsigned DEFAULT NULL,
  `modo_precio` varchar(10) NOT NULL DEFAULT 'manual',
  `precio` decimal(12,2) NOT NULL,
  `precio_oferta` decimal(12,2) DEFAULT NULL,
  `costo` decimal(12,2) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `sku` (`sku`),
  UNIQUE KEY `codigo_barras` (`codigo_barras`),
  KEY `idx_variantes_producto` (`producto_id`),
  KEY `idx_variantes_origen` (`origen_variante_id`),
  KEY `idx_variantes_lote` (`lote`),
  CONSTRAINT `fk_variantes_origen` FOREIGN KEY (`origen_variante_id`) REFERENCES `producto_variantes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `producto_variantes_ibfk_1` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_variantes_modo_precio` CHECK (`modo_precio` in (_utf8mb4'manual',_utf8mb4'calculado')),
  CONSTRAINT `chk_variantes_tipo` CHECK (`tipo_presentacion` in (_utf8mb4'simple',_utf8mb4'paquete',_utf8mb4'cono')),
  CONSTRAINT `producto_variantes_chk_1` CHECK (`precio` >= 0),
  CONSTRAINT `producto_variantes_chk_2` CHECK (`precio_oferta` >= 0),
  CONSTRAINT `producto_variantes_chk_3` CHECK (`costo` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: variante_codigos ----------
DROP TABLE IF EXISTS `variante_codigos`;
CREATE TABLE `variante_codigos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `variante_id` bigint(20) unsigned NOT NULL,
  `codigo` varchar(60) NOT NULL,
  `peso_kg` decimal(12,3) DEFAULT NULL,
  `lote` varchar(40) DEFAULT NULL,
  `conos` int(10) unsigned DEFAULT NULL,
  `estado` varchar(12) NOT NULL DEFAULT 'disponible',
  `almacen_id` smallint(5) unsigned DEFAULT NULL,
  `consumido_en` datetime DEFAULT NULL,
  `consumido_tipo` varchar(20) DEFAULT NULL,
  `consumido_id` bigint(20) unsigned DEFAULT NULL,
  `remesa_id` bigint(20) unsigned DEFAULT NULL,
  `etiqueta` varchar(60) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `codigo` (`codigo`),
  KEY `idx_variante_codigos_variante` (`variante_id`),
  KEY `idx_variante_codigos_lote` (`lote`),
  KEY `idx_variante_codigos_remesa` (`remesa_id`),
  KEY `idx_variante_codigos_estado` (`estado`),
  KEY `idx_variante_codigos_almacen` (`almacen_id`),
  CONSTRAINT `fk_variante_codigos_almacen` FOREIGN KEY (`almacen_id`) REFERENCES `almacenes` (`id`),
  CONSTRAINT `variante_codigos_ibfk_1` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `variante_codigos_chk_1` CHECK (`estado` in (_utf8mb4'disponible',_utf8mb4'vendido',_utf8mb4'desarmado'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: variante_precios ----------
DROP TABLE IF EXISTS `variante_precios`;
CREATE TABLE `variante_precios` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `variante_id` bigint(20) unsigned NOT NULL,
  `tipo_cliente_id` smallint(5) unsigned NOT NULL,
  `precio` decimal(12,2) NOT NULL,
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `variante_id` (`variante_id`,`tipo_cliente_id`),
  KEY `tipo_cliente_id` (`tipo_cliente_id`),
  CONSTRAINT `variante_precios_ibfk_1` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `variante_precios_ibfk_2` FOREIGN KEY (`tipo_cliente_id`) REFERENCES `tipos_cliente` (`id`) ON DELETE CASCADE,
  CONSTRAINT `variante_precios_chk_1` CHECK (`precio` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  MÓDULO 3 · COMPRAS, PROVEEDORES Y RECEPCIÓN
-- ---------------------------------------------------------------------

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

-- ---------- Tabla: ordenes_compra ----------
DROP TABLE IF EXISTS `ordenes_compra`;
CREATE TABLE `ordenes_compra` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `proveedor_id` bigint(20) unsigned NOT NULL,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `folio` varchar(40) NOT NULL,
  `estado` varchar(20) NOT NULL DEFAULT 'pendiente',
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
  CONSTRAINT `ordenes_compra_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `ordenes_compra_chk_1` CHECK (`estado` in (_utf8mb4'pendiente',_utf8mb4'recibida',_utf8mb4'parcial',_utf8mb4'cancelada'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: orden_compra_detalle ----------
DROP TABLE IF EXISTS `orden_compra_detalle`;
CREATE TABLE `orden_compra_detalle` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `orden_compra_id` bigint(20) unsigned NOT NULL,
  `variante_id` bigint(20) unsigned NOT NULL,
  `cantidad` decimal(12,3) NOT NULL,
  `cantidad_recibida` decimal(12,3) NOT NULL DEFAULT 0.000,
  `costo_unitario` decimal(12,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `variante_id` (`variante_id`),
  KEY `idx_oc_detalle_orden` (`orden_compra_id`),
  CONSTRAINT `orden_compra_detalle_ibfk_1` FOREIGN KEY (`orden_compra_id`) REFERENCES `ordenes_compra` (`id`) ON DELETE CASCADE,
  CONSTRAINT `orden_compra_detalle_ibfk_2` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`),
  CONSTRAINT `orden_compra_detalle_chk_1` CHECK (`cantidad` > 0),
  CONSTRAINT `orden_compra_detalle_chk_2` CHECK (`costo_unitario` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: remesas ----------
DROP TABLE IF EXISTS `remesas`;
CREATE TABLE `remesas` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `folio` varchar(40) NOT NULL,
  `variante_id` bigint(20) unsigned NOT NULL,
  `almacen_id` smallint(5) unsigned NOT NULL,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `num_bultos` int(10) unsigned NOT NULL,
  `kg_total` decimal(12,3) NOT NULL,
  `lotes` varchar(255) DEFAULT NULL,
  `archivo` varchar(255) DEFAULT NULL,
  `notas` text DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `folio` (`folio`),
  KEY `almacen_id` (`almacen_id`),
  KEY `usuario_id` (`usuario_id`),
  KEY `idx_remesas_variante` (`variante_id`),
  KEY `idx_remesas_fecha` (`creado_en`),
  CONSTRAINT `remesas_ibfk_1` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`),
  CONSTRAINT `remesas_ibfk_2` FOREIGN KEY (`almacen_id`) REFERENCES `almacenes` (`id`),
  CONSTRAINT `remesas_ibfk_3` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `remesas_chk_1` CHECK (`kg_total` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  MÓDULO 4 · INVENTARIO MULTI-ALMACÉN
-- ---------------------------------------------------------------------

-- ---------- Tabla: almacenes ----------
DROP TABLE IF EXISTS `almacenes`;
CREATE TABLE `almacenes` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `direccion` varchar(255) DEFAULT NULL,
  `es_punto_venta` tinyint(1) NOT NULL DEFAULT 0,
  `es_tienda_linea` tinyint(1) NOT NULL DEFAULT 0,
  `es_matriz` tinyint(1) NOT NULL DEFAULT 0,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: inventario ----------
DROP TABLE IF EXISTS `inventario`;
CREATE TABLE `inventario` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `variante_id` bigint(20) unsigned NOT NULL,
  `almacen_id` smallint(5) unsigned NOT NULL,
  `cantidad` decimal(12,3) NOT NULL DEFAULT 0.000,
  `cantidad_reservada` decimal(12,3) NOT NULL DEFAULT 0.000,
  `stock_minimo` decimal(12,3) NOT NULL DEFAULT 0.000,
  `stock_maximo` decimal(12,3) DEFAULT NULL,
  `ubicacion_fisica` varchar(60) DEFAULT NULL,
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `variante_id` (`variante_id`,`almacen_id`),
  KEY `almacen_id` (`almacen_id`),
  KEY `idx_inventario_variante` (`variante_id`),
  CONSTRAINT `inventario_ibfk_1` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inventario_ibfk_2` FOREIGN KEY (`almacen_id`) REFERENCES `almacenes` (`id`),
  CONSTRAINT `inventario_chk_1` CHECK (`cantidad` >= 0),
  CONSTRAINT `inventario_chk_2` CHECK (`cantidad_reservada` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: movimientos_inventario ----------
DROP TABLE IF EXISTS `movimientos_inventario`;
CREATE TABLE `movimientos_inventario` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `variante_id` bigint(20) unsigned NOT NULL,
  `almacen_id` smallint(5) unsigned NOT NULL,
  `tipo` varchar(20) NOT NULL,
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
  CONSTRAINT `movimientos_inventario_ibfk_3` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `movimientos_inventario_chk_1` CHECK (`tipo` in (_utf8mb4'entrada',_utf8mb4'salida',_utf8mb4'ajuste',_utf8mb4'transferencia',_utf8mb4'devolucion',_utf8mb4'merma'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: traspasos ----------
DROP TABLE IF EXISTS `traspasos`;
CREATE TABLE `traspasos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `folio` varchar(40) NOT NULL,
  `almacen_origen_id` smallint(5) unsigned NOT NULL,
  `almacen_destino_id` smallint(5) unsigned NOT NULL,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `notas` text DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `folio` (`folio`),
  KEY `almacen_origen_id` (`almacen_origen_id`),
  KEY `usuario_id` (`usuario_id`),
  KEY `idx_traspasos_destino` (`almacen_destino_id`),
  KEY `idx_traspasos_fecha` (`creado_en`),
  CONSTRAINT `traspasos_ibfk_1` FOREIGN KEY (`almacen_origen_id`) REFERENCES `almacenes` (`id`),
  CONSTRAINT `traspasos_ibfk_2` FOREIGN KEY (`almacen_destino_id`) REFERENCES `almacenes` (`id`),
  CONSTRAINT `traspasos_ibfk_3` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: traspaso_detalle ----------
DROP TABLE IF EXISTS `traspaso_detalle`;
CREATE TABLE `traspaso_detalle` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `traspaso_id` bigint(20) unsigned NOT NULL,
  `variante_id` bigint(20) unsigned NOT NULL,
  `paquetes` decimal(12,3) DEFAULT NULL,
  `cantidad` decimal(12,3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `variante_id` (`variante_id`),
  KEY `idx_traspaso_detalle_traspaso` (`traspaso_id`),
  CONSTRAINT `traspaso_detalle_ibfk_1` FOREIGN KEY (`traspaso_id`) REFERENCES `traspasos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `traspaso_detalle_ibfk_2` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`),
  CONSTRAINT `traspaso_detalle_chk_1` CHECK (`cantidad` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: variante_conversiones ----------
DROP TABLE IF EXISTS `variante_conversiones`;
CREATE TABLE `variante_conversiones` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `variante_origen_id` bigint(20) unsigned NOT NULL,
  `variante_destino_id` bigint(20) unsigned NOT NULL,
  `almacen_origen_id` smallint(5) unsigned NOT NULL,
  `almacen_destino_id` smallint(5) unsigned NOT NULL,
  `paquetes` decimal(12,3) NOT NULL,
  `kg_consumidos` decimal(12,3) NOT NULL,
  `destare_kg` decimal(12,3) DEFAULT NULL,
  `piezas_generadas` decimal(12,3) NOT NULL,
  `codigo_bulto` varchar(60) DEFAULT NULL,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `motivo` varchar(255) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `variante_destino_id` (`variante_destino_id`),
  KEY `almacen_origen_id` (`almacen_origen_id`),
  KEY `almacen_destino_id` (`almacen_destino_id`),
  KEY `usuario_id` (`usuario_id`),
  KEY `idx_conversiones_origen` (`variante_origen_id`),
  KEY `idx_conversiones_fecha` (`creado_en`),
  KEY `idx_conversiones_bulto` (`codigo_bulto`),
  CONSTRAINT `variante_conversiones_ibfk_1` FOREIGN KEY (`variante_origen_id`) REFERENCES `producto_variantes` (`id`),
  CONSTRAINT `variante_conversiones_ibfk_2` FOREIGN KEY (`variante_destino_id`) REFERENCES `producto_variantes` (`id`),
  CONSTRAINT `variante_conversiones_ibfk_3` FOREIGN KEY (`almacen_origen_id`) REFERENCES `almacenes` (`id`),
  CONSTRAINT `variante_conversiones_ibfk_4` FOREIGN KEY (`almacen_destino_id`) REFERENCES `almacenes` (`id`),
  CONSTRAINT `variante_conversiones_ibfk_5` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `variante_conversiones_chk_1` CHECK (`paquetes` > 0),
  CONSTRAINT `variante_conversiones_chk_2` CHECK (`kg_consumidos` > 0),
  CONSTRAINT `variante_conversiones_chk_3` CHECK (`piezas_generadas` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  MÓDULO 5 · CLIENTES Y TIENDA EN LÍNEA
-- ---------------------------------------------------------------------

-- ---------- Tabla: tipos_cliente ----------
DROP TABLE IF EXISTS `tipos_cliente`;
CREATE TABLE `tipos_cliente` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(60) NOT NULL,
  `es_publico` tinyint(1) NOT NULL DEFAULT 0,
  `orden` smallint(6) NOT NULL DEFAULT 0,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: direcciones ----------
DROP TABLE IF EXISTS `direcciones`;
CREATE TABLE `direcciones` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `cliente_id` bigint(20) unsigned NOT NULL,
  `tipo` varchar(15) NOT NULL DEFAULT 'envio',
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
  CONSTRAINT `direcciones_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `direcciones_chk_1` CHECK (`tipo` in (_utf8mb4'envio',_utf8mb4'facturacion'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  `cantidad` decimal(12,3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `carrito_id` (`carrito_id`,`variante_id`),
  KEY `variante_id` (`variante_id`),
  CONSTRAINT `carrito_items_ibfk_1` FOREIGN KEY (`carrito_id`) REFERENCES `carritos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `carrito_items_ibfk_2` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`),
  CONSTRAINT `carrito_items_chk_1` CHECK (`cantidad` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- ---------- Tabla: resenas ----------
DROP TABLE IF EXISTS `resenas`;
CREATE TABLE `resenas` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `producto_id` bigint(20) unsigned NOT NULL,
  `cliente_id` bigint(20) unsigned DEFAULT NULL,
  `calificacion` tinyint(4) NOT NULL,
  `comentario` text DEFAULT NULL,
  `aprobada` tinyint(1) NOT NULL DEFAULT 0,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `cliente_id` (`cliente_id`),
  KEY `idx_resenas_producto` (`producto_id`),
  CONSTRAINT `resenas_ibfk_1` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `resenas_ibfk_2` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `resenas_chk_1` CHECK (`calificacion` between 1 and 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: cupones ----------
DROP TABLE IF EXISTS `cupones`;
CREATE TABLE `cupones` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `codigo` varchar(40) NOT NULL,
  `tipo` varchar(15) NOT NULL,
  `valor` decimal(12,2) NOT NULL,
  `compra_minima` decimal(12,2) NOT NULL DEFAULT 0.00,
  `usos_maximos` int(11) DEFAULT NULL,
  `usos_actuales` int(11) NOT NULL DEFAULT 0,
  `fecha_inicio` date DEFAULT NULL,
  `fecha_fin` date DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `codigo` (`codigo`),
  CONSTRAINT `cupones_chk_1` CHECK (`tipo` in (_utf8mb4'porcentaje',_utf8mb4'monto_fijo')),
  CONSTRAINT `cupones_chk_2` CHECK (`valor` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  MÓDULO 6 · CAJA Y PUNTO DE VENTA
-- ---------------------------------------------------------------------

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
  `estado` varchar(10) NOT NULL DEFAULT 'abierta',
  `fecha_apertura` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_cierre` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `caja_id` (`caja_id`),
  KEY `idx_sesiones_caja_usuario` (`usuario_id`),
  CONSTRAINT `sesiones_caja_ibfk_1` FOREIGN KEY (`caja_id`) REFERENCES `cajas` (`id`),
  CONSTRAINT `sesiones_caja_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `sesiones_caja_chk_1` CHECK (`estado` in (_utf8mb4'abierta',_utf8mb4'cerrada'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: movimientos_caja ----------
DROP TABLE IF EXISTS `movimientos_caja`;
CREATE TABLE `movimientos_caja` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `sesion_caja_id` bigint(20) unsigned NOT NULL,
  `tipo` varchar(15) NOT NULL,
  `monto` decimal(12,2) NOT NULL,
  `referencia_id` bigint(20) unsigned DEFAULT NULL,
  `motivo` varchar(255) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_movcaja_sesion` (`sesion_caja_id`),
  CONSTRAINT `movimientos_caja_ibfk_1` FOREIGN KEY (`sesion_caja_id`) REFERENCES `sesiones_caja` (`id`) ON DELETE CASCADE,
  CONSTRAINT `movimientos_caja_chk_1` CHECK (`tipo` in (_utf8mb4'venta',_utf8mb4'ingreso',_utf8mb4'retiro',_utf8mb4'devolucion'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  MÓDULO 7 · VENTAS (PEDIDOS, PAGOS, ENVÍOS)
-- ---------------------------------------------------------------------

-- ---------- Tabla: metodos_pago ----------
DROP TABLE IF EXISTS `metodos_pago`;
CREATE TABLE `metodos_pago` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(40) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: paqueterias ----------
DROP TABLE IF EXISTS `paqueterias`;
CREATE TABLE `paqueterias` (
  `id` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(60) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: pedidos ----------
DROP TABLE IF EXISTS `pedidos`;
CREATE TABLE `pedidos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `numero_pedido` varchar(40) NOT NULL,
  `canal` varchar(15) NOT NULL,
  `cliente_id` bigint(20) unsigned DEFAULT NULL,
  `tipo_cliente_id` smallint(5) unsigned DEFAULT NULL,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `sesion_caja_id` bigint(20) unsigned DEFAULT NULL,
  `almacen_id` smallint(5) unsigned DEFAULT NULL,
  `direccion_envio_id` bigint(20) unsigned DEFAULT NULL,
  `cupon_id` bigint(20) unsigned DEFAULT NULL,
  `estado` varchar(20) NOT NULL DEFAULT 'pendiente',
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
  KEY `fk_pedidos_tipo_cliente` (`tipo_cliente_id`),
  CONSTRAINT `fk_pedidos_tipo_cliente` FOREIGN KEY (`tipo_cliente_id`) REFERENCES `tipos_cliente` (`id`),
  CONSTRAINT `pedidos_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`),
  CONSTRAINT `pedidos_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `pedidos_ibfk_3` FOREIGN KEY (`sesion_caja_id`) REFERENCES `sesiones_caja` (`id`),
  CONSTRAINT `pedidos_ibfk_4` FOREIGN KEY (`almacen_id`) REFERENCES `almacenes` (`id`),
  CONSTRAINT `pedidos_ibfk_5` FOREIGN KEY (`direccion_envio_id`) REFERENCES `direcciones` (`id`),
  CONSTRAINT `pedidos_ibfk_6` FOREIGN KEY (`cupon_id`) REFERENCES `cupones` (`id`),
  CONSTRAINT `pedidos_chk_1` CHECK (`canal` in (_utf8mb4'tienda_linea',_utf8mb4'punto_venta')),
  CONSTRAINT `pedidos_chk_2` CHECK (`estado` in (_utf8mb4'pendiente',_utf8mb4'pagado',_utf8mb4'en_preparacion',_utf8mb4'enviado',_utf8mb4'entregado',_utf8mb4'cancelado',_utf8mb4'devuelto'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: pedido_detalle ----------
DROP TABLE IF EXISTS `pedido_detalle`;
CREATE TABLE `pedido_detalle` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `pedido_id` bigint(20) unsigned NOT NULL,
  `variante_id` bigint(20) unsigned NOT NULL,
  `descripcion` varchar(200) NOT NULL,
  `cantidad` decimal(12,3) NOT NULL,
  `precio_unitario` decimal(12,2) NOT NULL,
  `descuento` decimal(12,2) NOT NULL DEFAULT 0.00,
  `impuesto` decimal(12,2) NOT NULL DEFAULT 0.00,
  `subtotal` decimal(12,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `variante_id` (`variante_id`),
  KEY `idx_pedido_detalle_pedido` (`pedido_id`),
  CONSTRAINT `pedido_detalle_ibfk_1` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `pedido_detalle_ibfk_2` FOREIGN KEY (`variante_id`) REFERENCES `producto_variantes` (`id`),
  CONSTRAINT `pedido_detalle_chk_1` CHECK (`cantidad` > 0),
  CONSTRAINT `pedido_detalle_chk_2` CHECK (`precio_unitario` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: pedido_detalle_bultos ----------
DROP TABLE IF EXISTS `pedido_detalle_bultos`;
CREATE TABLE `pedido_detalle_bultos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `detalle_id` bigint(20) unsigned NOT NULL,
  `variante_codigo_id` bigint(20) unsigned DEFAULT NULL,
  `codigo` varchar(60) NOT NULL,
  `peso_kg` decimal(12,3) NOT NULL,
  `lote` varchar(40) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `variante_codigo_id` (`variante_codigo_id`),
  KEY `idx_pdb_detalle` (`detalle_id`),
  KEY `idx_pdb_codigo` (`codigo`),
  KEY `idx_pdb_lote` (`lote`),
  CONSTRAINT `pedido_detalle_bultos_ibfk_1` FOREIGN KEY (`detalle_id`) REFERENCES `pedido_detalle` (`id`) ON DELETE CASCADE,
  CONSTRAINT `pedido_detalle_bultos_ibfk_2` FOREIGN KEY (`variante_codigo_id`) REFERENCES `variante_codigos` (`id`) ON DELETE SET NULL,
  CONSTRAINT `pedido_detalle_bultos_chk_1` CHECK (`peso_kg` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: pagos ----------
DROP TABLE IF EXISTS `pagos`;
CREATE TABLE `pagos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `pedido_id` bigint(20) unsigned NOT NULL,
  `metodo_pago_id` smallint(5) unsigned NOT NULL,
  `monto` decimal(12,2) NOT NULL,
  `estado` varchar(15) NOT NULL DEFAULT 'completado',
  `referencia_transaccion` varchar(120) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `metodo_pago_id` (`metodo_pago_id`),
  KEY `idx_pagos_pedido` (`pedido_id`),
  CONSTRAINT `pagos_ibfk_1` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `pagos_ibfk_2` FOREIGN KEY (`metodo_pago_id`) REFERENCES `metodos_pago` (`id`),
  CONSTRAINT `pagos_chk_1` CHECK (`monto` > 0),
  CONSTRAINT `pagos_chk_2` CHECK (`estado` in (_utf8mb4'pendiente',_utf8mb4'procesando',_utf8mb4'completado',_utf8mb4'fallido',_utf8mb4'reembolsado'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: envios ----------
DROP TABLE IF EXISTS `envios`;
CREATE TABLE `envios` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `pedido_id` bigint(20) unsigned NOT NULL,
  `paqueteria_id` smallint(5) unsigned DEFAULT NULL,
  `numero_guia` varchar(80) DEFAULT NULL,
  `costo` decimal(12,2) NOT NULL DEFAULT 0.00,
  `estado` varchar(20) NOT NULL DEFAULT 'preparando',
  `fecha_envio` datetime DEFAULT NULL,
  `fecha_entrega_estimada` date DEFAULT NULL,
  `fecha_entrega_real` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `paqueteria_id` (`paqueteria_id`),
  KEY `idx_envios_pedido` (`pedido_id`),
  CONSTRAINT `envios_ibfk_1` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `envios_ibfk_2` FOREIGN KEY (`paqueteria_id`) REFERENCES `paqueterias` (`id`),
  CONSTRAINT `envios_chk_1` CHECK (`estado` in (_utf8mb4'preparando',_utf8mb4'enviado',_utf8mb4'en_transito',_utf8mb4'entregado',_utf8mb4'devuelto'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  MÓDULO 8 · NÓMINA
-- ---------------------------------------------------------------------

-- ---------- Tabla: nomina_empleados ----------
DROP TABLE IF EXISTS `nomina_empleados`;
CREATE TABLE `nomina_empleados` (
  `usuario_id` bigint(20) unsigned NOT NULL,
  `sueldo_base_semanal` decimal(12,2) NOT NULL DEFAULT 0.00,
  `paga_comision` tinyint(1) NOT NULL DEFAULT 0,
  `porcentaje_comision` decimal(5,2) NOT NULL DEFAULT 0.00,
  `valor_hora_extra` decimal(12,2) NOT NULL DEFAULT 0.00,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`usuario_id`),
  CONSTRAINT `nomina_empleados_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `nomina_empleados_chk_1` CHECK (`sueldo_base_semanal` >= 0),
  CONSTRAINT `nomina_empleados_chk_2` CHECK (`porcentaje_comision` >= 0 and `porcentaje_comision` <= 100),
  CONSTRAINT `nomina_empleados_chk_3` CHECK (`valor_hora_extra` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: nomina_periodos ----------
DROP TABLE IF EXISTS `nomina_periodos`;
CREATE TABLE `nomina_periodos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date NOT NULL,
  `fecha_pago` date NOT NULL,
  `estado` varchar(15) NOT NULL DEFAULT 'borrador',
  `notas` text DEFAULT NULL,
  `creado_por` bigint(20) unsigned DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `fecha_inicio` (`fecha_inicio`),
  KEY `creado_por` (`creado_por`),
  KEY `idx_nomina_periodos_pago` (`fecha_pago`),
  CONSTRAINT `nomina_periodos_ibfk_1` FOREIGN KEY (`creado_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `nomina_periodos_chk_1` CHECK (`estado` in (_utf8mb4'borrador',_utf8mb4'pagado',_utf8mb4'cancelado'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: nomina_recibos ----------
DROP TABLE IF EXISTS `nomina_recibos`;
CREATE TABLE `nomina_recibos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `periodo_id` bigint(20) unsigned NOT NULL,
  `usuario_id` bigint(20) unsigned NOT NULL,
  `sueldo_base` decimal(12,2) NOT NULL DEFAULT 0.00,
  `num_pedidos` int(10) unsigned NOT NULL DEFAULT 0,
  `ventas_netas` decimal(12,2) NOT NULL DEFAULT 0.00,
  `porcentaje_comision` decimal(5,2) NOT NULL DEFAULT 0.00,
  `comision` decimal(12,2) NOT NULL DEFAULT 0.00,
  `otras_percepciones` decimal(12,2) NOT NULL DEFAULT 0.00,
  `deducciones` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total_pagar` decimal(12,2) NOT NULL DEFAULT 0.00,
  `notas` text DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `periodo_id` (`periodo_id`,`usuario_id`),
  KEY `idx_nomina_recibos_usuario` (`usuario_id`),
  CONSTRAINT `nomina_recibos_ibfk_1` FOREIGN KEY (`periodo_id`) REFERENCES `nomina_periodos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `nomina_recibos_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: nomina_recibo_conceptos ----------
DROP TABLE IF EXISTS `nomina_recibo_conceptos`;
CREATE TABLE `nomina_recibo_conceptos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `recibo_id` bigint(20) unsigned NOT NULL,
  `tipo` varchar(12) NOT NULL,
  `clave` varchar(20) NOT NULL,
  `descripcion` varchar(200) DEFAULT NULL,
  `cantidad` decimal(10,2) DEFAULT NULL,
  `importe` decimal(12,2) NOT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_nomina_conceptos_recibo` (`recibo_id`),
  CONSTRAINT `nomina_recibo_conceptos_ibfk_1` FOREIGN KEY (`recibo_id`) REFERENCES `nomina_recibos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `nomina_recibo_conceptos_chk_1` CHECK (`tipo` in (_utf8mb4'percepcion',_utf8mb4'deduccion')),
  CONSTRAINT `nomina_recibo_conceptos_chk_2` CHECK (`clave` in (_utf8mb4'horas_extra',_utf8mb4'falta',_utf8mb4'descuento',_utf8mb4'otro')),
  CONSTRAINT `nomina_recibo_conceptos_chk_3` CHECK (`importe` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP VIEW IF EXISTS `v_ventas_por_empleado`;
DROP VIEW IF EXISTS `v_mas_vendidos`;
DROP VIEW IF EXISTS `v_alertas_stock`;
DROP VIEW IF EXISTS `v_stock_disponible`;

-- ---------------------------------------------------------------------
--  VISTAS DE REPORTES
-- ---------------------------------------------------------------------

-- ---------- Vista: v_stock_disponible ----------
CREATE OR REPLACE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_stock_disponible` AS select `i`.`variante_id` AS `variante_id`,`pv`.`sku` AS `sku`,`p`.`nombre` AS `producto`,`a`.`nombre` AS `almacen`,`i`.`cantidad` AS `cantidad`,`i`.`cantidad_reservada` AS `cantidad_reservada`,`i`.`cantidad` - `i`.`cantidad_reservada` AS `disponible`,`i`.`stock_minimo` AS `stock_minimo` from (((`inventario` `i` join `producto_variantes` `pv` on(`pv`.`id` = `i`.`variante_id`)) join `productos` `p` on(`p`.`id` = `pv`.`producto_id`)) join `almacenes` `a` on(`a`.`id` = `i`.`almacen_id`));

-- ---------- Vista: v_alertas_stock ----------
CREATE OR REPLACE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_alertas_stock` AS select `v_stock_disponible`.`variante_id` AS `variante_id`,`v_stock_disponible`.`sku` AS `sku`,`v_stock_disponible`.`producto` AS `producto`,`v_stock_disponible`.`almacen` AS `almacen`,`v_stock_disponible`.`cantidad` AS `cantidad`,`v_stock_disponible`.`cantidad_reservada` AS `cantidad_reservada`,`v_stock_disponible`.`disponible` AS `disponible`,`v_stock_disponible`.`stock_minimo` AS `stock_minimo` from `v_stock_disponible` where `v_stock_disponible`.`disponible` <= `v_stock_disponible`.`stock_minimo`;

-- ---------- Vista: v_mas_vendidos ----------
CREATE OR REPLACE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_mas_vendidos` AS select `pv`.`id` AS `variante_id`,`pv`.`sku` AS `sku`,`p`.`nombre` AS `producto`,sum(`pd`.`cantidad`) AS `unidades_vendidas`,sum(`pd`.`subtotal`) AS `ingresos` from (((`pedido_detalle` `pd` join `producto_variantes` `pv` on(`pv`.`id` = `pd`.`variante_id`)) join `productos` `p` on(`p`.`id` = `pv`.`producto_id`)) join `pedidos` `ped` on(`ped`.`id` = `pd`.`pedido_id`)) where `ped`.`estado` not in ('cancelado','devuelto') group by `pv`.`id`,`pv`.`sku`,`p`.`nombre`;

-- ---------- Vista: v_ventas_por_empleado ----------
CREATE OR REPLACE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_ventas_por_empleado` AS select `p`.`usuario_id` AS `usuario_id`,`u`.`nombre` AS `usuario`,cast(`p`.`creado_en` as date) AS `dia`,count(0) AS `num_pedidos`,coalesce(sum(`p`.`subtotal` - `p`.`descuento`),0) AS `venta_neta`,coalesce(sum(`p`.`total`),0) AS `venta_total` from (`pedidos` `p` join `usuarios` `u` on(`u`.`id` = `p`.`usuario_id`)) where `p`.`usuario_id` is not null and `p`.`estado` not in ('cancelado','devuelto') group by `p`.`usuario_id`,`u`.`nombre`,cast(`p`.`creado_en` as date);

SET FOREIGN_KEY_CHECKS = 1;
