-- =====================================================================
--  Migración · Paquetes que se desarman en conos
--
--  El producto entra a bodega en PAQUETES (peso fijo, se venden por kilo) y
--  de ahí se "desarma" un paquete para bajarlo a mostrador convertido en
--  CONOS (se venden por pieza). Ambas presentaciones se exhiben y se venden.
--
--  Modelo:
--    · Cada presentación es una variante propia, con su existencia y su
--      código de barras. `tipo_presentacion` dice cuál es cuál.
--    · La variante 'cono' apunta a su paquete de origen con
--      `origen_variante_id` y dice cuántos conos salen de uno con
--      `piezas_por_origen`.
--    · Desarmar consume kilos del paquete y da entrada a conos, dejando en
--      el kardex una salida y una entrada ligadas por el mismo folio de
--      `variante_conversiones`.
--
--  Unidad de la cantidad, según el tipo:
--    paquete → kilos   (precio = precio por kilo)
--    cono    → piezas  (precio = precio de un cono)
--    simple  → la unidad del producto (comportamiento anterior)
-- =====================================================================

-- Columnas nuevas en producto_variantes (idempotente: basta con revisar una).
SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'producto_variantes'
     AND COLUMN_NAME = 'tipo_presentacion'
);
SET @sql := IF(@existe = 0, CONCAT(
  'ALTER TABLE producto_variantes ',
  "ADD COLUMN tipo_presentacion VARCHAR(10) NOT NULL DEFAULT 'simple' AFTER presentacion, ",
  'ADD COLUMN peso_kg DECIMAL(12,3) NULL AFTER tipo_presentacion, ',
  'ADD COLUMN origen_variante_id BIGINT UNSIGNED NULL AFTER peso_kg, ',
  'ADD COLUMN piezas_por_origen INT UNSIGNED NULL AFTER origen_variante_id, ',
  "ADD COLUMN modo_precio VARCHAR(10) NOT NULL DEFAULT 'manual' AFTER piezas_por_origen, ",
  "ADD CONSTRAINT chk_variantes_tipo CHECK (tipo_presentacion IN ('simple','paquete','cono')), ",
  "ADD CONSTRAINT chk_variantes_modo_precio CHECK (modo_precio IN ('manual','calculado')), ",
  'ADD CONSTRAINT fk_variantes_origen FOREIGN KEY (origen_variante_id) ',
  '    REFERENCES producto_variantes(id) ON DELETE SET NULL, ',
  'ADD INDEX idx_variantes_origen (origen_variante_id)'
), 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Bitácora de desarmes. Es el folio que liga la salida de paquete con la
-- entrada de conos en `movimientos_inventario` (referencia_tipo='conversion').
CREATE TABLE IF NOT EXISTS variante_conversiones (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    variante_origen_id  BIGINT UNSIGNED NOT NULL,
    variante_destino_id BIGINT UNSIGNED NOT NULL,
    almacen_origen_id   SMALLINT UNSIGNED NOT NULL,
    almacen_destino_id  SMALLINT UNSIGNED NOT NULL,
    paquetes            DECIMAL(12,3) NOT NULL CHECK (paquetes > 0),
    kg_consumidos       DECIMAL(12,3) NOT NULL CHECK (kg_consumidos > 0),
    piezas_generadas    DECIMAL(12,3) NOT NULL CHECK (piezas_generadas > 0),
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
