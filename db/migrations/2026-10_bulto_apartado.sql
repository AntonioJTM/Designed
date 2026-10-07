-- =====================================================================
--  Migración · El paquete APARTADO para un pedido (2026-10-06)
--
--  "Cuando se pone el pedido se tienen que escanear los paquetes o pesar los
--  conos que pidió, para corroborar que sí esté bien" (usuario). Al TOMAR un
--  pedido o un apartado, o al PREPARAR el pedido, los paquetes escaneados
--  quedan ligados a él (`pedido_detalle_bultos`) y pasan a 'apartado': siguen
--  en la tienda —el saldo no baja— pero ya tienen dueño, así que la caja no se
--  los vende a otro, no se bajan a conos y no se mandan a una sucursal. Al
--  ENTREGAR pasan a 'vendido'; al cancelar regresan a 'disponible'.
--
--  Antes el pedido apartaba KILOS y los paquetes seguían "disponibles"; al
--  entregarlo ninguno quedaba vendido y el conteo de paquetes no cuadraba.
--
--  Solo cambia la lista de estados válidos del bulto. No toca datos.
-- =====================================================================

ALTER TABLE variante_codigos DROP CONSTRAINT variante_codigos_chk_1;
ALTER TABLE variante_codigos ADD CONSTRAINT variante_codigos_chk_1
    CHECK (estado IN ('disponible', 'apartado', 'vendido', 'desarmado'));
