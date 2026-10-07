-- =====================================================================
--  Migración · Cuántas piezas (conos) llevó cada renglón de una venta
--  (2026-10-06)
--
--  "La gente solo dice 'vengo por 6 conos de tal color'; se pesan los conos
--  y se calcula el precio con los precios por kilo" (usuario). La venta se
--  cobra y se descuenta en KILOS, como siempre; esto solo deja escrito
--  cuántos conos eran, para que el pedido diga "6 conos · 9.35 kg" y no
--  solo los kilos.
--
--  Es INFORMATIVO, igual que `variante_conversiones.piezas_generadas`: la
--  unidad de inventario sigue siendo el kilo. NULL = no se contaron piezas
--  (un paquete escaneado o una venta por kilo).
-- =====================================================================

ALTER TABLE pedido_detalle
    ADD COLUMN piezas INT UNSIGNED NULL AFTER cantidad;
