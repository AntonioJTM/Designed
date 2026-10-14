-- =====================================================================
--  Migración · NOTAS PENDIENTES DE PAGO y el nuevo "Total a cobrar" (2026-10-13)
--
--  "En total a cobrar es: cobrar, a crédito, nota en espera (aún no sale como
--  ticket y se puede modificar) y nota pendiente de forma de pago (aquí sale el
--  ticket pero aún no se registra cómo te pagó hasta después). Se quita todo lo
--  de pedidos del punto de venta, igual se eliminan los apartados y fiar"
--  (usuario). Y: "si no me pagan ese día, que exista un apartado de notas
--  pendientes de pago de los clientes y que se agreguen al corte de caja del
--  día en que paguen, o si el cliente pide que se vaya a crédito que exista esa
--  opción. Los métodos de pago son efectivo, transferencia, crédito."
--
--  · pedidos.nota_pendiente  1 = la venta salió como NOTA PENDIENTE DE PAGO: el
--    cliente se llevó la mercancía, salió su ticket y el pago se registra
--    después (en abonos, en la pantalla Notas pendientes de pago) o se pasa a
--    crédito. No usa su límite de crédito. Queda marcada para siempre: así se
--    sabe que salió así aunque ya esté pagada.
--  · Tarjeta, PayPal y Mercado Pago se DESACTIVAN (no se borran: las ventas de
--    antes los siguen nombrando).
--  · Permiso ver:notas_pendientes (pantalla nueva), para los puestos que ya
--    cobran en el punto de venta.
--  · La pantalla Pedidos se llama "Notas en espera" y fiar, "Vender a crédito".
--  · Se quita el permiso ver:apartados: la pantalla Apartados ya no existe.
-- =====================================================================

ALTER TABLE pedidos
    ADD COLUMN nota_pendiente TINYINT(1) NOT NULL DEFAULT 0 AFTER encargo,
    ADD KEY idx_pedidos_nota_pendiente (nota_pendiente, estado);

UPDATE metodos_pago SET activo = 0 WHERE nombre NOT IN ('Efectivo', 'Transferencia');

INSERT IGNORE INTO permisos (clave, descripcion) VALUES
  ('ver:notas_pendientes', 'Notas pendientes de pago');
UPDATE permisos SET descripcion = 'Notas en espera' WHERE clave = 'ver:encargos';
UPDATE permisos SET descripcion = 'Vender a crédito' WHERE clave = 'hacer:fiar';

-- Quien cobra en el punto de venta cobra también las notas pendientes.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT rp.rol_id, pn.id
  FROM rol_permisos rp
  JOIN permisos pv ON pv.id = rp.permiso_id AND pv.clave = 'ver:pos'
  JOIN permisos pn ON pn.clave = 'ver:notas_pendientes';

DELETE rp FROM rol_permisos rp JOIN permisos p ON p.id = rp.permiso_id WHERE p.clave = 'ver:apartados';
DELETE FROM permisos WHERE clave = 'ver:apartados';
