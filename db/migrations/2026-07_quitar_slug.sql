-- =====================================================================
--  Migración · Fuera los slugs
--
--  `productos.slug` y `categorias.slug` se generaban a partir del nombre y se
--  guardaban, pero nada los consumía: la tienda en línea navega por id
--  (/tienda/producto/:id) y el único uso real era engordar el filtro de
--  búsqueda, que ya busca por nombre y descripción.
--
--  Su restricción UNIQUE además provocaba choques al capturar dos productos
--  con nombres parecidos, sin ganar nada a cambio.
--
--  Si algún día se quieren URLs legibles (/producto/hilo-azul-rey) hay que
--  volver a agregar la columna y regenerarla desde el nombre; es trivial.
-- =====================================================================

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'slug'
);
SET @sql := IF(@existe = 1, 'ALTER TABLE productos DROP COLUMN slug', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categorias' AND COLUMN_NAME = 'slug'
);
SET @sql := IF(@existe = 1, 'ALTER TABLE categorias DROP COLUMN slug', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
