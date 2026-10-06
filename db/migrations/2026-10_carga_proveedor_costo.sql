-- =====================================================================
--  Migración · Surtir inventario: datos de la carga y el costo (2026-10-06)
--
--  Lo pidió el usuario: "Recibir remesas === surtir inventarios: nombre de
--  proveedor, costo por kilo (solo administrador y contabilidad), pedimento
--  número, número de contenedor, factura, fecha de ingreso".
--
--  · remesas: proveedor (de la lista de proveedores), factura, pedimento,
--    contenedor y fecha de ingreso (el día que llegó la mercancía, que puede
--    no ser el día que se capturó). `lista` junta las cargas que salieron de
--    UN archivo con varios colores, para poder corregir sus datos de una vez.
--  · proveedores: el nombre no se repite (se eligen de una lista).
--  · Puesto CONTABILIDAD: ve y captura el costo. Al gerente se le quita "Ver
--    costos y márgenes": el costo es solo del administrador y de contabilidad.
-- =====================================================================

ALTER TABLE remesas
  ADD COLUMN proveedor_id  BIGINT UNSIGNED NULL AFTER almacen_id,
  ADD COLUMN factura       VARCHAR(60) NULL AFTER costo_kg,
  ADD COLUMN pedimento     VARCHAR(40) NULL AFTER factura,
  ADD COLUMN contenedor    VARCHAR(40) NULL AFTER pedimento,
  ADD COLUMN fecha_ingreso DATE NULL AFTER contenedor,
  ADD COLUMN lista         VARCHAR(40) NULL AFTER fecha_ingreso,
  ADD KEY idx_remesas_proveedor (proveedor_id),
  ADD KEY idx_remesas_lista (lista),
  ADD CONSTRAINT remesas_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores (id);

-- Las que ya existen entraron el día que se cargaron.
UPDATE remesas SET fecha_ingreso = DATE(creado_en) WHERE fecha_ingreso IS NULL;

ALTER TABLE proveedores ADD UNIQUE KEY uq_proveedores_nombre (nombre);

-- El puesto de Contabilidad, con lo que necesita para el costo. El
-- administrador lo ajusta en Permisos.
INSERT INTO roles (nombre, descripcion)
SELECT 'contabilidad', 'Costos de compra, cargas de mercancía y reportes'
 WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'contabilidad');

INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permisos p ON p.clave IN
       ('hacer:ver_costos', 'ver:remesa', 'ver:reportes', 'ver:negocio', 'ver:inventario', 'ver:kardex')
 WHERE r.nombre = 'contabilidad';

-- El costo es solo del administrador (lo puede todo) y de contabilidad.
DELETE rp FROM rol_permisos rp
  JOIN roles r    ON r.id = rp.rol_id
  JOIN permisos p ON p.id = rp.permiso_id
 WHERE r.nombre = 'gerente' AND p.clave = 'hacer:ver_costos';
