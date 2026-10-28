-- =====================================================================
--  EL HORARIO DE LA SEMANA, CONGELADO EN SU RECIBO (2026-10-26, auditoría).
--
--  El recibo pagaba con el horario de esa semana, pero al reimprimirlo (el PDF,
--  "Su semana" y los días del recibo) se pegaba el horario VIGENTE: una semana
--  pagada con 6 de 6 días salía con el sábado "Descanso" si después se le cambió
--  el horario a lunes-viernes.
--
--  · nomina_recibos.horario_json: el horario con que se calculó (un renglón por
--    día: dia_semana, entrada, salida). Una semana PAGADA lo usa; una en borrador
--    sigue con el vigente (se recalcula). Los recibos de antes quedan en NULL y
--    siguen con el vigente.
--
--  Se puede correr dos veces sin efecto.
-- =====================================================================

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nomina_recibos'
     AND COLUMN_NAME = 'horario_json'
);
SET @sql := IF(@existe = 0,
  'ALTER TABLE nomina_recibos ADD COLUMN horario_json TEXT DEFAULT NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
