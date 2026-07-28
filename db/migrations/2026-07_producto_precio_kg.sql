-- =====================================================================
--  Migración · Precio por kilo a nivel PRODUCTO
--
--  El precio que se cobra sigue viviendo en `producto_variantes.precio`: es el
--  que congela el pedido y el que manda al vender. Esta columna NO lo reemplaza.
--
--  `productos.precio_kg` es el precio de LISTA del hilo: "MARINO OSCURO 2/30
--  cuesta $200 el kilo". Sirve para dos cosas:
--    · capturarlo al dar de alta el producto, que es como lo piensa la tienda
--      (el precio es del hilo, no de cada presentación);
--    · que las presentaciones que se creen después —a mano o con el vaciado
--      masivo del Excel— arranquen con ese precio en vez de teclearlo cada vez.
--
--  Si una presentación necesita otro precio, se le cambia y gana el de la
--  variante. La prelación al vender no se toca:
--      precio del tipo de cliente > precio_oferta > precio de la variante
-- =====================================================================

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos'
     AND COLUMN_NAME = 'precio_kg'
);
SET @sql := IF(@existe = 0,
  'ALTER TABLE productos
     ADD COLUMN precio_kg DECIMAL(12,2) NULL AFTER grosor_calibre',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Los productos que ya tienen presentaciones heredan el precio de su paquete
-- (o de la primera presentación que tenga precio), para que la columna no
-- arranque vacía en el catálogo que ya existe.
UPDATE productos p
   SET p.precio_kg = (
     SELECT pv.precio FROM producto_variantes pv
      WHERE pv.producto_id = p.id AND pv.precio IS NOT NULL
      ORDER BY pv.tipo_presentacion = 'paquete' DESC, pv.id
      LIMIT 1
   )
 WHERE p.precio_kg IS NULL;
