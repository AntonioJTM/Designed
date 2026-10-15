-- =====================================================================
--  Migración · ANTICIPOS: DINERO A CUENTA, SIN NOTA (2026-10-14)
--
--  "Se dan anticipos en efectivo y transferencia" (usuario): el cliente deja
--  dinero antes de comprar, sin llevarse nada todavía. Le queda como SALDO A
--  FAVOR para sus próximas compras (el mismo libro de las devoluciones); el
--  efectivo entra al turno de caja que lo recibe (al corte de ese día) y la
--  transferencia no toca la caja. Puede dejar parte y parte.
--
--  · saldo_favor_movimientos.tipo admite 'anticipo' (+).
--  · metodo_pago_id, sesion_caja_id y referencia: con qué dejó el dinero, a
--    qué turno entró el efectivo y el folio de la transferencia.
-- =====================================================================

ALTER TABLE saldo_favor_movimientos DROP CONSTRAINT chk_sfm_tipo;
ALTER TABLE saldo_favor_movimientos
    ADD COLUMN metodo_pago_id SMALLINT UNSIGNED NULL AFTER devolucion_id,
    ADD COLUMN sesion_caja_id BIGINT UNSIGNED NULL AFTER metodo_pago_id,
    ADD COLUMN referencia VARCHAR(120) NULL AFTER sesion_caja_id,
    ADD CONSTRAINT chk_sfm_tipo
        CHECK (tipo IN ('devolucion', 'anticipo', 'uso', 'aplicado', 'reintegro', 'ajuste')),
    ADD CONSTRAINT fk_sfm_metodo FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago (id),
    ADD CONSTRAINT fk_sfm_sesion FOREIGN KEY (sesion_caja_id) REFERENCES sesiones_caja (id);
