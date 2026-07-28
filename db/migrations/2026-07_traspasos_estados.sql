-- =====================================================================
--  Migración · El traspaso deja de ser inmediato: solicitud → tránsito → recibido
--
--  Antes el traspaso salía y entraba en la misma transacción; no se modelaba
--  el tiempo de camino. Decisión explícita del usuario en su momento, que él
--  mismo cambió el 2026-07-28: "necesito como un status de en tránsito y así
--  pendiente de envío, y necesito que el responsable acepte de que recibió y
--  que diga qué recibió, para que no haya problemas".
--
--  Los estados y qué mueve cada paso:
--    solicitado  → nada se mueve. Se APARTA en el origen (cantidad_reservada).
--    en_transito → SALE del origen, con su movimiento en el kardex.
--    recibido    → ENTRA al destino lo que de verdad llegó; el faltante se
--                  asienta como merma con el folio del traspaso.
--    cancelado   → si estaba solicitado, libera el apartado; si iba en
--                  tránsito, la mercancía regresa al origen.
--
--  El apartado es BLANDO: se ve en inventario, pero la venta de mostrador NO lo
--  respeta —el cliente que está enfrente manda— y al enviar se vuelve a
--  validar. Por eso `cantidad_reservada` puede quedar por encima de `cantidad`
--  si se vendió lo apartado; el envío lo detecta y lo reporta.
-- =====================================================================

ALTER TABLE traspasos
    ADD COLUMN estado VARCHAR(20) NOT NULL DEFAULT 'solicitado'
        AFTER almacen_destino_id,
    ADD COLUMN enviado_en   DATETIME NULL,
    ADD COLUMN enviado_por  BIGINT UNSIGNED NULL,
    ADD COLUMN recibido_en  DATETIME NULL,
    ADD COLUMN recibido_por BIGINT UNSIGNED NULL,
    -- Lo que el responsable escribe al aceptar: "llegaron 4 de 5, uno mojado".
    ADD COLUMN recepcion_notas TEXT NULL,
    ADD COLUMN cancelado_en  DATETIME NULL,
    ADD COLUMN cancelado_por BIGINT UNSIGNED NULL,
    ADD COLUMN motivo_cancelacion VARCHAR(255) NULL,
    ADD CONSTRAINT chk_traspasos_estado
        CHECK (estado IN ('solicitado', 'en_transito', 'recibido', 'cancelado')),
    ADD CONSTRAINT fk_traspasos_enviado_por  FOREIGN KEY (enviado_por)  REFERENCES usuarios(id),
    ADD CONSTRAINT fk_traspasos_recibido_por FOREIGN KEY (recibido_por) REFERENCES usuarios(id),
    ADD CONSTRAINT fk_traspasos_cancelado_por FOREIGN KEY (cancelado_por) REFERENCES usuarios(id),
    ADD INDEX idx_traspasos_estado (estado);

ALTER TABLE traspaso_detalle
    -- Lo que de verdad llegó. NULL mientras no se recibe.
    ADD COLUMN cantidad_recibida  DECIMAL(12,3) NULL,
    ADD COLUMN paquetes_recibidos DECIMAL(12,3) NULL;

-- Los traspasos que ya existen se hicieron completos y de golpe: quedan como
-- recibidos, con las mismas fechas y con lo recibido igual a lo enviado. Así el
-- historial no miente ni aparecen documentos "pendientes" que nadie va a surtir.
UPDATE traspasos
   SET estado = 'recibido',
       enviado_en = creado_en,
       enviado_por = usuario_id,
       recibido_en = creado_en,
       recibido_por = usuario_id
 WHERE estado = 'solicitado';

UPDATE traspaso_detalle
   SET cantidad_recibida = cantidad,
       paquetes_recibidos = paquetes
 WHERE cantidad_recibida IS NULL;
