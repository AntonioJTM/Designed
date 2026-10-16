-- =====================================================================
--  CADA PERSONA VE SOLO SUS TIENDAS (2026-10-15: "no quiero que todos vean
--  lo que se vende en las dos tiendas, eso solo lo puede ver el
--  administrador; si abro una caja en Moroleón no quiero que vea nada de la
--  otra tienda ni del inventario: solo lo que hay en su tienda y en su
--  almacén si es que tiene").
--
--  · `usuarios.todas_las_tiendas`: 1 = ve todas (como hasta hoy). Los que ya
--    existen quedan en 1 para que nada cambie hasta que el administrador le
--    diga a cada uno en Personal de qué tienda es.
--  · `usuario_almacenes`: las tiendas (almacenes) de quien NO ve todas.
--  · El ADMINISTRADOR ve todas siempre, diga lo que diga su renglón.
--
--  Se puede correr dos veces sin efecto.
-- =====================================================================

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS todas_las_tiendas TINYINT(1) NOT NULL DEFAULT 1 AFTER activo;

CREATE TABLE IF NOT EXISTS usuario_almacenes (
  usuario_id BIGINT(20) UNSIGNED NOT NULL,
  almacen_id SMALLINT(5) UNSIGNED NOT NULL,
  PRIMARY KEY (usuario_id, almacen_id),
  KEY idx_usuario_almacenes_almacen (almacen_id),
  CONSTRAINT usuario_almacenes_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT usuario_almacenes_almacen FOREIGN KEY (almacen_id) REFERENCES almacenes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
