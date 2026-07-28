-- =====================================================================
--  Migración · Rastro de los bultos: a quién se vendió y cuál se desarmó
--
--  Hasta aquí el pedido guardaba la cantidad total en kilos y el desarme los
--  kilos consumidos, pero ninguno decía DE QUÉ BULTOS salieron. Como cada bulto
--  pesa distinto y trae su lote, sin ese rastro no se puede responder "¿de qué
--  lote era el hilo que le vendimos a este cliente?" ni revisar un cobro.
--
--  Los datos del bulto se CONGELAN en el pedido (código, peso, lote), igual que
--  `pedido_detalle.precio_unitario`: el histórico no debe cambiar si después se
--  edita o se borra el bulto. La referencia viva al bulto se guarda aparte y
--  queda en NULL si el bulto desaparece.
-- =====================================================================

-- ---------- 1. Qué bultos formaron cada línea del pedido ----------
CREATE TABLE IF NOT EXISTS pedido_detalle_bultos (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    detalle_id         BIGINT UNSIGNED NOT NULL,
    -- Referencia viva al bulto; NULL si se borró. El rastro sigue en las
    -- columnas congeladas de abajo.
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

-- ---------- 2. Qué bulto se desarmó ----------
SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'variante_conversiones'
     AND COLUMN_NAME = 'codigo_bulto'
);
SET @sql := IF(@existe = 0,
  'ALTER TABLE variante_conversiones
     ADD COLUMN codigo_bulto VARCHAR(60) NULL AFTER piezas_generadas,
     ADD INDEX idx_conversiones_bulto (codigo_bulto)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
