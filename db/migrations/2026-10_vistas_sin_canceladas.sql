-- =====================================================================
--  DOS VISTAS AL DÍA (2026-10-26, auditoría #26 y M11-14).
--
--  · v_movimiento_hilo (Hilo parado): la salida de una venta que después se
--    CANCELÓ ya no cuenta como venta. El kardex no se borra al cancelar (entra la
--    mercancía de regreso), así que la salida seguía diciendo "se vendió el 21/10"
--    y un hilo que nadie compró no salía parado. Lo devuelto con «Devolución» SÍ
--    sigue contando como vendido aquí (decisión del usuario del 2026-10-14: en Hilo
--    parado el hilo "entró y salió").
--  · v_ventas_por_empleado: por el VENDEDOR de la nota (`vendedor_id`, o quien la
--    registró si no se eligió), como la comisión. Hoy ninguna pantalla la usa.
--
--  Se puede correr dos veces sin efecto.
-- =====================================================================

CREATE OR REPLACE VIEW v_movimiento_hilo AS
SELECT  pv.id AS variante_id,
        pv.producto_id,
        MAX(CASE WHEN m.referencia_tipo = 'pedido' AND m.cantidad < 0
                  AND ped.estado NOT IN ('cancelado', 'devuelto')
                 THEN m.creado_en END) AS ultima_salida,
        MAX(CASE WHEN m.referencia_tipo = 'remesa' THEN m.creado_en END) AS ultima_entrada,
        COALESCE(SUM(CASE WHEN m.referencia_tipo = 'pedido' AND m.cantidad < 0
                           AND ped.estado NOT IN ('cancelado', 'devuelto')
                          THEN -m.cantidad ELSE 0 END), 0) AS kg_vendidos_historico
FROM producto_variantes pv
LEFT JOIN movimientos_inventario m ON m.variante_id = pv.id
LEFT JOIN pedidos ped ON m.referencia_tipo = 'pedido' AND ped.id = m.referencia_id
GROUP BY pv.id, pv.producto_id;

CREATE OR REPLACE VIEW v_ventas_por_empleado AS
SELECT  COALESCE(p.vendedor_id, p.usuario_id) AS usuario_id,
        u.nombre AS usuario,
        CAST(p.creado_en AS DATE) AS dia,
        COUNT(*) AS num_pedidos,
        COALESCE(SUM(p.subtotal - p.descuento), 0) AS venta_neta,
        COALESCE(SUM(p.total), 0) AS venta_total
FROM pedidos p
JOIN usuarios u ON u.id = COALESCE(p.vendedor_id, p.usuario_id)
WHERE COALESCE(p.vendedor_id, p.usuario_id) IS NOT NULL
  AND p.estado NOT IN ('cancelado', 'devuelto')
GROUP BY COALESCE(p.vendedor_id, p.usuario_id), u.nombre, CAST(p.creado_en AS DATE);
