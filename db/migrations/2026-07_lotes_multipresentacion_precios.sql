-- =====================================================================
--  Migración · Multipresentación, lotes y precios por tipo de cliente
--
--  1. BANDERAS DEL PRODUCTO (junto a destacado y activo)
--     · `multipresentacion`: el producto se maneja en varias presentaciones,
--       o sea un paquete que se desarma en conos. Si está apagada, sus
--       variantes solo pueden ser 'simple'.
--     · `por_lotes`: sus presentaciones se clasifican por lote.
--
--  2. LOTE EN LA PRESENTACIÓN
--     `producto_variantes.lote` es una ETIQUETA para saber de qué remesa vino
--     y poder agrupar en pantalla. El inventario NO se separa por lote: el
--     saldo sigue siendo uno por variante y almacén, igual que con los
--     códigos de barras adicionales.
--
--  3. PRECIOS POR TIPO DE CLIENTE
--     `producto_variantes.precio` es el PRECIO PÚBLICO. Los demás tipos
--     (medio mayoreo, mayoreo, especial…) llevan su propio precio en
--     `variante_precios`. Si un tipo no tiene precio capturado para una
--     presentación, se cobra el público.
--     `pedidos.tipo_cliente_id` deja constancia de con qué lista se vendió.
-- =====================================================================

-- ---------- 1. Banderas del producto ----------
SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos'
     AND COLUMN_NAME = 'multipresentacion'
);
SET @sql := IF(@existe = 0, CONCAT(
  'ALTER TABLE productos ',
  'ADD COLUMN multipresentacion BOOLEAN NOT NULL DEFAULT FALSE AFTER grosor_calibre, ',
  'ADD COLUMN por_lotes BOOLEAN NOT NULL DEFAULT FALSE AFTER multipresentacion'
), 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Los productos que ya tienen paquete o cono son multipresentación de hecho.
UPDATE productos p SET multipresentacion = TRUE
 WHERE EXISTS (
   SELECT 1 FROM (SELECT DISTINCT producto_id FROM producto_variantes
                   WHERE tipo_presentacion IN ('paquete','cono')) v
    WHERE v.producto_id = p.id
 );

-- ---------- 2. Lote en la presentación ----------
SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'producto_variantes'
     AND COLUMN_NAME = 'lote'
);
SET @sql := IF(
  @existe = 0,
  'ALTER TABLE producto_variantes ADD COLUMN lote VARCHAR(40) AFTER presentacion, ADD INDEX idx_variantes_lote (lote)',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 3. Tipos de cliente y sus precios ----------
CREATE TABLE IF NOT EXISTS tipos_cliente (
    id         SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre     VARCHAR(60) NOT NULL UNIQUE,
    -- El tipo público cobra `producto_variantes.precio`; solo puede haber uno.
    es_publico BOOLEAN NOT NULL DEFAULT FALSE,
    orden      SMALLINT NOT NULL DEFAULT 0,
    activo     BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT IGNORE INTO tipos_cliente (nombre, es_publico, orden) VALUES ('Público', TRUE, 0);

-- Precio de una presentación para un tipo de cliente que no es el público.
CREATE TABLE IF NOT EXISTS variante_precios (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    variante_id     BIGINT UNSIGNED NOT NULL,
    tipo_cliente_id SMALLINT UNSIGNED NOT NULL,
    precio          DECIMAL(12,2) NOT NULL CHECK (precio >= 0),
    actualizado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE (variante_id, tipo_cliente_id),
    FOREIGN KEY (variante_id)     REFERENCES producto_variantes(id) ON DELETE CASCADE,
    FOREIGN KEY (tipo_cliente_id) REFERENCES tipos_cliente(id)      ON DELETE CASCADE
) ENGINE=InnoDB;

-- Con qué lista de precios se cerró la venta.
SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos'
     AND COLUMN_NAME = 'tipo_cliente_id'
);
SET @sql := IF(@existe = 0, CONCAT(
  'ALTER TABLE pedidos ',
  'ADD COLUMN tipo_cliente_id SMALLINT UNSIGNED NULL AFTER cliente_id, ',
  'ADD CONSTRAINT fk_pedidos_tipo_cliente FOREIGN KEY (tipo_cliente_id) REFERENCES tipos_cliente(id)'
), 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
