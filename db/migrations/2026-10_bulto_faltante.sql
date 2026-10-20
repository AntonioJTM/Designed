-- =====================================================================
--  Migración · El paquete que NO LLEGÓ en un envío (2026-10-20)
--
--  Auditoría (/verificar): al recibir un envío con faltante se decía "llegaron
--  18 de 20" y los kilos de los 2 que faltaron se daban de baja (merma), pero
--  los DOS PAQUETES seguían 'disponibles' en la sucursal: paquetes fantasma que
--  la caja podía "vender" y que descuadraban el detalle del hilo.
--
--  Ahora quien recibe palomea CUÁLES no llegaron (el usuario eligió "marcar
--  cuáles faltaron"): esos pasan a 'faltante' (con `consumido_tipo =
--  'traspaso'` y el envío en `consumido_id`) y la merma es su peso real.
--
--  Solo cambia la lista de estados válidos del bulto. No toca datos.
-- =====================================================================

ALTER TABLE variante_codigos DROP CONSTRAINT variante_codigos_chk_1;
ALTER TABLE variante_codigos ADD CONSTRAINT variante_codigos_chk_1
    CHECK (estado IN ('disponible', 'apartado', 'vendido', 'desarmado', 'faltante'));
