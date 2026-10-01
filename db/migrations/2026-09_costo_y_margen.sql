-- =====================================================================
--  Migración · El costo del hilo, para poder ver el margen
--
--  QUÉ DIJO EL USUARIO (2026-09-10)
--    "Margen real por hilo: hoy sabes a cuánto vendes, pero no a cuánto
--    compraste." Y sobre de dónde sale el costo: "lo capturo al recibir
--    cada remesa".
--
--  SE REUTILIZA `producto_variantes.costo`, NO se crea otra columna.
--    Esa columna ya existía —el CRUD de variantes ya la lee y la escribe—
--    solo que estaba toda en NULL y nada la consumía para calcular nada.
--    Crear un `costo_kg` al lado habría duplicado el dato, que es justo el
--    error que este proyecto ya cometió con el peso del producto y tuvo
--    que deshacer. Es la misma cosa: el costo POR KILO, porque aquí todo
--    se lleva en kilos.
--
--  CÓMO SE COSTEA: PROMEDIO PONDERADO MÓVIL
--    Al recibir una remesa, el costo del hilo se recalcula mezclando lo que
--    ya había con lo que entra:
--
--      costo_nuevo = (kg_en_existencia × costo_actual + kg_remesa × costo_remesa)
--                    ÷ (kg_en_existencia + kg_remesa)
--
--    Es el método estándar de costeo de inventarios y el que se porta bien
--    con este negocio: cuando el proveedor sube el precio, el margen lo
--    refleja poco a poco —conforme se vende el hilo caro mezclado con el
--    barato— en vez de dar un salto el día de la compra.
--
--  POR QUÉ EL COSTO SE CONGELA EN EL PEDIDO
--    `pedido_detalle.costo_unitario` guarda a cómo salió ESE kilo ESE día,
--    igual que `precio_unitario` congela a cómo se vendió. Sin congelarlo,
--    el margen de una venta de enero cambiaría cada vez que llega una
--    remesa nueva, y un reporte histórico que se mueve no sirve para
--    decidir nada.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. A cómo salió el kilo en cada compra
-- ---------------------------------------------------------------------
ALTER TABLE remesas
    ADD COLUMN costo_kg DECIMAL(12,2) NULL AFTER kg_total,
    ADD CONSTRAINT chk_remesas_costo_kg CHECK (costo_kg IS NULL OR costo_kg >= 0);

-- ---------------------------------------------------------------------
--  2. Cuándo se recalculó el costo de la presentación
--
--  El costo en sí vive en `producto_variantes.costo`, que ya existía. Lo
--  único que faltaba era saber DE CUÁNDO es: un costo viejo con varias
--  remesas encima significa que alguien está cargando mercancía sin poner
--  el precio de compra, y el margen de ese hilo no es de fiar.
-- ---------------------------------------------------------------------
ALTER TABLE producto_variantes
    ADD COLUMN costo_actualizado_en DATETIME NULL AFTER costo,
    ADD CONSTRAINT chk_variantes_costo CHECK (costo IS NULL OR costo >= 0);

-- ---------------------------------------------------------------------
--  3. El costo CONGELADO de lo que se vendió
--
--  NULL significa "no se sabía el costo cuando se vendió", que es lo que
--  va a pasar con todo lo vendido antes de esta migración. El reporte de
--  margen lo dice explícitamente en vez de asumir cero: un margen del
--  100% porque el costo era NULL sería una mentira peligrosa.
-- ---------------------------------------------------------------------
ALTER TABLE pedido_detalle
    ADD COLUMN costo_unitario DECIMAL(12,2) NULL AFTER precio_unitario,
    ADD CONSTRAINT chk_detalle_costo CHECK (costo_unitario IS NULL OR costo_unitario >= 0);

-- ---------------------------------------------------------------------
--  4. Cuánto se movió cada hilo, y cuándo fue la última vez
--
--  Es la base de "hilo muerto": qué colores llevan meses sin venderse y
--  cuánto dinero hay parado ahí. Se calcula de los movimientos, no de un
--  campo que haya que mantener al día.
--
--  `ultima_salida` mira SOLO las salidas por venta (`referencia_tipo =
--  'pedido'`): un traspaso entre almacenes o un desarme mueven la
--  mercancía de sitio pero no la venden, y contarlos haría parecer vivo un
--  hilo que nadie compra. Las salidas se guardan en NEGATIVO, de ahí el
--  `cantidad < 0`.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_movimiento_hilo AS
SELECT  pv.id AS variante_id,
        pv.producto_id,
        MAX(CASE WHEN m.referencia_tipo = 'pedido' AND m.cantidad < 0
                 THEN m.creado_en END) AS ultima_salida,
        MAX(CASE WHEN m.referencia_tipo = 'remesa' THEN m.creado_en END) AS ultima_entrada,
        COALESCE(SUM(CASE WHEN m.referencia_tipo = 'pedido' AND m.cantidad < 0
                          THEN -m.cantidad ELSE 0 END), 0) AS kg_vendidos_historico
FROM producto_variantes pv
LEFT JOIN movimientos_inventario m ON m.variante_id = pv.id
GROUP BY pv.id, pv.producto_id;
