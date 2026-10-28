-- =====================================================================
--  LO QUE SE REGRESÓ EN EFECTIVO DE UN PAGO (2026-10-26, auditoría #9).
--
--  Una nota en espera pagada por transferencia que al final pesó menos: al
--  entregarla se le regresa la diferencia en EFECTIVO del cajón y su pago baja a
--  lo que de verdad se cobró (así la cancelación y lo cobrado cuadran). Pero al
--  banco entró la transferencia completa: Transferencias tiene que seguir diciendo
--  eso para cuadrar con el estado de cuenta.
--
--  · pagos.devuelto_efectivo: de este pago, lo que se le regresó en efectivo. El
--    `monto` sigue siendo lo cobrado; Transferencias suma monto + devuelto_efectivo
--    (lo que llegó al banco) y lo dice: "se le regresaron $60 en efectivo".
--
--  Se puede correr dos veces sin efecto.
-- =====================================================================

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos'
     AND COLUMN_NAME = 'devuelto_efectivo'
);
SET @sql := IF(@existe = 0,
  'ALTER TABLE pagos ADD COLUMN devuelto_efectivo DECIMAL(12,2) DEFAULT NULL AFTER recibido',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
