-- =============================================================================
-- DÍAS DE CRÉDITO DE CADA NOTA (2026-10-20, usuario: "cuando se realiza una venta
-- a crédito, que diga a cuántos días es la nota; después de los días, si no
-- paga, hacerse acreedor a una notificación").
--
-- Los días se escriben en CADA venta a crédito (lo eligió el usuario); la nota
-- vence el día en que se fió más sus días. Reemplaza la regla fija de "15 días
-- sin pagarse" de la caja, la campana, Cuánto debe y Cómo va el negocio: una
-- cuenta está atrasada cuando alguna nota ya pasó su fecha. Una nota de antes
-- (NULL) cuenta con 15 días, igual que siempre.
-- =============================================================================

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dias_credito SMALLINT UNSIGNED NULL;

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS chk_pedidos_dias_credito;
ALTER TABLE pedidos ADD CONSTRAINT chk_pedidos_dias_credito
  CHECK (dias_credito IS NULL OR dias_credito BETWEEN 1 AND 365);
