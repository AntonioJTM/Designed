-- =====================================================================
--  Migración · Fuera el color de la variante y la tabla `colores`
--
--  El COLOR es el producto: cada color es un producto propio (CARAMEL, HUESO,
--  rojo, azul), no un atributo de la presentación. Se comprobó antes de borrar:
--  la tabla `colores` estaba vacía y ninguna variante tenía `color_id`.
--
--  Es la misma limpieza que se hizo con `materiales` / `productos.material_id`:
--  que "color" signifique una sola cosa y no haya dos lugares donde vive.
--
--  Orden obligatorio: primero las VISTAS que leen la columna, luego la llave
--  foránea y el índice, después la columna, y al final la tabla.
-- =====================================================================

-- ---------- 1. Vistas: se recrean sin el color ----------
-- v_alertas_stock hace SELECT * de v_stock_disponible, así que hay que
-- recrearla también o se queda con la columna vieja congelada.
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

-- ---------- 2. Llave foránea (nombre autogenerado: se busca) ----------
SET @fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'producto_variantes'
     AND COLUMN_NAME = 'color_id' AND REFERENCED_TABLE_NAME = 'colores'
   LIMIT 1
);
SET @sql := IF(@fk IS NOT NULL,
  CONCAT('ALTER TABLE producto_variantes DROP FOREIGN KEY ', @fk), 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 3. Índice ----------
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'producto_variantes'
     AND INDEX_NAME = 'idx_variantes_color'
);
SET @sql := IF(@idx > 0,
  'ALTER TABLE producto_variantes DROP INDEX idx_variantes_color', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 4. La columna ----------
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'producto_variantes'
     AND COLUMN_NAME = 'color_id'
);
SET @sql := IF(@col > 0,
  'ALTER TABLE producto_variantes DROP COLUMN color_id', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 5. La tabla ----------
DROP TABLE IF EXISTS colores;
