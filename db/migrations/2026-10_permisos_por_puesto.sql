-- =============================================================================
-- Permisos por puesto (2026-10). Rediseño del panel.
--
-- El administrador decide qué ve y qué puede hacer cada puesto en
-- Administración → Permisos. Las tablas `permisos` y `rol_permisos` YA
-- EXISTÍAN en el esquema desde el principio, vacías y sin uso: esta migración
-- NO cambia estructura, solo las llena con
--   1) las claves que conoce el sistema (backend/src/modules/permisos/catalogo.js), y
--   2) lo que trae cada puesto de inicio: el mismo menú que aprobó el usuario.
--
-- El administrador no lleva filas: el código le da todo, siempre.
-- Es repetible: INSERT IGNORE no duplica ni pisa lo que ya se haya cambiado.
-- Para quitarla:  DELETE FROM rol_permisos; DELETE FROM permisos;
-- =============================================================================

INSERT IGNORE INTO permisos (clave, descripcion) VALUES
  ('ver:hoy', 'Pantalla Hoy'),
  ('ver:pos', 'Punto de venta'),
  ('ver:caja', 'Caja'),
  ('ver:pedidos', 'Pedidos'),
  ('ver:apartados', 'Apartados'),
  ('ver:clientes', 'Clientes'),
  ('ver:inventario', 'Inventario'),
  ('ver:remesa', 'Recibir remesa'),
  ('ver:surtir', 'Surtir sucursal'),
  ('ver:kardex', 'Kardex'),
  ('ver:catalogo', 'Productos y Materiales'),
  ('ver:negocio', 'Cómo va el negocio'),
  ('ver:reportes', 'Reportes'),
  ('ver:almacenes', 'Almacenes y Listas de precio'),
  ('ver:personal', 'Personal'),
  ('ver:nomina', 'Nómina'),
  ('ver:config', 'Configuración'),
  ('hacer:fiar', 'Fiar'),
  ('hacer:cancelar_venta', 'Cancelar o devolver una venta'),
  ('hacer:mover_efectivo', 'Sacar o meter efectivo'),
  ('hacer:corregir_deuda', 'Corregir la deuda de un cliente'),
  ('hacer:cambiar_precios', 'Cambiar precios'),
  ('hacer:ver_costos', 'Ver costos y márgenes'),
  ('hacer:enviar_traspaso', 'Enviar desde la bodega'),
  ('hacer:recibir_traspaso', 'Confirmar que llegó un envío'),
  ('hacer:ajuste_merma', 'Ajuste y merma'),
  ('hacer:bajar_conos', 'Bajar conos a mostrador');

-- Gerente: todo menos Administración.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p
 WHERE r.nombre = 'gerente'
   AND p.clave IN ('ver:hoy', 'ver:pos', 'ver:caja', 'ver:pedidos', 'ver:apartados', 'ver:clientes',
                   'ver:inventario', 'ver:remesa', 'ver:surtir', 'ver:kardex',
                   'ver:catalogo', 'ver:negocio', 'ver:reportes',
                   'hacer:fiar', 'hacer:cancelar_venta', 'hacer:mover_efectivo', 'hacer:corregir_deuda',
                   'hacer:cambiar_precios', 'hacer:ver_costos', 'hacer:enviar_traspaso',
                   'hacer:recibir_traspaso', 'hacer:ajuste_merma', 'hacer:bajar_conos');

-- Cajero: vender y sus clientes.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p
 WHERE r.nombre = 'cajero'
   AND p.clave IN ('ver:pos', 'ver:caja', 'ver:pedidos', 'ver:apartados', 'ver:clientes',
                   'hacer:fiar', 'hacer:mover_efectivo');

-- Almacenista: la mercancía.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p
 WHERE r.nombre = 'almacenista'
   AND p.clave IN ('ver:hoy', 'ver:inventario', 'ver:remesa', 'ver:surtir', 'ver:kardex',
                   'hacer:enviar_traspaso', 'hacer:recibir_traspaso', 'hacer:ajuste_merma', 'hacer:bajar_conos');
