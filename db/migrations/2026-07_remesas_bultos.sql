-- =====================================================================
--  Migración · Remesas: carga masiva de bultos desde la lista de empaque
--
--  El proveedor manda un Excel donde cada renglón es UN BULTO físico con su
--  propio código de barras, su peso real y su lote. Ejemplo real: 80 bultos,
--  pesos de 10.75 a 19.80 kg, 1,527.5 kg en total, 2 lotes, y casi todos dan
--  12 conos salvo uno que dio 7.
--
--  El bulto NO es una presentación del catálogo: la presentación es una sola
--  ("MARINO OSCURO 2/30 · Paquete", con su precio por kilo) y los bultos son
--  los ejemplares físicos de esa presentación. Por eso se registran en
--  `variante_codigos`, que ya existía para agrupar varios códigos de barras
--  bajo la misma variante; solo se le agrega lo que la lista de empaque trae.
--
--  El inventario sigue siendo un saldo en kilos por variante y almacén: al
--  importar se suma el total de la remesa.
-- =====================================================================

-- ---------- 1. El código de barras pasa a describir su bulto ----------
SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'variante_codigos'
     AND COLUMN_NAME = 'peso_kg'
);
SET @sql := IF(@existe = 0, CONCAT(
  'ALTER TABLE variante_codigos ',
  'ADD COLUMN peso_kg DECIMAL(12,3) NULL AFTER codigo, ',
  'ADD COLUMN lote VARCHAR(40) NULL AFTER peso_kg, ',
  'ADD COLUMN conos INT UNSIGNED NULL AFTER lote, ',
  'ADD COLUMN remesa_id BIGINT UNSIGNED NULL AFTER conos, ',
  'ADD INDEX idx_variante_codigos_lote (lote), ',
  'ADD INDEX idx_variante_codigos_remesa (remesa_id)'
), 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 2. La remesa: el documento de la entrada ----------
CREATE TABLE IF NOT EXISTS remesas (
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
