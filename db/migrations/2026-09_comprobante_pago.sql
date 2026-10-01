-- =====================================================================
--  Migración · La captura del comprobante de pago
--
--  La tienda en línea no cobra: el cliente deposita por transferencia y le
--  manda la captura al administrador (por WhatsApp, normalmente). Hasta
--  ahora esa captura no vivía en ningún lado, así que el pedido se marcaba
--  pagado "de memoria" y no quedaba con qué respaldarlo.
--
--  Decisión del usuario (2026-09-05): la sube SOLO el administrador desde
--  el panel —el cliente se la manda por fuera— y subirla es UN PASO: el
--  pago queda 'completado' y el pedido 'pagado' en la misma operación.
--  No hay estado intermedio "por validar".
--
--  El archivo NO se guarda en la base: vive en disco (uploads/comprobantes)
--  y aquí queda solo su nombre. Un dump de la base pesa 90 KB y meterle
--  imágenes lo volvería inmanejable, además de que las copias de respaldo
--  se hacen con mysqldump.
-- =====================================================================

ALTER TABLE pagos
    -- Nombre del archivo EN DISCO (generado, sin datos del original).
    ADD COLUMN comprobante_archivo VARCHAR(255) NULL,
    -- Cómo se llamaba cuando lo mandó el cliente. Solo para mostrarlo y para
    -- que la descarga conserve un nombre reconocible.
    ADD COLUMN comprobante_nombre VARCHAR(255) NULL,
    -- image/jpeg, image/png, image/webp o application/pdf. Se detecta por los
    -- primeros bytes del archivo, no por su extensión.
    ADD COLUMN comprobante_tipo VARCHAR(60) NULL,
    ADD COLUMN comprobante_subido_en DATETIME NULL,
    ADD COLUMN comprobante_subido_por BIGINT UNSIGNED NULL,
    ADD CONSTRAINT fk_pagos_comprobante_por
        FOREIGN KEY (comprobante_subido_por) REFERENCES usuarios(id);
