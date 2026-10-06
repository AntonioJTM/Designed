-- =====================================================================
--  Migración · Qué bultos viajaron en cada envío (2026-10-06)
--
--  Al enviar un traspaso, los bultos más antiguos del origen pasan a
--  apuntar a la sucursal. Pero no quedaba escrito CUÁLES, así que al
--  cancelar un envío en camino se regresaban al origen TODOS los bultos
--  disponibles de ese hilo que hubiera en la sucursal, incluidos los que
--  llegaron en traspasos anteriores ya recibidos (la prueba lo enseñó:
--  viajaron 75 y regresaron 80). Los saldos seguían bien —son la verdad—
--  pero la sucursal se quedaba sin bultos y la bodega con bultos de más.
--
--  Esta tabla liga cada línea del traspaso con los bultos que se movieron
--  al enviarla; la cancelación regresa solo esos. Surge al pasar Surtir
--  sucursal a pedir en PAQUETES, donde el envío siempre mueve bultos.
--  Los envíos hechos antes de esta migración no tienen renglones aquí: si
--  se cancelan, sus bultos se quedan donde están (su ubicación es
--  aproximada a propósito y se corrige al escanearlos).
-- =====================================================================

CREATE TABLE IF NOT EXISTS traspaso_bultos (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    detalle_id         BIGINT UNSIGNED NOT NULL,
    variante_codigo_id BIGINT UNSIGNED NOT NULL,
    KEY idx_traspaso_bultos_detalle (detalle_id),
    KEY idx_traspaso_bultos_bulto (variante_codigo_id),
    CONSTRAINT traspaso_bultos_detalle FOREIGN KEY (detalle_id)
        REFERENCES traspaso_detalle (id) ON DELETE CASCADE,
    CONSTRAINT traspaso_bultos_bulto FOREIGN KEY (variante_codigo_id)
        REFERENCES variante_codigos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
