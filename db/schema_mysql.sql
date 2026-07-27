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

-- Material del hilo (acrilán, viscosa…). Se rotula "Material" en el panel.
-- Lista plana: no hay jerarquía. El catálogo filtra por material exacto.
-- `calibres` es la lista de calibres válidos de ese material, separados por
-- coma; el alta de producto solo ofrece esos.
CREATE TABLE categorias (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL,
    descripcion TEXT,
    calibres    VARCHAR(255),
    imagen_url  VARCHAR(255),
    orden       SMALLINT DEFAULT 0,
    activo      BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

-- Línea de procedencia del hilo: turco, nacional, chino.
CREATE TABLE lineas (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    logo_url    VARCHAR(255),
    activo      BOOLEAN NOT NULL DEFAULT TRUE
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
    linea_id         INT UNSIGNED,
    unidad_medida_id SMALLINT UNSIGNED NOT NULL,
    impuesto_id      SMALLINT UNSIGNED,
    nombre           VARCHAR(160) NOT NULL,
    descripcion      TEXT,
    -- El calibre válido lo define el material en `categorias.calibres`.
    grosor_calibre   VARCHAR(30),
    -- Precio de LISTA del hilo por unidad de peso. No es el que se cobra —ese es
    -- producto_variantes.precio— pero las presentaciones nuevas lo heredan.
    precio_kg        DECIMAL(12,2),
    -- multipresentacion: se maneja como paquete que se desarma en conos.
    -- por_lotes: sus presentaciones se etiquetan por lote (el stock NO se separa).
    multipresentacion BOOLEAN NOT NULL DEFAULT FALSE,
    por_lotes        BOOLEAN NOT NULL DEFAULT FALSE,
    destacado        BOOLEAN NOT NULL DEFAULT FALSE,
    activo           BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (categoria_id)     REFERENCES categorias(id),
    FOREIGN KEY (linea_id)         REFERENCES lineas(id),
    FOREIGN KEY (unidad_medida_id) REFERENCES unidades_medida(id),
    FOREIGN KEY (impuesto_id)      REFERENCES impuestos(id),
    INDEX idx_productos_categoria (categoria_id),
    INDEX idx_productos_linea (linea_id)
) ENGINE=InnoDB;

-- `tipo_presentacion` define cómo se vende e inventaría la variante:
--   paquete → la cantidad son KILOS  y `precio` es el precio por kilo
--   cono    → la cantidad son PIEZAS y `precio` es el precio de un cono
--   simple  → la cantidad va en la unidad del producto
-- Un 'cono' sale de desarmar su `origen_variante_id`: de un paquete salen
-- `piezas_por_origen` conos. Con `modo_precio = 'calculado'` el precio del
-- cono lo deriva el backend del valor del paquete; con 'manual' lo fija el
-- usuario. Ver db/migrations/2026-07_paquetes_y_conos.sql.
CREATE TABLE producto_variantes (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    producto_id        BIGINT UNSIGNED NOT NULL,
    sku                VARCHAR(60) NOT NULL UNIQUE,
    codigo_barras      VARCHAR(60) UNIQUE,
    presentacion       VARCHAR(40),
    -- Etiqueta de la remesa. El inventario NO se separa por lote.
    lote               VARCHAR(40),
    tipo_presentacion  VARCHAR(10) NOT NULL DEFAULT 'simple'
                         CHECK (tipo_presentacion IN ('simple','paquete','cono')),
    peso_kg            DECIMAL(12,3),
    origen_variante_id BIGINT UNSIGNED,
    piezas_por_origen  INT UNSIGNED,
    modo_precio        VARCHAR(10) NOT NULL DEFAULT 'manual'
                         CHECK (modo_precio IN ('manual','calculado')),
    precio             DECIMAL(12,2) NOT NULL CHECK (precio >= 0),
    precio_oferta      DECIMAL(12,2) CHECK (precio_oferta >= 0),
    costo              DECIMAL(12,2) CHECK (costo >= 0),
    activo             BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (producto_id)        REFERENCES productos(id) ON DELETE CASCADE,
    FOREIGN KEY (origen_variante_id) REFERENCES producto_variantes(id) ON DELETE SET NULL,
    INDEX idx_variantes_producto (producto_id),
    INDEX idx_variantes_origen (origen_variante_id),
    INDEX idx_variantes_lote (lote)
) ENGINE=InnoDB;

-- Tipos de cliente. El público cobra `producto_variantes.precio`; los demás
-- llevan su precio propio en `variante_precios`.
CREATE TABLE tipos_cliente (
    id         SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre     VARCHAR(60) NOT NULL UNIQUE,
    es_publico BOOLEAN NOT NULL DEFAULT FALSE,
    orden      SMALLINT NOT NULL DEFAULT 0,
    activo     BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Precio de una presentación para un tipo de cliente distinto del público.
-- Sin fila, ese tipo paga el precio público.
CREATE TABLE variante_precios (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    variante_id     BIGINT UNSIGNED NOT NULL,
    tipo_cliente_id SMALLINT UNSIGNED NOT NULL,
    precio          DECIMAL(12,2) NOT NULL CHECK (precio >= 0),
    actualizado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE (variante_id, tipo_cliente_id),
    FOREIGN KEY (variante_id)     REFERENCES producto_variantes(id) ON DELETE CASCADE,
    FOREIGN KEY (tipo_cliente_id) REFERENCES tipos_cliente(id)      ON DELETE CASCADE
) ENGINE=InnoDB;

-- Bitácora de desarmes: liga la salida del paquete con la entrada de conos
-- en `movimientos_inventario` (referencia_tipo = 'conversion').
CREATE TABLE variante_conversiones (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    variante_origen_id  BIGINT UNSIGNED NOT NULL,
    variante_destino_id BIGINT UNSIGNED NOT NULL,
    almacen_origen_id   SMALLINT UNSIGNED NOT NULL,
    almacen_destino_id  SMALLINT UNSIGNED NOT NULL,
    paquetes            DECIMAL(12,3) NOT NULL CHECK (paquetes > 0),
    kg_consumidos       DECIMAL(12,3) NOT NULL CHECK (kg_consumidos > 0),
    -- Peso que GANA el hilo al enconarse (el tubo de cada cono). Lo captura la
    -- tienda; no se calcula. kg_consumidos + destare_kg = lo que pesó enconado.
    destare_kg          DECIMAL(12,3),
    piezas_generadas    DECIMAL(12,3) NOT NULL CHECK (piezas_generadas > 0),
    -- Bulto que se desarmó, cuando el desarme se hizo escaneándolo.
    codigo_bulto       VARCHAR(60),
    usuario_id          BIGINT UNSIGNED,
    motivo              VARCHAR(255),
    creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (variante_origen_id)  REFERENCES producto_variantes(id),
    FOREIGN KEY (variante_destino_id) REFERENCES producto_variantes(id),
    FOREIGN KEY (almacen_origen_id)   REFERENCES almacenes(id),
    FOREIGN KEY (almacen_destino_id)  REFERENCES almacenes(id),
    FOREIGN KEY (usuario_id)          REFERENCES usuarios(id),
    INDEX idx_conversiones_origen (variante_origen_id),
    INDEX idx_conversiones_fecha (creado_en)
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

-- Bultos físicos de una variante. Cada renglón es UN bulto con su código de
-- barras, su peso real y su lote, tal como llega en la lista de empaque del
-- proveedor. La presentación del catálogo es una sola (el paquete); estos son
-- sus ejemplares. El código principal sigue en producto_variantes.codigo_barras
-- y el stock NO se separa por lote: es un saldo en kilos por variante y almacén.
CREATE TABLE variante_codigos (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    variante_id BIGINT UNSIGNED NOT NULL,
    codigo      VARCHAR(60) NOT NULL UNIQUE,
    -- Peso real de ESTE bulto: al escanearlo se cobra por él, no por el nominal.
    peso_kg     DECIMAL(12,3),
    lote        VARCHAR(40),
    -- Conos que rinde este bulto: varía entre bultos, así vienen de fábrica.
    conos       INT UNSIGNED,
    -- Dónde está el bulto. Lo pone la remesa que lo trajo y lo cambia el
    -- traspaso: así el traspaso descuenta el peso REAL de los que se mandan.
    almacen_id  SMALLINT UNSIGNED,
    -- Un bulto es una pieza única: se consume UNA vez, al venderse o al
    -- desarmarse. Cancelar o devolver el pedido lo regresa a 'disponible'.
    estado         VARCHAR(12) NOT NULL DEFAULT 'disponible'
                     CHECK (estado IN ('disponible','vendido','desarmado')),
    consumido_en   DATETIME,
    consumido_tipo VARCHAR(20),
    consumido_id   BIGINT UNSIGNED,
    remesa_id   BIGINT UNSIGNED,
    etiqueta    VARCHAR(60),
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id) ON DELETE CASCADE,
    FOREIGN KEY (almacen_id)  REFERENCES almacenes(id),
    INDEX idx_variante_codigos_variante (variante_id),
    INDEX idx_variante_codigos_lote (lote),
    INDEX idx_variante_codigos_estado (estado),
    INDEX idx_variante_codigos_almacen (almacen_id),
    INDEX idx_variante_codigos_remesa (remesa_id)
) ENGINE=InnoDB;

-- Documento de entrada de una remesa (la lista de empaque importada).
CREATE TABLE remesas (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    folio       VARCHAR(40) NOT NULL UNIQUE,
    variante_id BIGINT UNSIGNED NOT NULL,
    almacen_id  SMALLINT UNSIGNED NOT NULL,
    usuario_id  BIGINT UNSIGNED,
    num_bultos  INT UNSIGNED NOT NULL,
    kg_total    DECIMAL(12,3) NOT NULL CHECK (kg_total > 0),
    lotes       VARCHAR(255),
    archivo     VARCHAR(255),
    notas       TEXT,
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id),
    FOREIGN KEY (almacen_id)  REFERENCES almacenes(id),
    FOREIGN KEY (usuario_id)  REFERENCES usuarios(id),
    INDEX idx_remesas_variante (variante_id),
    INDEX idx_remesas_fecha (creado_en)
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

-- `es_tienda_linea` marca el almacén del que descuentan los pedidos web y
-- `es_matriz` el que surte a las demás sucursales. Cada uno debe estar
-- encendido en un solo almacén; el backend lo garantiza al guardar.
CREATE TABLE almacenes (
    id              SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre          VARCHAR(100) NOT NULL UNIQUE,
    direccion       VARCHAR(255),
    es_punto_venta  BOOLEAN NOT NULL DEFAULT FALSE,
    es_tienda_linea BOOLEAN NOT NULL DEFAULT FALSE,
    es_matriz       BOOLEAN NOT NULL DEFAULT FALSE,
    activo          BOOLEAN NOT NULL DEFAULT TRUE
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

-- Traspasos de matriz a sucursales. Documento con folio y varias líneas; el
-- movimiento es inmediato (no se modela el tiempo de camino). La línea guarda
-- los `paquetes` capturados y la `cantidad` real movida, porque el inventario
-- de una variante 'paquete' se lleva en kilos.
CREATE TABLE traspasos (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    folio              VARCHAR(40) NOT NULL UNIQUE,
    almacen_origen_id  SMALLINT UNSIGNED NOT NULL,
    almacen_destino_id SMALLINT UNSIGNED NOT NULL,
    usuario_id         BIGINT UNSIGNED,
    notas              TEXT,
    creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (almacen_origen_id)  REFERENCES almacenes(id),
    FOREIGN KEY (almacen_destino_id) REFERENCES almacenes(id),
    FOREIGN KEY (usuario_id)         REFERENCES usuarios(id),
    INDEX idx_traspasos_destino (almacen_destino_id),
    INDEX idx_traspasos_fecha (creado_en)
) ENGINE=InnoDB;

CREATE TABLE traspaso_detalle (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    traspaso_id BIGINT UNSIGNED NOT NULL,
    variante_id BIGINT UNSIGNED NOT NULL,
    paquetes    DECIMAL(12,3),
    cantidad    DECIMAL(12,3) NOT NULL CHECK (cantidad > 0),
    FOREIGN KEY (traspaso_id) REFERENCES traspasos(id) ON DELETE CASCADE,
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id),
    INDEX idx_traspaso_detalle_traspaso (traspaso_id)
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
    -- Lista de precios con la que se cerró la venta.
    tipo_cliente_id    SMALLINT UNSIGNED,
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
    FOREIGN KEY (tipo_cliente_id)    REFERENCES tipos_cliente(id),
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

-- Qué BULTOS formaron cada línea del pedido. Como cada bulto pesa distinto y
-- trae su lote, esto es lo que permite responder de qué lote era el hilo que se
-- le entregó a un cliente. El código, el peso y el lote se CONGELAN aquí (igual
-- que pedido_detalle.precio_unitario): variante_codigo_id es la referencia viva
-- y queda en NULL si el bulto se borra, pero el pedido sigue siendo fiel.
-- Es opcional: la tienda en línea y las ventas a granel no escanean bultos.
CREATE TABLE pedido_detalle_bultos (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    detalle_id         BIGINT UNSIGNED NOT NULL,
    variante_codigo_id BIGINT UNSIGNED,
    codigo             VARCHAR(60) NOT NULL,
    peso_kg            DECIMAL(12,3) NOT NULL CHECK (peso_kg > 0),
    lote               VARCHAR(40),
    FOREIGN KEY (detalle_id) REFERENCES pedido_detalle(id) ON DELETE CASCADE,
    FOREIGN KEY (variante_codigo_id) REFERENCES variante_codigos(id) ON DELETE SET NULL,
    INDEX idx_pdb_detalle (detalle_id),
    INDEX idx_pdb_codigo (codigo),
    INDEX idx_pdb_lote (lote)
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

-- ---------------------------------------------------------------------
--  MÓDULO 9 · NÓMINA SEMANAL DEL PERSONAL
--  Semana natural DOMINGO → SÁBADO, pagada ese mismo sábado.
--  La comisión se calcula sobre la VENTA NETA de los pedidos donde el
--  empleado es el vendedor (pedidos.usuario_id): subtotal - descuento,
--  es decir sin IVA y sin costo de envío.
-- ---------------------------------------------------------------------

-- Configuración de nómina por empleado. Es 1:1 opcional con `usuarios`:
-- solo el staff que aparece aquí entra en la nómina.
CREATE TABLE nomina_empleados (
    usuario_id          BIGINT UNSIGNED PRIMARY KEY,
    sueldo_base_semanal DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (sueldo_base_semanal >= 0),
    paga_comision       BOOLEAN NOT NULL DEFAULT FALSE,
    porcentaje_comision DECIMAL(5,2)  NOT NULL DEFAULT 0
                          CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100),
    valor_hora_extra    DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (valor_hora_extra >= 0),
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Periodo semanal. `fecha_inicio` es domingo, `fecha_fin` sábado y
-- `fecha_pago` coincide con el sábado del cierre.
CREATE TABLE nomina_periodos (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fecha_inicio   DATE NOT NULL UNIQUE,
    fecha_fin      DATE NOT NULL,
    fecha_pago     DATE NOT NULL,
    estado         VARCHAR(15) NOT NULL DEFAULT 'borrador'
                     CHECK (estado IN ('borrador','pagado','cancelado')),
    notas          TEXT,
    creado_por     BIGINT UNSIGNED,
    creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creado_por) REFERENCES usuarios(id),
    INDEX idx_nomina_periodos_pago (fecha_pago)
) ENGINE=InnoDB;

-- Recibo de un empleado dentro del periodo. Los montos quedan CONGELADOS
-- al calcular: `ventas_netas` y `porcentaje_comision` se guardan aquí para
-- que el recibo siga siendo auditable aunque cambie la configuración.
CREATE TABLE nomina_recibos (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    periodo_id          BIGINT UNSIGNED NOT NULL,
    usuario_id          BIGINT UNSIGNED NOT NULL,
    sueldo_base         DECIMAL(12,2) NOT NULL DEFAULT 0,
    num_pedidos         INT UNSIGNED  NOT NULL DEFAULT 0,
    ventas_netas        DECIMAL(12,2) NOT NULL DEFAULT 0,
    porcentaje_comision DECIMAL(5,2)  NOT NULL DEFAULT 0,
    comision            DECIMAL(12,2) NOT NULL DEFAULT 0,
    otras_percepciones  DECIMAL(12,2) NOT NULL DEFAULT 0,
    deducciones         DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_pagar         DECIMAL(12,2) NOT NULL DEFAULT 0,
    notas               TEXT,
    creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE (periodo_id, usuario_id),
    FOREIGN KEY (periodo_id) REFERENCES nomina_periodos(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    INDEX idx_nomina_recibos_usuario (usuario_id)
) ENGINE=InnoDB;

-- Conceptos capturados a mano sobre un recibo. `cantidad` guarda las horas
-- (o los días) cuando aplica; `importe` siempre es positivo y el signo lo
-- determina `tipo`.
CREATE TABLE nomina_recibo_conceptos (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    recibo_id   BIGINT UNSIGNED NOT NULL,
    tipo        VARCHAR(12) NOT NULL CHECK (tipo IN ('percepcion','deduccion')),
    clave       VARCHAR(20) NOT NULL
                  CHECK (clave IN ('horas_extra','falta','descuento','otro')),
    descripcion VARCHAR(200),
    cantidad    DECIMAL(10,2),
    importe     DECIMAL(12,2) NOT NULL CHECK (importe >= 0),
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recibo_id) REFERENCES nomina_recibos(id) ON DELETE CASCADE,
    INDEX idx_nomina_conceptos_recibo (recibo_id)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
--  VISTAS ÚTILES
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_stock_disponible AS
SELECT  i.variante_id, pv.sku, p.nombre AS producto,
        a.nombre AS almacen, i.cantidad, i.cantidad_reservada,
        (i.cantidad - i.cantidad_reservada) AS disponible, i.stock_minimo
FROM inventario i
JOIN producto_variantes pv ON pv.id = i.variante_id
JOIN productos p           ON p.id = pv.producto_id
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

-- Venta neta por empleado y día. Alimenta el cálculo de comisiones de nómina
-- y sirve para auditar de dónde salió la base comisionable de la semana.
CREATE OR REPLACE VIEW v_ventas_por_empleado AS
SELECT  p.usuario_id,
        u.nombre AS usuario,
        DATE(p.creado_en) AS dia,
        COUNT(*) AS num_pedidos,
        COALESCE(SUM(p.subtotal - p.descuento), 0) AS venta_neta,
        COALESCE(SUM(p.total), 0) AS venta_total
FROM pedidos p
JOIN usuarios u ON u.id = p.usuario_id
WHERE p.usuario_id IS NOT NULL
  AND p.estado NOT IN ('cancelado','devuelto')
GROUP BY p.usuario_id, u.nombre, DATE(p.creado_en);

-- ---------------------------------------------------------------------
--  DATOS SEMILLA
-- ---------------------------------------------------------------------

INSERT INTO roles (nombre, descripcion) VALUES
 ('administrador','Acceso total al sistema'),
 ('gerente','Gestión de inventario, compras y reportes'),
 ('cajero','Operación del punto de venta'),
 ('almacenista','Recepción de mercancía y ajustes de inventario');

-- El producto se compra, inventaría y vende por peso; no hay unidades de conteo.
INSERT INTO unidades_medida (nombre, abreviatura) VALUES
 ('Gramo','g'), ('Kilogramo','kg'), ('Tonelada','t');

INSERT INTO lineas (nombre) VALUES ('Turco'), ('Nacional'), ('Chino');

INSERT INTO tipos_cliente (nombre, es_publico, orden) VALUES ('Público', TRUE, 0);

INSERT INTO impuestos (nombre, porcentaje) VALUES ('IVA', 16.00);

INSERT INTO metodos_pago (nombre) VALUES
 ('Efectivo'),('Tarjeta débito/crédito'),('Transferencia'),('PayPal'),('Mercado Pago');

INSERT INTO paqueterias (nombre) VALUES
 ('Estafeta'),('DHL'),('FedEx'),('Correos de México'),('Paquetexpress');

INSERT INTO almacenes (nombre, direccion, es_punto_venta, es_tienda_linea, es_matriz) VALUES
 ('Tienda principal','Sucursal centro', TRUE,  FALSE, TRUE),
 ('Bodega','Almacén general',           FALSE, TRUE,  FALSE);

-- Materiales con sus calibres válidos.
INSERT INTO categorias (nombre, descripcion, calibres) VALUES
 ('Acrilán','Acrilán para suéteres y bordado','1/30,2/30'),
 ('Viscosa','Viscosa antipiling','2/48');
