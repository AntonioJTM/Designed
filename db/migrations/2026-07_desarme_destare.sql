-- =====================================================================
--  Migración · Destare del desarme
--
--  Al enconar, el hilo pesa MÁS que en el paquete: cada cono lleva su tubo. La
--  tienda captura ese aumento a mano —no lo calcula el sistema, porque depende
--  del tubo que se use— y con él sabe cuánto pesa de verdad lo que bajó al
--  mostrador:
--
--      paquete 18.500 kg  +  destare 0.500  =  19.000 kg enconados
--
--  Va en la CONVERSIÓN y no en la presentación a propósito: cada desarme puede
--  llevar un destare distinto, así que no es una propiedad del cono sino de esa
--  bajada en concreto.
--
--  `kg_consumidos` NO cambia: del paquete sale su peso real y eso es lo que se
--  descuenta del inventario. El destare solo dice cuánto pesó el resultado.
-- =====================================================================

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'variante_conversiones'
     AND COLUMN_NAME = 'destare_kg'
);
SET @sql := IF(@existe = 0,
  'ALTER TABLE variante_conversiones
     ADD COLUMN destare_kg DECIMAL(12,3) NULL AFTER kg_consumidos',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
