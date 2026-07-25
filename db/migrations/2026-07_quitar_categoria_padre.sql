-- =====================================================================
--  Migración · Fuera la jerarquía de categorías
--
--  `categorias.padre_id` permitía anidar categorías, pero nada aprovechaba
--  el árbol: el catálogo filtra por `productos.categoria_id` exacto, sin
--  recursión, así que una categoría padre nunca mostraba los productos de
--  sus hijas. Solo servía para capturarla y mostrarla.
--
--  Las categorías quedan como una lista plana, que es como se usan.
--
--  El nombre de la llave foránea se busca en information_schema porque MySQL
--  lo genera automáticamente (categorias_ibfk_1) y puede variar entre bases.
-- =====================================================================

-- 1. Suelta la llave foránea auto-referenciada, si existe.
SET @fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'categorias'
     AND COLUMN_NAME = 'padre_id'
     AND REFERENCED_TABLE_NAME = 'categorias'
   LIMIT 1
);
SET @sql := IF(@fk IS NOT NULL, CONCAT('ALTER TABLE categorias DROP FOREIGN KEY ', @fk), 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Retira la columna. El índice que la acompaña se va con ella.
SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categorias' AND COLUMN_NAME = 'padre_id'
);
SET @sql := IF(@existe = 1, 'ALTER TABLE categorias DROP COLUMN padre_id', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
