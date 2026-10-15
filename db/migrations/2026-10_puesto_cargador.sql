-- =====================================================================
--  Puesto CARGADOR: trabaja en la tienda pero NO entra al sistema
--  (2026-10-14: "falta agregar el tipo cargador; este no tiene acceso a
--  nada del sistema, es una persona que solo carga los paquetes que el
--  personal que tiene acceso al sistema ya escaneó").
--
--  · `roles.entra_al_sistema`: 0 = el puesto no entra (no lleva correo ni
--    contraseña, no se combina con otros puestos y no sale en Permisos).
--    Los puestos de siempre quedan en 1.
--  · `usuarios.correo` y `usuarios.contrasena_hash` aceptan NULL: es lo que
--    tiene quien no entra. El UNIQUE del correo admite varios NULL.
--  · Sí sale en Nómina, como cualquier empleado: ahí se le pone su sueldo.
--
--  Se puede correr dos veces sin efecto.
-- =====================================================================

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS entra_al_sistema TINYINT(1) NOT NULL DEFAULT 1 AFTER descripcion;

ALTER TABLE usuarios
  MODIFY correo VARCHAR(160) NULL,
  MODIFY contrasena_hash VARCHAR(255) NULL;

INSERT INTO roles (nombre, descripcion, entra_al_sistema)
SELECT 'cargador', 'Carga los paquetes que ya escaneó el personal. No entra al sistema.', 0
 WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'cargador');

UPDATE roles SET entra_al_sistema = 0 WHERE nombre = 'cargador';
