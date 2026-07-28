-- =====================================================================
--  Migración · Estado del bulto: disponible / vendido / desarmado
--
--  Un bulto es una pieza física única. Hasta aquí se podía escanear uno ya
--  vendido o ya desarmado y el sistema lo aceptaba: solo el saldo en kilos de la
--  variante frenaba la venta, y ese saldo no sabe QUÉ bultos lo componen. Con el
--  estado, el bulto se consume una sola vez.
--
--  Qué consume un bulto:
--    · venderlo en el mostrador (queda 'vendido', con el pedido de referencia)
--    · desarmarlo en conos     (queda 'desarmado', con la conversión)
--  Cancelar o devolver el pedido lo regresa a 'disponible': el bulto volvió.
-- =====================================================================

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'variante_codigos'
     AND COLUMN_NAME = 'estado'
);
SET @sql := IF(@existe = 0, CONCAT(
  'ALTER TABLE variante_codigos ',
  'ADD COLUMN estado VARCHAR(12) NOT NULL DEFAULT ''disponible'' ',
  '  CHECK (estado IN (''disponible'',''vendido'',''desarmado'')) AFTER conos, ',
  -- Cuándo y en qué documento se consumió, para poder rastrearlo.
  'ADD COLUMN consumido_en DATETIME NULL AFTER estado, ',
  'ADD COLUMN consumido_tipo VARCHAR(20) NULL AFTER consumido_en, ',
  'ADD COLUMN consumido_id BIGINT UNSIGNED NULL AFTER consumido_tipo, ',
  'ADD INDEX idx_variante_codigos_estado (estado)'
), 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Los bultos que YA se vendieron antes de esta migración quedan marcados, para
-- que el estado no arranque mintiendo. Se reconocen por el rastro que dejó la
-- venta en pedido_detalle_bultos (excluyendo pedidos cancelados o devueltos).
UPDATE variante_codigos vc
   JOIN pedido_detalle_bultos b ON b.variante_codigo_id = vc.id
   JOIN pedido_detalle pd       ON pd.id = b.detalle_id
   JOIN pedidos p               ON p.id = pd.pedido_id
    SET vc.estado = 'vendido',
        vc.consumido_en = p.creado_en,
        vc.consumido_tipo = 'pedido',
        vc.consumido_id = p.id
  WHERE vc.estado = 'disponible'
    AND p.estado NOT IN ('cancelado', 'devuelto');

-- Igual con los que se desarmaron dejando su código en la conversión.
UPDATE variante_codigos vc
   JOIN variante_conversiones c ON c.codigo_bulto = vc.codigo
    SET vc.estado = 'desarmado',
        vc.consumido_en = c.creado_en,
        vc.consumido_tipo = 'conversion',
        vc.consumido_id = c.id
  WHERE vc.estado = 'disponible';
