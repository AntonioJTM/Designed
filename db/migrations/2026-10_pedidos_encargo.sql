-- =====================================================================
--  Migración · PEDIDOS de clientes (encargos) (2026-10-06)
--
--  "Eso que se llama Pedidos en realidad no son pedidos, son ventas... y
--  hacer un apartado para realizar pedidos. Tenemos chofer que los lleva, o
--  hacen el pedido por WhatsApp y después van por él; no es un apartado, es
--  una venta" (usuario). La pantalla de siempre pasa a llamarse VENTAS y
--  "Pedidos" son estos encargos.
--
--  Un pedido es una VENTA que se toma en el punto de venta y se entrega
--  después. Vive en la misma tabla `pedidos` (como el apartado: la venta es
--  unificada) y se distingue por `encargo = 1`:
--    · al tomarlo la mercancía se APARTA (no se descuenta);
--    · pasa por en_preparacion (por preparar) → listo → enviado (si lo lleva
--      el chofer) y se ENTREGA cobrando lo que falta (o fiándolo), que es
--      cuando sale del inventario.
--
--  · encargo            1 = pedido de cliente.
--  · entrega_direccion  a dónde lo lleva el chofer (texto libre; la tabla
--                       `direcciones` es de la tienda en línea).
--  · entrega_para       para cuándo lo quiere (opcional).
--  · estado 'listo'     nuevo: preparado, esperando que pasen por él o que
--                       salga el chofer.
--  · permiso ver:encargos (pantalla Pedidos), para los puestos que ya veían
--    las ventas y para el almacenista, que es quien los prepara.
-- =====================================================================

ALTER TABLE pedidos
    ADD COLUMN encargo TINYINT(1) NOT NULL DEFAULT 0 AFTER canal,
    ADD COLUMN entrega_direccion VARCHAR(255) NULL AFTER direccion_envio_id,
    ADD COLUMN entrega_para DATE NULL AFTER entrega_direccion,
    ADD KEY idx_pedidos_encargo (encargo, estado);

ALTER TABLE pedidos DROP CONSTRAINT pedidos_chk_2;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_chk_2 CHECK (estado IN
    ('apartado', 'pendiente', 'pagado', 'en_preparacion', 'listo', 'enviado', 'entregado', 'cancelado', 'devuelto'));

INSERT IGNORE INTO permisos (clave, descripcion) VALUES
  ('ver:encargos', 'Pedidos');
-- La pantalla de siempre ahora se llama Ventas (la clave no cambia).
UPDATE permisos SET descripcion = 'Ventas' WHERE clave = 'ver:pedidos';

-- Quien ya veía las ventas ve también los pedidos; y el almacenista, que los prepara.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT rp.rol_id, pe.id
  FROM rol_permisos rp
  JOIN permisos pv ON pv.id = rp.permiso_id AND pv.clave = 'ver:pedidos'
  JOIN permisos pe ON pe.clave = 'ver:encargos';

INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.clave = 'ver:encargos'
 WHERE r.nombre = 'almacenista';
