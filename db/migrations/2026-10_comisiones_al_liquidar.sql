-- =====================================================================
--  Migración · La comisión se paga cuando la venta se LIQUIDA (2026-10-07)
--
--  "Si fue una venta a crédito no se pagan comisiones hasta que se liquide…
--  las comisiones se pagan por semana: si esta semana vendió a crédito, no se
--  pagó y cerré mi nómina, no se mete; cuando se liquide, digamos después de
--  2 semanas, ahí se agrega" (usuario). Igual los apartados y los pedidos. Y
--  "de las comisiones queremos un reporte para ver qué se está pagando de cada
--  venta, por semana".
--
--  `nomina_comisiones` anota qué ventas paga cada recibo (una venta, una sola
--  vez): es lo que impide pagarla dos veces y es el reporte. Guarda congelado lo
--  que se pagó (folio, cliente, tipo, cuándo se vendió y cuándo se liquidó,
--  total, venta neta, % y comisión), como el recibo congela sus montos.
--
--  La regla rige desde la semana del domingo 4 de octubre de 2026. Las ventas
--  que ya entraron en una nómina PAGADA de esa semana en adelante se anotan aquí
--  (las que existían cuando se calculó el recibo) para que no se vuelvan a
--  pagar al liquidarse; `liquidada_en` queda vacío en esas: se pagaron con la
--  regla anterior, el día de la venta.
-- =====================================================================

CREATE TABLE nomina_comisiones (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    recibo_id BIGINT UNSIGNED NOT NULL,
    pedido_id BIGINT UNSIGNED NULL,
    numero_pedido VARCHAR(40) NOT NULL,
    cliente VARCHAR(160) NULL,
    tipo VARCHAR(10) NOT NULL,
    vendida_en DATETIME NOT NULL,
    liquidada_en DATETIME NULL,
    total DECIMAL(12,2) NOT NULL,
    venta_neta DECIMAL(12,2) NOT NULL,
    porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    comision DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    PRIMARY KEY (id),
    KEY idx_nomcom_recibo (recibo_id),
    KEY idx_nomcom_pedido (pedido_id),
    CONSTRAINT fk_nomcom_recibo FOREIGN KEY (recibo_id) REFERENCES nomina_recibos (id) ON DELETE CASCADE,
    CONSTRAINT fk_nomcom_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE SET NULL,
    CONSTRAINT chk_nomcom_tipo CHECK (tipo IN ('contado', 'credito', 'apartado', 'pedido'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lo que ya se pagó con la regla anterior en nóminas pagadas desde el 4 de
-- octubre: no vuelve a pagar comisión.
INSERT INTO nomina_comisiones
    (recibo_id, pedido_id, numero_pedido, cliente, tipo, vendida_en, liquidada_en,
     total, venta_neta, porcentaje, comision)
SELECT r.id, p.id, p.numero_pedido, COALESCE(c.nombre_comercial, c.nombre),
       CASE
         WHEN EXISTS (SELECT 1 FROM credito_movimientos cm WHERE cm.pedido_id = p.id AND cm.tipo = 'cargo') THEN 'credito'
         WHEN p.encargo = 1 THEN 'pedido'
         WHEN p.estado = 'apartado' OR p.entregado_en IS NOT NULL THEN 'apartado'
         ELSE 'contado'
       END,
       p.creado_en, NULL, p.total, p.subtotal - p.descuento, r.porcentaje_comision,
       ROUND((p.subtotal - p.descuento) * r.porcentaje_comision / 100, 2)
  FROM nomina_recibos r
  JOIN nomina_periodos np ON np.id = r.periodo_id
  JOIN pedidos p          ON p.usuario_id = r.usuario_id
  LEFT JOIN clientes c    ON c.id = p.cliente_id
 WHERE np.estado = 'pagado' AND np.fecha_inicio >= '2026-10-04'
   AND p.creado_en >= np.fecha_inicio AND p.creado_en < np.fecha_fin + INTERVAL 1 DAY
   AND p.creado_en <= r.actualizado_en
   AND p.estado NOT IN ('cancelado', 'devuelto');
