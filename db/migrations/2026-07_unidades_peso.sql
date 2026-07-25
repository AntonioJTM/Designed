-- =====================================================================
--  Migración · El hilo se vende por PESO, no por pieza
--  El catálogo `unidades_medida` traía unidades de conteo (pieza, madeja,
--  cono, bolsa) y de longitud (metro). En esta tienda el producto siempre
--  se compra, inventaría y vende por peso, así que el catálogo pasa a ser
--  gramo / kilogramo / tonelada.
--
--  Consecuencia en el resto del sistema: las cantidades dejan de ser
--  enteras. `inventario.cantidad` y `pedido_detalle.cantidad` ya eran
--  DECIMAL(12,3), así que soportan 2.500 kg sin cambios de esquema; lo que
--  se ajustó fue el paso de los campos de captura en POS y carrito.
-- =====================================================================

-- Alta de las unidades de peso. `nombre` y `abreviatura` son UNIQUE, así que
-- INSERT IGNORE hace esto idempotente.
INSERT IGNORE INTO unidades_medida (nombre, abreviatura) VALUES
 ('Gramo','g'), ('Kilogramo','kg'), ('Tonelada','t');

-- Baja de las unidades que no son de peso, solo si ningún producto las usa.
-- En una instalación con productos ya capturados no se borra nada: primero
-- hay que reasignarlos a una unidad de peso.
DELETE FROM unidades_medida
 WHERE abreviatura NOT IN ('g','kg','t')
   AND id NOT IN (SELECT unidad_medida_id FROM productos);
