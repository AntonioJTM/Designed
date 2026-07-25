-- =====================================================================
--  Migración · Almacén matriz
--
--  La tienda principal (Cuautepec de Hinojosa) es la que surte a las demás
--  sucursales. Marcarla explícitamente permite que el formulario de
--  traspasos proponga el origen solo, en vez de depender de que quien
--  captura se acuerde.
--
--  A diferencia de `es_tienda_linea`, no tener matriz no rompe nada: el
--  origen simplemente se elige a mano.
-- =====================================================================

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'almacenes'
     AND COLUMN_NAME = 'es_matriz'
);
SET @sql := IF(
  @existe = 0,
  'ALTER TABLE almacenes ADD COLUMN es_matriz BOOLEAN NOT NULL DEFAULT FALSE AFTER es_tienda_linea',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Si todavía no hay matriz, propone el primer punto de venta activo. En una
-- instalación nueva eso es la tienda principal.
SET @ya_marcada := (SELECT COUNT(*) FROM almacenes WHERE es_matriz = 1);
UPDATE almacenes
   SET es_matriz = TRUE
 WHERE @ya_marcada = 0
   AND id = (
     SELECT id FROM (
       SELECT id FROM almacenes WHERE activo = 1 ORDER BY es_punto_venta DESC, id LIMIT 1
     ) AS elegida
   );
