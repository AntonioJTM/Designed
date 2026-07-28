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

CREATE TABLE producto_imagenes (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    producto_id  BIGINT UNSIGNED NOT NULL,
    variante_id  BIGINT UNSIGNED,
    url          VARCHAR(255) NOT NULL,
    es_principal BOOLEAN NOT NULL DEFAULT FALSE,
    orden        SMALLINT DEFAULT 0,
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id) ON DELETE CASCADE,
    INDEX idx_imagenes_producto (producto_id)
) ENGINE=InnoDB;

-- Códigos de barras adicionales por variante (varios paquetes/lotes del mismo
-- color con códigos distintos, agrupados en la misma variante). El código
-- principal sigue en producto_variantes.codigo_barras; el stock no se separa por lote.
CREATE TABLE variante_codigos (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    variante_id BIGINT UNSIGNED NOT NULL,
    codigo      VARCHAR(60) NOT NULL UNIQUE,
    etiqueta    VARCHAR(60),
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id) ON DELETE CASCADE,
    INDEX idx_variante_codigos_variante (variante_id)
) ENGINE=InnoDB;

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

CREATE TABLE almacenes (
    id             SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre         VARCHAR(100) NOT NULL UNIQUE,
    direccion      VARCHAR(255),
    es_punto_venta BOOLEAN NOT NULL DEFAULT FALSE,
    activo         BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE inventario (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    variante_id        BIGINT UNSIGNED NOT NULL,
    almacen_id         SMALLINT UNSIGNED NOT NULL,
    cantidad           DECIMAL(12,3) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
    cantidad_reservada DECIMAL(12,3) NOT NULL DEFAULT 0 CHECK (cantidad_reservada >= 0),
    stock_minimo       DECIMAL(12,3) NOT NULL DEFAULT 0,
    stock_maximo       DECIMAL(12,3),
    ubicacion_fisica   VARCHAR(60),
    actualizado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE (variante_id, almacen_id),
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id) ON DELETE CASCADE,
    FOREIGN KEY (almacen_id)  REFERENCES almacenes(id),
    INDEX idx_inventario_variante (variante_id)
) ENGINE=InnoDB;

CREATE TABLE movimientos_inventario (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    variante_id     BIGINT UNSIGNED NOT NULL,
    almacen_id      SMALLINT UNSIGNED NOT NULL,
    tipo            VARCHAR(20) NOT NULL
                      CHECK (tipo IN ('entrada','salida','ajuste','transferencia','devolucion','merma')),
    cantidad        DECIMAL(12,3) NOT NULL,
    costo_unitario  DECIMAL(12,2),
    referencia_tipo VARCHAR(30),
    referencia_id   BIGINT UNSIGNED,
    usuario_id      BIGINT UNSIGNED,
    motivo          VARCHAR(255),
    creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id),
    FOREIGN KEY (almacen_id)  REFERENCES almacenes(id),
    FOREIGN KEY (usuario_id)  REFERENCES usuarios(id),
    INDEX idx_movinv_variante (variante_id),
    INDEX idx_movinv_fecha (creado_en)
) ENGINE=InnoDB;

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

CREATE TABLE pedidos (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    numero_pedido      VARCHAR(40) NOT NULL UNIQUE,
    canal              VARCHAR(15) NOT NULL
                         CHECK (canal IN ('tienda_linea','punto_venta')),
    cliente_id         BIGINT UNSIGNED,
    usuario_id         BIGINT UNSIGNED,
    sesion_caja_id     BIGINT UNSIGNED,
    almacen_id         SMALLINT UNSIGNED,
    direccion_envio_id BIGINT UNSIGNED,
    cupon_id           BIGINT UNSIGNED,
    estado             VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                         CHECK (estado IN ('pendiente','pagado','en_preparacion',
                                           'enviado','entregado','cancelado','devuelto')),
    subtotal           DECIMAL(12,2) NOT NULL DEFAULT 0,
    descuento          DECIMAL(12,2) NOT NULL DEFAULT 0,
    impuestos          DECIMAL(12,2) NOT NULL DEFAULT 0,
    costo_envio        DECIMAL(12,2) NOT NULL DEFAULT 0,
    total              DECIMAL(12,2) NOT NULL DEFAULT 0,
    notas              TEXT,
    creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id)         REFERENCES clientes(id),
    FOREIGN KEY (usuario_id)         REFERENCES usuarios(id),
    FOREIGN KEY (sesion_caja_id)     REFERENCES sesiones_caja(id),
    FOREIGN KEY (almacen_id)         REFERENCES almacenes(id),
    FOREIGN KEY (direccion_envio_id) REFERENCES direcciones(id),
    FOREIGN KEY (cupon_id)           REFERENCES cupones(id),
    INDEX idx_pedidos_cliente (cliente_id),
    INDEX idx_pedidos_estado (estado),
    INDEX idx_pedidos_fecha (creado_en)
) ENGINE=InnoDB;

