-- =====================================================================
--  Migración · Opción A: varios códigos de barras por variante
--  Cada color sigue siendo UNA variante (producto_variantes). Esta tabla
--  guarda códigos ADICIONALES (p.ej. distintos lotes/paquetes del mismo
--  color) que al escanearse resuelven a la misma variante. El código
--  "principal" permanece en producto_variantes.codigo_barras.
--  El stock se sigue agrupando por variante (color): sin cantidades por lote.
-- =====================================================================

CREATE TABLE IF NOT EXISTS variante_codigos (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    variante_id BIGINT UNSIGNED NOT NULL,
    codigo      VARCHAR(60) NOT NULL UNIQUE,
    etiqueta    VARCHAR(60),            -- opcional: lote, proveedor, nota
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id) ON DELETE CASCADE,
    INDEX idx_variante_codigos_variante (variante_id)
) ENGINE=InnoDB;
