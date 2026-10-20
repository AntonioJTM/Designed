-- AUTORIZACIONES, FASE 2 (2026-10-19): ingreso de inventario, surtir sucursal y
-- vacaciones. Decisiones del usuario:
--   · Cargar mercancía (la lista del proveedor, un hilo o un paquete a mano):
--     directo la gerente y el administrador; el almacenista y Contabilidad lo
--     piden.
--   · Pedir mercancía a otra tienda espera autorización, y quien autoriza puede
--     dar MENOS de lo pedido ("de esos 20, que solo autorice 10").
--   · Vacaciones: cada quien pide las suyas ("Mis vacaciones"); las autoriza el
--     administrador (o a quien se lo dé en Permisos), nunca las propias, y se le
--     avisa por WhatsApp al aprobarlas y al rechazarlas.
-- Requiere 2026-10_autorizaciones.sql.

-- Lo que se autorizó si fue menos de lo pedido, y lo que se le avisó a quien pidió.
ALTER TABLE autorizaciones ADD COLUMN IF NOT EXISTS nota_aprobacion VARCHAR(500) NULL;
ALTER TABLE autorizaciones ADD COLUMN IF NOT EXISTS aviso VARCHAR(255) NULL;

INSERT IGNORE INTO permisos (clave, descripcion) VALUES
  ('hacer:cargar_inventario',    'Cargar mercancía al inventario (la lista del proveedor, un hilo o un paquete a mano)'),
  ('pedir:cargar_inventario',    'Pedir autorización para cargar mercancía al inventario'),
  ('hacer:surtir_sucursal',      'Pedir mercancía a otra tienda sin esperar autorización (y autorizar los pedidos)'),
  ('pedir:surtir_sucursal',      'Pedir autorización para pedir mercancía a otra tienda'),
  ('hacer:autorizar_vacaciones', 'Autorizar las vacaciones del personal'),
  ('pedir:vacaciones',           'Pedir sus vacaciones');

-- CARGAR: la gerente directo. Quien ya cargaba sin ser gerente (Contabilidad)
-- y el almacenista lo piden; el almacenista ve Surtir inventario para pedirlo.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.clave = 'hacer:cargar_inventario'
 WHERE r.nombre = 'gerente';
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, p.id
  FROM rol_permisos rp
  JOIN permisos pv ON pv.id = rp.permiso_id AND pv.clave = 'ver:remesa'
  JOIN roles r     ON r.id = rp.rol_id AND r.nombre NOT IN ('gerente', 'administrador')
  JOIN permisos p  ON p.clave = 'pedir:cargar_inventario';
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.clave IN ('ver:remesa', 'pedir:cargar_inventario')
 WHERE r.nombre = 'almacenista';

-- SURTIR SUCURSAL: la gerente pide directo; quien más pedía (Surtir sucursal) lo pide.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.clave = 'hacer:surtir_sucursal'
 WHERE r.nombre = 'gerente';
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, p.id
  FROM rol_permisos rp
  JOIN permisos pv ON pv.id = rp.permiso_id AND pv.clave = 'ver:surtir'
  JOIN roles r     ON r.id = rp.rol_id AND r.nombre NOT IN ('gerente', 'administrador')
  JOIN permisos p  ON p.clave = 'pedir:surtir_sucursal';

-- VACACIONES: todos los que entran al sistema las piden; las autoriza el administrador.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.clave = 'pedir:vacaciones'
 WHERE r.entra_al_sistema = 1 AND r.nombre <> 'administrador';
