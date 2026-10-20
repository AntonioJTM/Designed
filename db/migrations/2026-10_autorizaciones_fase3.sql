-- AUTORIZACIONES, FASE 3 (2026-10-19): la NÓMINA. Decisiones del usuario:
--   · La PREPARA la gerente o Contabilidad: abren Nómina, calculan la semana y
--     capturan faltas, horas extra, bonos y descuentos.
--   · PAGAR la semana necesita autorización, y la da solo el administrador (o a
--     quien se lo dé en Permisos). Si la nómina cambia después de pedirla, no
--     se paga hasta pedirla otra vez.
--   · Nadie toca su propia nómina (su recibo ni su sueldo): solo el administrador.
--   · Las vacaciones en Nómina las registra solo quien autoriza vacaciones.
-- Requiere 2026-10_autorizaciones.sql y _fase2.sql.

INSERT IGNORE INTO permisos (clave, descripcion) VALUES
  ('hacer:pagar_nomina', 'Pagar la nómina de la semana (y autorizar que se pague)'),
  ('pedir:pagar_nomina', 'Pedir que se pague la nómina de la semana');

-- La preparan la gerente y Contabilidad: ven Nómina y piden que se pague.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.clave IN ('ver:nomina', 'pedir:pagar_nomina')
 WHERE r.nombre IN ('gerente', 'contabilidad');
