-- =============================================================================
-- ROTACIÓN DE INVENTARIO (2026-10-22): cuánto hilo se vende, en qué temporada y
-- cuándo pedirlo al proveedor. Solo kilos. Se calcula al momento con lo que ya
-- hay (ventas, kardex, inventario, cargas); aquí va solo lo NUEVO:
--   · los permisos de la pantalla y de cargar ventas de años anteriores;
--   · los ajustes de «Qué pedir» (claves internas de configuración);
--   · la tabla de VENTAS DE AÑOS ANTERIORES: kilos por hilo, mes y tienda, para
--     ver la temporada sin esperar un año (almacen_id NULL = las dos tiendas).
-- =============================================================================

INSERT IGNORE INTO permisos (clave, descripcion) VALUES
  ('ver:rotacion',                     'Rotación de inventario: cuánto hilo se vende, en qué temporada y cuándo pedirlo'),
  ('hacer:cargar_ventas_anteriores',   'Cargar en kilos las ventas de años anteriores (para la temporada)'),
  ('hacer:ajustes_rotacion',           'Tiempos para pedir al proveedor (Rotación de inventario)');

-- La ven quienes hoy ven Reportes (como Transferencias). Cargar ventas anteriores y
-- cambiar los tiempos para pedir, por omisión, solo el administrador (lo puede todo
-- por código); se dan en Permisos.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, pn.id
  FROM rol_permisos rp
  JOIN permisos p  ON p.id = rp.permiso_id AND p.clave = 'ver:reportes'
  JOIN permisos pn ON pn.clave = 'ver:rotacion';

-- Los ajustes de «Qué pedir». Internos (publica = 0). Mientras no se guarden desde
-- la pantalla, «10 semanas» del proveedor sale «Por confirmar».
INSERT IGNORE INTO configuracion (clave, valor, descripcion, publica) VALUES
  ('rotacion_semanas_proveedor',  '10', 'Rotación: semanas que tarda el proveedor desde que se pide', 0),
  ('rotacion_semanas_colchon',    '3',  'Rotación: semanas de venta de colchón al pedir', 0),
  ('rotacion_meses_cubre',        '4',  'Rotación: meses de venta que cubre cada pedido', 0),
  ('rotacion_kg_contenedor',      '',   'Rotación: kilos que caben en un contenedor (opcional)', 0),
  ('rotacion_ajustes_confirmados','0',  'Rotación: 1 cuando ya se guardaron los ajustes', 0);

CREATE TABLE IF NOT EXISTS ventas_anteriores (
  id          BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  producto_id BIGINT UNSIGNED   NOT NULL,
  almacen_id  SMALLINT UNSIGNED NULL,
  anio        SMALLINT UNSIGNED NOT NULL,
  mes         TINYINT UNSIGNED  NOT NULL,
  kg          DECIMAL(12,3)     NOT NULL,
  usuario_id  BIGINT UNSIGNED   NULL,
  creado_en   DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ventas_anteriores (producto_id, almacen_id, anio, mes),
  KEY idx_ventas_anteriores_mes (anio, mes),
  CONSTRAINT fk_ventas_anteriores_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
  CONSTRAINT fk_ventas_anteriores_almacen  FOREIGN KEY (almacen_id)  REFERENCES almacenes (id),
  CONSTRAINT fk_ventas_anteriores_usuario  FOREIGN KEY (usuario_id)  REFERENCES usuarios (id),
  CONSTRAINT chk_ventas_anteriores_mes CHECK (mes BETWEEN 1 AND 12),
  CONSTRAINT chk_ventas_anteriores_kg  CHECK (kg > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
