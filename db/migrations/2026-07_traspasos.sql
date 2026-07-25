-- =====================================================================
--  Migración · Traspasos de matriz a sucursales
--
--  Cuautepec surte a las demás tiendas mandándoles PAQUETES: por ejemplo
--  70 paquetes de azul marino y 30 de verde. Allá deciden si los desarman
--  en conos o los venden por paquete.
--
--  El traspaso es un documento con folio y varias líneas. El movimiento es
--  inmediato: sale del origen y entra al destino en la misma transacción
--  (no se modela el tiempo de camino).
--
--  Ojo con la unidad: el inventario de una variante 'paquete' se lleva en
--  KILOS, así que la línea guarda las dos cosas — los `paquetes` que se
--  capturaron y la `cantidad` que realmente se movió (paquetes × peso_kg).
-- =====================================================================

CREATE TABLE IF NOT EXISTS traspasos (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    folio              VARCHAR(40) NOT NULL UNIQUE,
    almacen_origen_id  SMALLINT UNSIGNED NOT NULL,
    almacen_destino_id SMALLINT UNSIGNED NOT NULL,
    usuario_id         BIGINT UNSIGNED,
    notas              TEXT,
    creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (almacen_origen_id)  REFERENCES almacenes(id),
    FOREIGN KEY (almacen_destino_id) REFERENCES almacenes(id),
    FOREIGN KEY (usuario_id)         REFERENCES usuarios(id),
    INDEX idx_traspasos_destino (almacen_destino_id),
    INDEX idx_traspasos_fecha (creado_en)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS traspaso_detalle (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    traspaso_id BIGINT UNSIGNED NOT NULL,
    variante_id BIGINT UNSIGNED NOT NULL,
    -- Lo que tecleó el almacenista cuando la variante es un paquete.
    paquetes    DECIMAL(12,3),
    -- Lo que de verdad se movió, en la unidad de la variante (kg o piezas).
    cantidad    DECIMAL(12,3) NOT NULL CHECK (cantidad > 0),
    FOREIGN KEY (traspaso_id) REFERENCES traspasos(id) ON DELETE CASCADE,
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id),
    INDEX idx_traspaso_detalle_traspaso (traspaso_id)
) ENGINE=InnoDB;
