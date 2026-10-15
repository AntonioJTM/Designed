-- =====================================================================
--  Migración · NÚMERO DE CLIENTE AUTOMÁTICO Y LUGAR DE ENTREGA (2026-10-14)
--
--  "El número de cliente quiero que tú me lo des y que no se pueda modificar"
--  y "habilitar un lugar de entrega: los que entrego en Tulancingo, Tenango…
--  necesito etiquetar esos clientes para sacar a cuántos les entrego en los
--  municipios o estados" (usuario).
--
--  · lugares_entrega: el municipio (o lugar) y su estado, de una LISTA: con
--    texto libre "Tulancingo" y "tulancingo " serían dos lugares y la cuenta
--    saldría partida. No se repite el mismo lugar en el mismo estado.
--  · clientes.lugar_entrega_id: a qué lugar se le entrega.
--  · clientes.codigo lo pone el sistema: C-0001, C-0002… (el id del cliente).
--    Los clientes que ya existían toman el suyo con la misma regla.
-- =====================================================================

CREATE TABLE lugares_entrega (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nombre     VARCHAR(100) NOT NULL,
    estado     VARCHAR(100) NOT NULL,
    creado_en  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_lugares_entrega (nombre, estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE clientes
    ADD COLUMN lugar_entrega_id INT UNSIGNED NULL AFTER estado,
    ADD CONSTRAINT fk_clientes_lugar_entrega FOREIGN KEY (lugar_entrega_id) REFERENCES lugares_entrega (id);

-- En dos pasos: un código puesto a mano ('C-0007') podría chocar con el que le
-- toca a otro antes de que el suyo cambie.
UPDATE clientes SET codigo = NULL;
UPDATE clientes SET codigo = CONCAT('C-', IF(id < 10000, LPAD(id, 4, '0'), id));
