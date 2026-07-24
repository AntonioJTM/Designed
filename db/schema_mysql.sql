-- =====================================================================
--  SISTEMA DE GESTIÓN PARA TIENDA DE HILOS  ·  Versión MySQL / MariaDB
--  Web · Tienda en línea · Administrador · Inventario · Punto de venta
-- ---------------------------------------------------------------------
--  Motor: MySQL 8.0+ / MariaDB 10.5+   ·   Charset: utf8mb4
--  Equivalente al esquema PostgreSQL (schema_postgres.sql).
--  Diferencias clave vs Postgres:
--    - AUTO_INCREMENT en lugar de GENERATED ... AS IDENTITY
--    - DATETIME con DEFAULT/ON UPDATE CURRENT_TIMESTAMP (sin triggers)
--    - JSON en lugar de JSONB, VARCHAR(45) para IP
--    - Colación utf8mb4_unicode_ci (insensible a mayúsculas para correos)
-- =====================================================================

-- CREATE DATABASE IF NOT EXISTS tienda_hilos
--   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE tienda_hilos;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
--  MÓDULO 1 · SEGURIDAD Y ADMINISTRACIÓN
-- ---------------------------------------------------------------------

CREATE TABLE roles (
    id          SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre      VARCHAR(50)  NOT NULL UNIQUE,
    descripcion VARCHAR(255),
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE permisos (
    id          SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    clave       VARCHAR(80)  NOT NULL UNIQUE,
    descripcion VARCHAR(255)
) ENGINE=InnoDB;

CREATE TABLE rol_permisos (
    rol_id     SMALLINT UNSIGNED NOT NULL,
    permiso_id SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (rol_id, permiso_id),
    FOREIGN KEY (rol_id)     REFERENCES roles(id)    ON DELETE CASCADE,
    FOREIGN KEY (permiso_id) REFERENCES permisos(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE usuarios (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rol_id          SMALLINT UNSIGNED NOT NULL,
    nombre          VARCHAR(120) NOT NULL,
    correo          VARCHAR(160) NOT NULL UNIQUE,
    telefono        VARCHAR(20),
    contrasena_hash VARCHAR(255) NOT NULL,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_acceso   DATETIME,
    creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (rol_id) REFERENCES roles(id)
) ENGINE=InnoDB;

CREATE TABLE auditoria (
    id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id BIGINT UNSIGNED,
    accion     VARCHAR(80) NOT NULL,
    entidad    VARCHAR(80) NOT NULL,
    entidad_id VARCHAR(80),
    detalle    JSON,
    ip         VARCHAR(45),
    creado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
    INDEX idx_auditoria_usuario (usuario_id),
    INDEX idx_auditoria_entidad (entidad, entidad_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  MÓDULO 2 · CATÁLOGO DE PRODUCTOS (HILOS)
-- ---------------------------------------------------------------------

CREATE TABLE categorias (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    padre_id    INT UNSIGNED,
    nombre      VARCHAR(100) NOT NULL,
    slug        VARCHAR(120) NOT NULL UNIQUE,
    descripcion TEXT,
    imagen_url  VARCHAR(255),
    orden       SMALLINT DEFAULT 0,
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    FOREIGN KEY (padre_id) REFERENCES categorias(id) ON DELETE SET NULL,
    INDEX idx_categorias_padre (padre_id)
) ENGINE=InnoDB;

CREATE TABLE marcas (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    logo_url    VARCHAR(255),
    activo      BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE materiales (
    id     SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(60) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE colores (
    id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre            VARCHAR(60) NOT NULL,
    codigo_hex        CHAR(7),
    codigo_fabricante VARCHAR(30),
    UNIQUE (nombre, codigo_fabricante)
) ENGINE=InnoDB;

CREATE TABLE unidades_medida (
    id          SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre      VARCHAR(30) NOT NULL UNIQUE,
    abreviatura VARCHAR(10) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE impuestos (
    id         SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre     VARCHAR(40)  NOT NULL,
    porcentaje DECIMAL(5,2) NOT NULL CHECK (porcentaje >= 0),
    activo     BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE productos (
    id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    categoria_id     INT UNSIGNED NOT NULL,
    marca_id         INT UNSIGNED,
    material_id      SMALLINT UNSIGNED,
    unidad_medida_id SMALLINT UNSIGNED NOT NULL,
    impuesto_id      SMALLINT UNSIGNED,
    nombre           VARCHAR(160) NOT NULL,
    slug             VARCHAR(180) NOT NULL UNIQUE,
    descripcion      TEXT,
    grosor_calibre   VARCHAR(30),
    peso_gramos      DECIMAL(8,2),
    longitud_metros  DECIMAL(8,2),
    destacado        BOOLEAN NOT NULL DEFAULT FALSE,
    activo           BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (categoria_id)     REFERENCES categorias(id),
    FOREIGN KEY (marca_id)         REFERENCES marcas(id),
    FOREIGN KEY (material_id)      REFERENCES materiales(id),
    FOREIGN KEY (unidad_medida_id) REFERENCES unidades_medida(id),
    FOREIGN KEY (impuesto_id)      REFERENCES impuestos(id),
    INDEX idx_productos_categoria (categoria_id),
    INDEX idx_productos_marca (marca_id)
) ENGINE=InnoDB;

CREATE TABLE producto_variantes (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    producto_id    BIGINT UNSIGNED NOT NULL,
    color_id       INT UNSIGNED,
    sku            VARCHAR(60) NOT NULL UNIQUE,
    codigo_barras  VARCHAR(60) UNIQUE,
    presentacion   VARCHAR(40),
    precio         DECIMAL(12,2) NOT NULL CHECK (precio >= 0),
    precio_oferta  DECIMAL(12,2) CHECK (precio_oferta >= 0),
    costo          DECIMAL(12,2) CHECK (costo >= 0),
    activo         BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
    FOREIGN KEY (color_id)    REFERENCES colores(id),
    INDEX idx_variantes_producto (producto_id),
    INDEX idx_variantes_color (color_id)
) ENGINE=InnoDB;

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
--  MÓDULO 3 · PROVEEDORES Y COMPRAS
-- ---------------------------------------------------------------------

CREATE TABLE proveedores (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre        VARCHAR(160) NOT NULL,
    contacto      VARCHAR(120),
    correo        VARCHAR(160),
    telefono      VARCHAR(20),
    direccion     VARCHAR(255),
    rfc_id_fiscal VARCHAR(30),
    activo        BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE ordenes_compra (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    proveedor_id    BIGINT UNSIGNED NOT NULL,
    usuario_id      BIGINT UNSIGNED,
    folio           VARCHAR(40) NOT NULL UNIQUE,
    estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente','recibida','parcial','cancelada')),
    subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
    impuestos       DECIMAL(12,2) NOT NULL DEFAULT 0,
    total           DECIMAL(12,2) NOT NULL DEFAULT 0,
    fecha_pedido    DATE NOT NULL DEFAULT (CURRENT_DATE),
    fecha_recepcion DATE,
    notas           TEXT,
    creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
    FOREIGN KEY (usuario_id)   REFERENCES usuarios(id),
    INDEX idx_ordenes_compra_proveedor (proveedor_id)
) ENGINE=InnoDB;

CREATE TABLE orden_compra_detalle (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    orden_compra_id   BIGINT UNSIGNED NOT NULL,
    variante_id       BIGINT UNSIGNED NOT NULL,
    cantidad          DECIMAL(12,3) NOT NULL CHECK (cantidad > 0),
    cantidad_recibida DECIMAL(12,3) NOT NULL DEFAULT 0,
    costo_unitario    DECIMAL(12,2) NOT NULL CHECK (costo_unitario >= 0),
    FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra(id) ON DELETE CASCADE,
    FOREIGN KEY (variante_id)     REFERENCES producto_variantes(id),
    INDEX idx_oc_detalle_orden (orden_compra_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  MÓDULO 4 · INVENTARIO (MULTI-ALMACÉN)
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
--  MÓDULO 5 · CLIENTES
-- ---------------------------------------------------------------------

CREATE TABLE clientes (
    id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre           VARCHAR(120) NOT NULL,
    correo           VARCHAR(160) UNIQUE,
    telefono         VARCHAR(20),
    contrasena_hash  VARCHAR(255),
    acepta_marketing BOOLEAN NOT NULL DEFAULT FALSE,
    activo           BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE direcciones (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cliente_id        BIGINT UNSIGNED NOT NULL,
    tipo              VARCHAR(15) NOT NULL DEFAULT 'envio'
                        CHECK (tipo IN ('envio','facturacion')),
    nombre_receptor   VARCHAR(120),
    calle             VARCHAR(160) NOT NULL,
    numero_ext        VARCHAR(20),
    numero_int        VARCHAR(20),
    colonia           VARCHAR(100),
    ciudad            VARCHAR(100) NOT NULL,
    estado            VARCHAR(100) NOT NULL,
    codigo_postal     VARCHAR(15)  NOT NULL,
    pais              VARCHAR(60)  NOT NULL DEFAULT 'México',
    telefono          VARCHAR(20),
    referencias       VARCHAR(255),
    es_predeterminada BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
    INDEX idx_direcciones_cliente (cliente_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  MÓDULO 6 · CARRITO, PROMOCIONES Y CONTENIDO WEB
-- ---------------------------------------------------------------------

CREATE TABLE carritos (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cliente_id     BIGINT UNSIGNED,
    token_sesion   VARCHAR(100),
    creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE carrito_items (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    carrito_id  BIGINT UNSIGNED NOT NULL,
    variante_id BIGINT UNSIGNED NOT NULL,
    cantidad    DECIMAL(12,3) NOT NULL CHECK (cantidad > 0),
    UNIQUE (carrito_id, variante_id),
    FOREIGN KEY (carrito_id)  REFERENCES carritos(id) ON DELETE CASCADE,
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id)
) ENGINE=InnoDB;

CREATE TABLE cupones (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo        VARCHAR(40) NOT NULL UNIQUE,
    tipo          VARCHAR(15) NOT NULL CHECK (tipo IN ('porcentaje','monto_fijo')),
    valor         DECIMAL(12,2) NOT NULL CHECK (valor >= 0),
    compra_minima DECIMAL(12,2) NOT NULL DEFAULT 0,
    usos_maximos  INT,
    usos_actuales INT NOT NULL DEFAULT 0,
    fecha_inicio  DATE,
    fecha_fin     DATE,
    activo        BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE listas_deseos (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cliente_id  BIGINT UNSIGNED NOT NULL,
    variante_id BIGINT UNSIGNED NOT NULL,
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (cliente_id, variante_id),
    FOREIGN KEY (cliente_id)  REFERENCES clientes(id) ON DELETE CASCADE,
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE resenas (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    producto_id  BIGINT UNSIGNED NOT NULL,
    cliente_id   BIGINT UNSIGNED,
    calificacion TINYINT NOT NULL CHECK (calificacion BETWEEN 1 AND 5),
    comentario   TEXT,
    aprobada     BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
    FOREIGN KEY (cliente_id)  REFERENCES clientes(id) ON DELETE SET NULL,
    INDEX idx_resenas_producto (producto_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  MÓDULO 7 · CAJA / PUNTO DE VENTA (POS)
-- ---------------------------------------------------------------------

CREATE TABLE cajas (
    id         SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    almacen_id SMALLINT UNSIGNED NOT NULL,
    nombre     VARCHAR(60) NOT NULL,
    activo     BOOLEAN NOT NULL DEFAULT TRUE,
    FOREIGN KEY (almacen_id) REFERENCES almacenes(id)
) ENGINE=InnoDB;

CREATE TABLE sesiones_caja (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    caja_id        SMALLINT UNSIGNED NOT NULL,
    usuario_id     BIGINT UNSIGNED NOT NULL,
    monto_inicial  DECIMAL(12,2) NOT NULL DEFAULT 0,
    monto_esperado DECIMAL(12,2),
    monto_final    DECIMAL(12,2),
    diferencia     DECIMAL(12,2),
    estado         VARCHAR(10) NOT NULL DEFAULT 'abierta'
                     CHECK (estado IN ('abierta','cerrada')),
    fecha_apertura DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre   DATETIME,
    FOREIGN KEY (caja_id)    REFERENCES cajas(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    INDEX idx_sesiones_caja_usuario (usuario_id)
) ENGINE=InnoDB;

CREATE TABLE movimientos_caja (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sesion_caja_id BIGINT UNSIGNED NOT NULL,
    tipo           VARCHAR(15) NOT NULL
                     CHECK (tipo IN ('venta','ingreso','retiro','devolucion')),
    monto          DECIMAL(12,2) NOT NULL,
    referencia_id  BIGINT UNSIGNED,
    motivo         VARCHAR(255),
    creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sesion_caja_id) REFERENCES sesiones_caja(id) ON DELETE CASCADE,
    INDEX idx_movcaja_sesion (sesion_caja_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  MÓDULO 8 · VENTAS / PEDIDOS (online + POS unificados)
-- ---------------------------------------------------------------------

CREATE TABLE metodos_pago (
    id     SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(40) NOT NULL UNIQUE,
    activo BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE paqueterias (
    id     SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(60) NOT NULL UNIQUE,
    activo BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

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
--  VISTAS ÚTILES
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
--  DATOS SEMILLA
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
