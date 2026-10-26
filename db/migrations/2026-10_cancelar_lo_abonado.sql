-- =====================================================================
--  AL CANCELAR UNA VENTA A CRÉDITO, SOLO EL DINERO SE REGRESA (2026-10-26,
--  auditoría #4, #6 y #21; decisiones del usuario: lo condonado "se borra con la
--  venta" y la comisión va "solo sobre lo cobrado").
--
--  · Transferencias: un renglón nuevo, 'regreso' = lo abonado que se le regresó
--    por el banco al cancelar (el ajuste de su saldo a favor con el método de
--    transferencia). Va en negativo y resta de la cuenta de la que salió.
--  · nomina_comisiones.condonado: lo de la venta neta que NO paga comisión porque
--    se cubrió con un ajuste a mano («Corregir deuda»). Congelado como lo demás.
--
--  Se puede correr dos veces sin efecto.
-- =====================================================================

ALTER TABLE transferencias DROP CONSTRAINT IF EXISTS chk_transferencias_fuente;
ALTER TABLE transferencias ADD CONSTRAINT chk_transferencias_fuente
  CHECK (fuente IN ('pago', 'abono', 'anticipo', 'regreso'));

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nomina_comisiones'
     AND COLUMN_NAME = 'condonado'
);
SET @sql := IF(@existe = 0,
  'ALTER TABLE nomina_comisiones ADD COLUMN condonado DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER devuelto',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
