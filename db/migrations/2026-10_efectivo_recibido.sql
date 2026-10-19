-- =====================================================================
--  LO QUE ENTREGÓ EL CLIENTE EN EFECTIVO (2026-10-16: "cuánto dinero
--  recibiste: si te dio 2,300 y fueron 2,250, cuánto le diste de cambio";
--  se ve al abrir la venta).
--
--  · `pagos.recibido`: el billete que entregó, SOLO informativo. El pago sigue
--    asentándose por lo COBRADO (`monto`): el cambio no es dinero de la tienda
--    y el corte de caja no cambia. Cambio = recibido − monto.
--  · NULL en lo que no es efectivo y en los pagos de antes de hoy (no se sabe).
--
--  Se puede correr dos veces sin efecto.
-- =====================================================================

ALTER TABLE pagos
  ADD COLUMN IF NOT EXISTS recibido DECIMAL(12,2) NULL AFTER monto;
