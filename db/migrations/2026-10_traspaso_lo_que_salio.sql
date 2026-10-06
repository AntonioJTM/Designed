-- =====================================================================
--  Migración · El traspaso guarda lo que se PIDIÓ y lo que SALIÓ (2026-10-06)
--
--  Lo pidió el usuario: "quisiera que solo se mande lo que se tiene: si pido
--  20 bultos de negro 1/30 y solo tengo 15, que se envíen esos y nada más, y
--  que en notas se ponga que no se envió, que era lo único que tenía".
--
--  Al enviar se escanean los paquetes y la línea se reescribe con lo que de
--  verdad salió (`paquetes` y `cantidad`). Sin estas columnas se perdía lo
--  que se había pedido y no habría cómo decir "salieron 15 de 20".
--
--  · traspaso_detalle.paquetes_solicitados / cantidad_solicitada: lo pedido.
--  · La cantidad puede ser 0: un hilo del que no había nada NO sale, pero la
--    línea se queda para que se vea que se pidió y no salió.
--  · traspasos.envio_notas: lo que no salió completo (lo escribe el sistema)
--    y lo que añada quien surte.
-- =====================================================================

ALTER TABLE traspaso_detalle
  ADD COLUMN paquetes_solicitados DECIMAL(12,3) NULL AFTER variante_id,
  ADD COLUMN cantidad_solicitada  DECIMAL(12,3) NULL AFTER paquetes_solicitados;

-- Lo que ya existe: lo pedido es lo que dice la línea (en las ya enviadas es lo
-- que salió, que es lo mejor que se sabe).
UPDATE traspaso_detalle
   SET paquetes_solicitados = paquetes, cantidad_solicitada = cantidad
 WHERE cantidad_solicitada IS NULL;

ALTER TABLE traspaso_detalle DROP CONSTRAINT traspaso_detalle_chk_1;
ALTER TABLE traspaso_detalle ADD CONSTRAINT traspaso_detalle_chk_1 CHECK (cantidad >= 0);

ALTER TABLE traspasos ADD COLUMN envio_notas TEXT NULL AFTER enviado_por;
