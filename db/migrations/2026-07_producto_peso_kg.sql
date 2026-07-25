-- =====================================================================
--  Migración · El peso del producto se guarda en KILOS
--
--  `productos.peso_gramos` era DECIMAL(8,2) en gramos: topaba en 999,999.99 g
--  (una tonelada). El formulario captura kilos y multiplicaba por 1000, así
--  que cualquier peso mayor a 999.99 kg reventaba con
--  "Out of range value for column 'peso_gramos'".
--
--  Se pasa a `peso_kg DECIMAL(12,3)`, igual que el resto de los pesos del
--  sistema (inventario, variantes, traspasos). Ya no hay conversión: lo que
--  se teclea es lo que se guarda.
--
--  Los valores existentes se convierten dividiendo entre 1000.
-- =====================================================================

SET @existe_kg := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'peso_kg'
);
SET @existe_g := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'peso_gramos'
);

-- 1. Agrega la columna nueva.
SET @sql := IF(
  @existe_kg = 0,
  'ALTER TABLE productos ADD COLUMN peso_kg DECIMAL(12,3) AFTER grosor_calibre',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Convierte los gramos que ya existían a kilos.
SET @sql := IF(
  @existe_kg = 0 AND @existe_g = 1,
  'UPDATE productos SET peso_kg = peso_gramos / 1000 WHERE peso_gramos IS NOT NULL',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Retira la columna vieja.
SET @sql := IF(
  @existe_g = 1,
  'ALTER TABLE productos DROP COLUMN peso_gramos',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
