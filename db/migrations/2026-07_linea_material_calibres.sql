-- =====================================================================
--  Migración · Línea, material y calibres por material
--
--  Las categorías venían mezclando dos cosas en el nombre ("Acrilan turco"):
--  el MATERIAL y la LÍNEA de procedencia. Se separan:
--
--    Material (tabla `categorias`, rotulada "Material" en el panel)
--        Acrilán, Viscosa…
--    Línea (tabla `lineas`, antes `marcas`)
--        Turco, Nacional, Chino
--    Calibre
--        Depende del material: acrilán 1/30 y 2/30 · viscosa 2/48
--
--  Cambios:
--    1. `marcas` → `lineas` y `productos.marca_id` → `linea_id`. La tabla
--       estaba vacía, así que el rename no arrastra datos.
--    2. Se retira `productos.material_id` y la tabla `materiales` (traía
--       fibras genéricas que no se usaban). Así "material" significa una sola
--       cosa en todo el sistema.
--    3. `categorias.calibres` guarda la lista de calibres válidos de ese
--       material, separados por coma, para que el alta de producto solo
--       ofrezca los que aplican y se puedan editar sin tocar código.
-- =====================================================================

-- ---------- 1. marcas → lineas ----------

-- Suelta la FK de productos hacia marcas (MySQL le pone nombre automático).
SET @fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos'
     AND COLUMN_NAME = 'marca_id' AND REFERENCED_TABLE_NAME = 'marcas' LIMIT 1
);
SET @sql := IF(@fk IS NOT NULL, CONCAT('ALTER TABLE productos DROP FOREIGN KEY ', @fk), 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @hay_marcas := (
  SELECT COUNT(*) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marcas'
);
SET @sql := IF(@hay_marcas = 1, 'RENAME TABLE marcas TO lineas', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @hay_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'marca_id'
);
SET @sql := IF(
  @hay_col = 1,
  'ALTER TABLE productos CHANGE COLUMN marca_id linea_id INT UNSIGNED',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Reponer la FK y el índice con los nombres nuevos.
SET @fk_nueva := (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos'
     AND COLUMN_NAME = 'linea_id' AND REFERENCED_TABLE_NAME = 'lineas'
);
SET @sql := IF(
  @fk_nueva = 0,
  'ALTER TABLE productos ADD CONSTRAINT fk_productos_linea FOREIGN KEY (linea_id) REFERENCES lineas(id)',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Las tres líneas que maneja la tienda. `nombre` es UNIQUE: re-ejecutable.
INSERT IGNORE INTO lineas (nombre) VALUES ('Turco'), ('Nacional'), ('Chino');

-- ---------- 2. Fuera el material genérico ----------

SET @fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos'
     AND COLUMN_NAME = 'material_id' AND REFERENCED_TABLE_NAME = 'materiales' LIMIT 1
);
SET @sql := IF(@fk IS NOT NULL, CONCAT('ALTER TABLE productos DROP FOREIGN KEY ', @fk), 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @hay_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'material_id'
);
SET @sql := IF(@hay_col = 1, 'ALTER TABLE productos DROP COLUMN material_id', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS materiales;

-- ---------- 3. Calibres por material ----------

SET @hay_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categorias' AND COLUMN_NAME = 'calibres'
);
SET @sql := IF(
  @hay_col = 0,
  'ALTER TABLE categorias ADD COLUMN calibres VARCHAR(255) AFTER descripcion',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Calibres de los materiales que ya existen, según lo que maneja la tienda.
UPDATE categorias SET calibres = '1/30,2/30'
 WHERE calibres IS NULL AND nombre LIKE '%crilan%';
UPDATE categorias SET calibres = '2/48'
 WHERE calibres IS NULL AND nombre LIKE '%iscosa%';
