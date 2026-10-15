-- =====================================================================
--  Migración · LO QUE REGRESA NO PAGA COMISIÓN NI CUENTA COMO VENDIDO
--  (2026-10-14, después de las devoluciones con saldo a favor)
--
--  "Si una venta de $1,000 regresa $400, la comisión tiene que ser sobre lo
--  que se vendió, que serían los $600" y "como regresa a inventario, se le
--  resta [a los reportes] y se actualiza, porque al final es hilo que se
--  regresó" (usuario).
--
--  · nomina_comisiones.devuelto: cuánto de la venta (sin IVA) regresó y ya no
--    pagó comisión en ese renglón. Si regresa DESPUÉS de que su comisión se
--    pagó, la siguiente nómina lleva un renglón tipo 'devolucion' que la
--    descuenta (venta neta y comisión en negativo).
--  · El tipo 'nota' (nota pendiente de pago, 2026-10-13) FALTABA en el CHECK:
--    calcular una nómina con una nota pendiente ya pagada habría fallado.
--  · v_mas_vendidos: lo vendido MENOS lo que regresó de cada línea.
-- =====================================================================

ALTER TABLE nomina_comisiones DROP CONSTRAINT chk_nomcom_tipo;
ALTER TABLE nomina_comisiones
    ADD COLUMN devuelto DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER venta_neta,
    ADD CONSTRAINT chk_nomcom_tipo
        CHECK (tipo IN ('contado', 'credito', 'apartado', 'pedido', 'nota', 'devolucion'));

CREATE OR REPLACE VIEW v_mas_vendidos AS
SELECT pv.id AS variante_id, pv.sku AS sku, p.nombre AS producto,
       SUM(pd.cantidad - COALESCE(dev.kg, 0)) AS unidades_vendidas,
       SUM(pd.subtotal - COALESCE(dev.kg * pd.subtotal / NULLIF(pd.cantidad, 0), 0)) AS ingresos
  FROM pedido_detalle pd
  JOIN producto_variantes pv ON pv.id = pd.variante_id
  JOIN productos p           ON p.id = pv.producto_id
  JOIN pedidos ped           ON ped.id = pd.pedido_id
  LEFT JOIN (SELECT detalle_id, SUM(cantidad) AS kg FROM devolucion_detalle GROUP BY detalle_id) dev
         ON dev.detalle_id = pd.id
 WHERE ped.estado NOT IN ('cancelado', 'devuelto')
 GROUP BY pv.id, pv.sku, p.nombre;