CREATE TABLE pedido_detalle (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pedido_id       BIGINT UNSIGNED NOT NULL,
    variante_id     BIGINT UNSIGNED NOT NULL,
    descripcion     VARCHAR(200) NOT NULL,
    cantidad        DECIMAL(12,3) NOT NULL CHECK (cantidad > 0),
    precio_unitario DECIMAL(12,2) NOT NULL CHECK (precio_unitario >= 0),
    descuento       DECIMAL(12,2) NOT NULL DEFAULT 0,
    impuesto        DECIMAL(12,2) NOT NULL DEFAULT 0,
    subtotal        DECIMAL(12,2) NOT NULL,
    FOREIGN KEY (pedido_id)   REFERENCES pedidos(id) ON DELETE CASCADE,
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id),
    INDEX idx_pedido_detalle_pedido (pedido_id)
) ENGINE=InnoDB;

CREATE TABLE pagos (
    id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pedido_id              BIGINT UNSIGNED NOT NULL,
    metodo_pago_id         SMALLINT UNSIGNED NOT NULL,
    monto                  DECIMAL(12,2) NOT NULL CHECK (monto > 0),
    estado                 VARCHAR(15) NOT NULL DEFAULT 'completado'
                             CHECK (estado IN ('pendiente','procesando','completado','fallido','reembolsado')),
    referencia_transaccion VARCHAR(120),
    creado_en              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pedido_id)      REFERENCES pedidos(id) ON DELETE CASCADE,
    FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago(id),
    INDEX idx_pagos_pedido (pedido_id)
) ENGINE=InnoDB;

CREATE TABLE envios (
    id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pedido_id              BIGINT UNSIGNED NOT NULL,
    paqueteria_id          SMALLINT UNSIGNED,
    numero_guia            VARCHAR(80),
    costo                  DECIMAL(12,2) NOT NULL DEFAULT 0,
    estado                 VARCHAR(20) NOT NULL DEFAULT 'preparando'
                             CHECK (estado IN ('preparando','enviado','en_transito','entregado','devuelto')),
    fecha_envio            DATETIME,
    fecha_entrega_estimada DATE,
    fecha_entrega_real     DATETIME,
    FOREIGN KEY (pedido_id)     REFERENCES pedidos(id) ON DELETE CASCADE,
    FOREIGN KEY (paqueteria_id) REFERENCES paqueterias(id),
    INDEX idx_envios_pedido (pedido_id)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
--  MÓDULO 8 · NÓMINA
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_stock_disponible AS
SELECT  i.variante_id, pv.sku, p.nombre AS producto, c.nombre AS color,
        a.nombre AS almacen, i.cantidad, i.cantidad_reservada,
        (i.cantidad - i.cantidad_reservada) AS disponible, i.stock_minimo
FROM inventario i
JOIN producto_variantes pv ON pv.id = i.variante_id
JOIN productos p           ON p.id = pv.producto_id
LEFT JOIN colores c        ON c.id = pv.color_id
JOIN almacenes a           ON a.id = i.almacen_id;

CREATE OR REPLACE VIEW v_alertas_stock AS
SELECT * FROM v_stock_disponible WHERE disponible <= stock_minimo;

CREATE OR REPLACE VIEW v_mas_vendidos AS
SELECT  pv.id AS variante_id, pv.sku, p.nombre AS producto,
        SUM(pd.cantidad) AS unidades_vendidas, SUM(pd.subtotal) AS ingresos
FROM pedido_detalle pd
JOIN producto_variantes pv ON pv.id = pd.variante_id
JOIN productos p           ON p.id = pv.producto_id
JOIN pedidos ped           ON ped.id = pd.pedido_id
WHERE ped.estado NOT IN ('cancelado','devuelto')
GROUP BY pv.id, pv.sku, p.nombre;

-- ---------------------------------------------------------------------
--  VISTAS DE REPORTES
-- ---------------------------------------------------------------------

INSERT INTO roles (nombre, descripcion) VALUES
 ('administrador','Acceso total al sistema'),
 ('gerente','Gestión de inventario, compras y reportes'),
 ('cajero','Operación del punto de venta'),
 ('almacenista','Recepción de mercancía y ajustes de inventario');

INSERT INTO unidades_medida (nombre, abreviatura) VALUES
 ('Pieza','pza'), ('Madeja','mad'), ('Cono','cono'),
 ('Metro','m'), ('Gramo','g'), ('Bolsa','bolsa');

INSERT INTO materiales (nombre) VALUES
 ('Algodón'),('Poliéster'),('Lana'),('Acrílico'),('Seda'),('Lino'),('Mezcla');

INSERT INTO impuestos (nombre, porcentaje) VALUES ('IVA', 16.00);

INSERT INTO metodos_pago (nombre) VALUES
 ('Efectivo'),('Tarjeta débito/crédito'),('Transferencia'),('PayPal'),('Mercado Pago');

INSERT INTO paqueterias (nombre) VALUES
 ('Estafeta'),('DHL'),('FedEx'),('Correos de México'),('Paquetexpress');

INSERT INTO almacenes (nombre, direccion, es_punto_venta) VALUES
 ('Tienda principal','Sucursal centro', TRUE),
 ('Bodega','Almacén general', FALSE);

INSERT INTO categorias (nombre, slug, descripcion) VALUES
 ('Hilo de bordar','hilo-de-bordar','Madejas para bordado a mano y punto de cruz'),
 ('Hilo de coser','hilo-de-coser','Carretes y conos para máquina y costura'),
 ('Estambre','estambre','Estambres y lanas para tejido'),
 ('Hilo de crochet','hilo-de-crochet','Hilos finos para ganchillo'),
 ('Accesorios','accesorios','Agujas, tijeras y complementos');
