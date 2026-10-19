-- =====================================================================
--  UNA VENTA SE REGISTRA UNA SOLA VEZ (2026-10-19, revisión /verificar:
--  "el botón Cobrar no se bloquea mientras registra la venta").
--
--  · `pedidos.clave_cobro`: la caja manda una llave de un solo uso con cada
--    venta. Si la misma venta llega dos veces (doble clic, o la red que la
--    reintenta), el servidor no crea otra: contesta la que ya registró.
--  · NULL en lo de antes y en lo que no la manda (la tienda en línea). El
--    índice ÚNICO admite muchos NULL y hace que dos peticiones al mismo tiempo
--    no puedan registrar la misma llave.
--
--  Se puede correr dos veces sin efecto.
-- =====================================================================

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS clave_cobro CHAR(36) NULL AFTER numero_pedido;

ALTER TABLE pedidos
  ADD UNIQUE INDEX IF NOT EXISTS uq_pedidos_clave_cobro (clave_cobro);
