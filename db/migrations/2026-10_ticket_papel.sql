-- =============================================================================
-- 2026-10-14 · Ancho del papel del TICKET
-- -----------------------------------------------------------------------------
-- La impresora de la tienda está instalada como "POS-58" (rollo de 58 mm). El
-- ticket se acomoda al papel: 58 mm (imprime 48) u 80 mm (imprime 72). Se elige
-- en Admin -> Configuración -> Ticket. Pública: la lee el ticket con los demás
-- datos de la tienda. Idempotente.
-- =============================================================================

INSERT INTO configuracion (clave, valor, descripcion, publica) VALUES
 ('ticket_papel_mm', '58', 'Ancho del rollo de la impresora de tickets, en mm: 58 u 80.', 1)
ON DUPLICATE KEY UPDATE clave = clave;
