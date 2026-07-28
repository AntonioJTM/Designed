-- =====================================================================
--  Migración · El cono se vende POR KILO, no por pieza
--
--  Lo aclaró la tienda: "cuando se cambie un paquete a conos no hay precio por
--  cono, sigue siendo por kilo, pero se le aumenta el destare".
--
--  El cono es el MISMO hilo, solo enconado. Así que:
--    · se lleva en KILOS, como el paquete (antes se llevaba en piezas);
--    · su precio es el MISMO por kilo del paquete (antes se repartía el valor
--      del paquete entre las piezas: paquete de 19 kg a $180 → $285 por cono);
--    · lo que gana la tienda al enconar viene del DESTARE, que suma kilos
--      vendibles porque el tubo pesa.
--
--  `piezas_por_origen` se conserva: sigue diciendo cuántos conos rinde un
--  paquete, pero ahora es un dato informativo, no la unidad de inventario.
--
--  CONVERSIÓN DE LOS DATOS QUE YA EXISTEN
--  El inventario de conos estaba en PIEZAS y hay que pasarlo a kilos. El dato
--  bueno está en `variante_conversiones`: cada desarme dice cuántos kilos
--  entraron (kg_consumidos + destare_kg). Se reconstruye desde ahí.
--  Solo es válido porque NO se ha vendido ningún cono: si se hubieran vendido,
--  habría que restar lo vendido y esto no alcanzaría.
-- =====================================================================

-- ---------- 1. El precio del cono pasa a ser el de su paquete ----------
UPDATE producto_variantes cono
   JOIN producto_variantes paq ON paq.id = cono.origen_variante_id
    SET cono.precio = paq.precio
  WHERE cono.tipo_presentacion = 'cono'
    AND cono.modo_precio = 'calculado';

-- ---------- 2. El inventario de conos, de piezas a kilos ----------
-- Kilos que de verdad entraron por desarme, por cono y almacén.
CREATE TEMPORARY TABLE tmp_kilos_cono AS
SELECT c.variante_destino_id AS variante_id,
       c.almacen_destino_id  AS almacen_id,
       SUM(c.kg_consumidos + COALESCE(c.destare_kg, 0)) AS kilos
  FROM variante_conversiones c
 GROUP BY c.variante_destino_id, c.almacen_destino_id;

UPDATE inventario i
  JOIN tmp_kilos_cono t
    ON t.variante_id = i.variante_id AND t.almacen_id = i.almacen_id
  JOIN producto_variantes pv ON pv.id = i.variante_id
   SET i.cantidad = t.kilos
 WHERE pv.tipo_presentacion = 'cono';

-- El kardex de esas entradas también estaba en piezas: se corrige para que la
-- suma de movimientos cuadre con el saldo.
UPDATE movimientos_inventario m
  JOIN variante_conversiones c ON c.id = m.referencia_id
  JOIN producto_variantes pv   ON pv.id = m.variante_id
   SET m.cantidad = c.kg_consumidos + COALESCE(c.destare_kg, 0),
       m.motivo = CONCAT(
         'Enconado (corregido a kilos): ', c.piezas_generadas, ' cono(s) · ',
         c.kg_consumidos, ' kg',
         IF(c.destare_kg IS NULL, '', CONCAT(' + ', c.destare_kg, ' de destare'))
       )
 WHERE m.referencia_tipo = 'conversion'
   AND m.tipo = 'entrada'
   AND pv.tipo_presentacion = 'cono';

DROP TEMPORARY TABLE tmp_kilos_cono;
