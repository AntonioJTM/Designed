-- =====================================================================
--  Migración · Fuera el peso y la longitud a nivel producto
--
--  `productos.peso_kg` duplicaba información: el peso que el sistema usa de
--  verdad es el de la VARIANTE (`producto_variantes.peso_kg`), que define
--  cuánto pesa un paquete y con eso calcula el precio del cono y el desarme.
--  Tener un segundo peso en el producto solo invitaba a confundirlo con las
--  existencias — de hecho fue lo que provocó el error "Out of range value".
--
--  `productos.longitud_metros` quedó como columna muerta cuando se retiró su
--  campo del formulario: nada la escribía ni la leía.
--
--  El peso de las variantes NO se toca.
-- =====================================================================

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'peso_kg'
);
SET @sql := IF(@existe = 1, 'ALTER TABLE productos DROP COLUMN peso_kg', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'longitud_metros'
);
SET @sql := IF(@existe = 1, 'ALTER TABLE productos DROP COLUMN longitud_metros', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
