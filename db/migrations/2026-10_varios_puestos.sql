-- =====================================================================
--  Migración · Una persona puede tener VARIOS puestos (2026-10-06)
--
--  "Vamos a poner que una persona pueda tener más de 2 puestos; ese
--  cambio va en Personal" (usuario). En una tienda chica la misma
--  persona cobra en la caja y también surte la bodega.
--
--  `usuarios.rol_id` se queda: es su puesto PRINCIPAL (el que sale en
--  nómina y junto a su nombre). Esta tabla guarda los DEMÁS puestos que
--  tiene, sin repetir el principal. Lo que puede ver y hacer es la SUMA
--  de lo de todos sus puestos, y si alguno es administrador, lo puede
--  todo. Nada se copia: cada puesto vive una sola vez, en una sola tabla.
--
--  Solo crea la tabla: nadie tiene puestos extra hasta que se le den en
--  Personal.
-- =====================================================================

CREATE TABLE IF NOT EXISTS usuario_roles (
    usuario_id BIGINT UNSIGNED   NOT NULL,
    rol_id     SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (usuario_id, rol_id),
    KEY idx_usuario_roles_rol (rol_id),
    CONSTRAINT usuario_roles_usuario FOREIGN KEY (usuario_id)
        REFERENCES usuarios (id) ON DELETE CASCADE,
    CONSTRAINT usuario_roles_rol FOREIGN KEY (rol_id)
        REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
