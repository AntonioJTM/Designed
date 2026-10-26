-- =====================================================================
--  EL VENDEDOR DE LA NOTA (2026-10-23, usuario: "Nota de venta: añadir
--  vendedor"). En la caja se elige quién atendió al cliente, aparte de quién
--  cobra.
--
--  · `pedidos.usuario_id` sigue siendo quien la REGISTRÓ («Elaboró»).
--  · `pedidos.vendedor_id` es quien la VENDIÓ: a esa persona va la comisión
--    (decisión del usuario). NULL = la vendió quien la registró, así lo de
--    antes y lo que no lo manda (la tienda en línea) se lee igual que siempre:
--    `COALESCE(vendedor_id, usuario_id)`.
--  · Si se borra a esa persona la venta se queda (ON DELETE SET NULL).
--
--  Se puede correr dos veces sin efecto.
-- =====================================================================

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos'
     AND COLUMN_NAME = 'vendedor_id'
);
SET @sql := IF(@existe = 0, CONCAT(
  'ALTER TABLE pedidos ',
  'ADD COLUMN vendedor_id BIGINT UNSIGNED NULL AFTER usuario_id, ',
  'ADD KEY idx_pedidos_vendedor (vendedor_id), ',
  'ADD CONSTRAINT fk_pedidos_vendedor FOREIGN KEY (vendedor_id) REFERENCES usuarios(id) ON DELETE SET NULL'
), 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
