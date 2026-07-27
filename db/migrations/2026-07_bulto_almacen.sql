-- =====================================================================
--  Migración · Cada bulto sabe en qué almacén está
--
--  Hasta aquí el bulto no tenía ubicación, y el traspaso descontaba
--  paquetes × peso NOMINAL de la presentación. Eso descuadra siempre, porque los
--  bultos pesan distinto: mandar 5 paquetes de MARINO OSCURO descontaba 95.470 kg
--  cuando los 5 primeros pesan 93.950 kg.
--
--  Con la ubicación, el traspaso puede tomar los bultos que de verdad hay en el
--  almacén de origen y descontar SU peso real. Quien surte sigue pidiendo
--  "5 paquetes de blanco": el sistema elige cuáles (los más antiguos, FIFO) y
--  hace la cuenta exacta. Nadie tiene que pesar ni buscar un bulto concreto.
-- =====================================================================

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'variante_codigos'
     AND COLUMN_NAME = 'almacen_id'
);
SET @sql := IF(@existe = 0, CONCAT(
  'ALTER TABLE variante_codigos ',
  'ADD COLUMN almacen_id SMALLINT UNSIGNED NULL AFTER conos, ',
  'ADD INDEX idx_variante_codigos_almacen (almacen_id), ',
  'ADD CONSTRAINT fk_variante_codigos_almacen ',
  '  FOREIGN KEY (almacen_id) REFERENCES almacenes(id)'
), 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Los bultos que ya existen quedan en el almacén donde entró su remesa: es el
-- único dato fiable de dónde están.
UPDATE variante_codigos vc
   JOIN remesas r ON r.id = vc.remesa_id
    SET vc.almacen_id = r.almacen_id
  WHERE vc.almacen_id IS NULL;

-- Los que se capturaron a mano (sin remesa) se quedan en NULL a propósito: no se
-- sabe dónde están y no conviene inventarlo. El traspaso los ignora y usa el
-- peso promedio de los que sí están ubicados.
