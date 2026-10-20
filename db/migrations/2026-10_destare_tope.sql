-- =============================================================================
-- 2026-10-20 · El TOPE del destare por cono
-- -----------------------------------------------------------------------------
-- Auditoría (/verificar): en hitex dos bajadas de A-ALECRICO llevan 0.8 kg de
-- destare POR CONO (9.6 kg sobre paquetes de 19.5 y 19.3 kg): un tubo pesa
-- gramos, no casi un kilo. El servidor dejaba hasta 1 kg por cono.
--
-- "Este yo lo pongo" (usuario): el tope lo fija la tienda en Admin ->
-- Configuración -> Bajar conos. Vacío = sin tope propio (sigue el de 1 kg).
-- Pública: la lee la ventana de bajar conos para avisar antes de mandar.
-- Idempotente.
-- =============================================================================

INSERT INTO configuracion (clave, valor, descripcion, publica) VALUES
 ('desarme_destare_max_kg', '', 'Lo más que puede pesar el tubo de UN cono (el destare por cono), en kg. Vacío: sin tope propio.', 1)
ON DUPLICATE KEY UPDATE clave = clave;
