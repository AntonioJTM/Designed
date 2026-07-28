-- =====================================================================
--  Migración · Almacén que surte la tienda en línea
--  Antes, el checkout online elegía almacén por convención implícita
--  (el primer activo ordenado por es_punto_venta), lo que hacía invisible
--  el stock de mostrador para la tienda web sin que nada lo dijera.
--  Ahora se marca explícitamente con `almacenes.es_tienda_linea`.
--  Si ningún almacén está marcado, el backend cae al comportamiento
--  anterior para no romper instalaciones existentes.
-- =====================================================================

-- Alta de la columna (idempotente: MySQL no soporta ADD COLUMN IF NOT EXISTS).
SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'almacenes'
     AND COLUMN_NAME = 'es_tienda_linea'
);
SET @sql := IF(
  @existe = 0,
  'ALTER TABLE almacenes ADD COLUMN es_tienda_linea BOOLEAN NOT NULL DEFAULT FALSE AFTER es_punto_venta',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Conserva el comportamiento vigente: marca el almacén que el código venía
-- eligiendo. Solo actúa si todavía no hay ninguno marcado.
SET @ya_marcado := (SELECT COUNT(*) FROM almacenes WHERE es_tienda_linea = 1);
UPDATE almacenes
   SET es_tienda_linea = TRUE
 WHERE @ya_marcado = 0
   AND id = (
     SELECT id FROM (
       SELECT id FROM almacenes WHERE activo = 1 ORDER BY es_punto_venta ASC, id LIMIT 1
     ) AS elegido
   );
