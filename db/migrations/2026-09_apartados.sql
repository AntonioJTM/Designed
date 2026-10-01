-- =====================================================================
--  Migración · Apartados: el cliente deja un anticipo y la mercancía se
--  guarda hasta que la liquide
--
--  QUÉ PIDIÓ EL USUARIO (2026-09-10)
--    "Apartados: el cliente deja un anticipo y la mercancía se reserva."
--    Y sobre cómo funcionan: anticipo LIBRE (lo que quiera dejar), SIN fecha
--    límite, igual que el crédito.
--
--  LA DIFERENCIA CON UNA VENTA NORMAL
--    Una venta descuenta el inventario: la mercancía salió. Un apartado NO la
--    descuenta —sigue en la bodega— pero la RESERVA, para que el mostrador no
--    se la venda a otro. El descuento ocurre cuando se entrega.
--
--    Por eso hace falta saber, de cada pedido, si ya descontó o no:
--    `inventario_descontado`. Sin ese dato, cancelar un apartado repondría
--    mercancía que nunca salió y el inventario acabaría con existencias
--    fantasma. Los pedidos que ya existen SÍ descontaron, así que el valor
--    por omisión es 1 y la migración no tiene que tocarlos.
--
--  POR QUÉ NO UNA TABLA APARTE
--    Un apartado es una venta que todavía no se entrega: mismo cliente, mismo
--    detalle, mismos pagos, mismos precios congelados. Una tabla `apartados`
--    duplicaría todo eso y habría que mantener las dos en paralelo. Es la
--    misma decisión que ya tomó este proyecto con `pedidos.canal` para no
--    separar la tienda en línea del mostrador.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. El estado nuevo
--
--  MySQL/MariaDB no permite modificar un CHECK: hay que tirarlo y volverlo
--  a crear con el valor añadido.
--
--  OJO CON EL NOMBRE: el CHECK del estado es `pedidos_chk_2`, no el _chk_1
--  —ese es el del `canal`—. Se comprobó contra information_schema antes de
--  escribir esto; tirar el equivocado habría quitado la validación del canal
--  y dejado la del estado intacta, sin que nada avisara.
-- ---------------------------------------------------------------------
ALTER TABLE pedidos DROP CONSTRAINT pedidos_chk_2;

ALTER TABLE pedidos
    ADD CONSTRAINT pedidos_chk_2 CHECK (estado IN (
      'apartado',        -- anticipo dejado, mercancía reservada, sin entregar
      'pendiente', 'pagado', 'en_preparacion', 'enviado', 'entregado',
      'cancelado', 'devuelto'
    ));

-- ---------------------------------------------------------------------
--  2. Si el pedido ya descontó el inventario
--
--  Un apartado nace en 0 y pasa a 1 cuando se entrega. Lo consulta
--  `cambiarEstado` para decidir si al cancelar hay algo que reponer: sin
--  esto, cancelar un apartado inventaría mercancía que nunca salió.
-- ---------------------------------------------------------------------
ALTER TABLE pedidos
    ADD COLUMN inventario_descontado TINYINT(1) NOT NULL DEFAULT 1
        AFTER estado,
    -- Cuándo se entregó la mercancía del apartado. NULL mientras siga
    -- guardada. Sirve para el histórico: cuánto tarda la gente en liquidar.
    ADD COLUMN entregado_en DATETIME NULL AFTER inventario_descontado;

-- ---------------------------------------------------------------------
--  3. Los apartados vigentes, con lo que llevan pagado
--
--  El pendiente sale de restar los pagos al total; no se guarda un campo
--  con el saldo, por la misma razón que en el crédito: un valor
--  desnormalizado se descuadra en cuanto una transacción falla a medias.
--
--  Solo cuentan los pagos 'completado': un pago 'pendiente' es una
--  intención (la captura de una transferencia sin confirmar) y contarlo
--  como abonado diría que el cliente ya pagó algo que no ha pagado.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_apartados AS
SELECT  p.id AS pedido_id,
        p.numero_pedido,
        p.cliente_id,
        c.nombre AS cliente,
        c.nombre_comercial,
        c.telefono,
        p.almacen_id,
        a.nombre AS almacen,
        p.total,
        COALESCE(pg.abonado, 0) AS abonado,
        ROUND(p.total - COALESCE(pg.abonado, 0), 2) AS pendiente,
        -- Qué tanto lleva pagado, para poder ordenar por "los que están a
        -- punto de liquidar".
        CASE WHEN p.total > 0
             THEN ROUND(100 * COALESCE(pg.abonado, 0) / p.total, 1)
             ELSE 100 END AS pct_pagado,
        p.creado_en,
        DATEDIFF(NOW(), p.creado_en) AS dias_apartado,
        pg.ultimo_abono,
        p.usuario_id,
        u.nombre AS aparto_con
FROM pedidos p
LEFT JOIN clientes c  ON c.id = p.cliente_id
LEFT JOIN almacenes a ON a.id = p.almacen_id
LEFT JOIN usuarios u  ON u.id = p.usuario_id
LEFT JOIN (
  SELECT pedido_id,
         SUM(monto) AS abonado,
         MAX(creado_en) AS ultimo_abono
    FROM pagos
   WHERE estado = 'completado'
   GROUP BY pedido_id
) pg ON pg.pedido_id = p.id
WHERE p.estado = 'apartado';
