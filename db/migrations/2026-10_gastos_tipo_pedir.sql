-- =====================================================================
--  Migración · PEDIR un tipo de gasto nuevo (2026-10-20)
--
--  "Nada más el admin puede crear [tipos de] gastos; que lo puedan hacer también
--  cajeros y ya la persona que tiene a cargo autorizar, que diga si se autoriza
--  ese tipo y el límite" (usuario). El cajero da de alta el tipo y se PIDE: quien
--  autoriza (`hacer:tipos_gasto`) lo acepta poniéndole su límite, o lo rechaza.
-- =====================================================================

INSERT IGNORE INTO permisos (clave, descripcion) VALUES
  ('pedir:tipos_gasto', 'Pedir un tipo de gasto nuevo (quien autoriza le pone su límite)');

-- Lo pide quien registra gastos y no los da de alta directo (cajero, gerente).
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, pn.id
  FROM rol_permisos rp
  JOIN permisos p  ON p.id = rp.permiso_id AND p.clave = 'hacer:registrar_gasto'
  JOIN permisos pn ON pn.clave = 'pedir:tipos_gasto'
 WHERE NOT EXISTS (
   SELECT 1 FROM rol_permisos r2 JOIN permisos p2 ON p2.id = r2.permiso_id
    WHERE r2.rol_id = rp.rol_id AND p2.clave = 'hacer:tipos_gasto'
 );
