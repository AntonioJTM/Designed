-- =====================================================================
--  Migración · El checkout de la tienda en línea captura entrega y pago
--
--  Era el hueco más viejo del proyecto: el checkout mandaba solo los
--  artículos y el pedido nacía 'pendiente' sin decir cómo se entrega ni
--  cómo se paga.
--
--  Decisiones del usuario (2026-09-05):
--    · Se cobra por TRANSFERENCIA o en EFECTIVO EN TIENDA. No hay pasarela
--      ni se guardan datos de tarjeta: el pedido queda 'pendiente' hasta
--      que un administrador confirma el depósito o el pago en mostrador.
--    · La entrega es RECOGER EN TIENDA (sin dirección, envío $0) o ENVÍO
--      A DOMICILIO con una tarifa FIJA que el administrador configura.
--
--  Por qué `metodo_entrega` vive en el pedido y no se deduce de si trae
--  dirección: lo que se le prometió al cliente tiene que quedar escrito.
--  Deducirlo dejaría el panel a merced de un dato que puede cambiar
--  después, y un pedido de envío sin dirección se leería como "recoger"
--  justo cuando más importa saber que no lo es.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Cómo se entrega el pedido
-- ---------------------------------------------------------------------
ALTER TABLE pedidos
    ADD COLUMN metodo_entrega VARCHAR(10) NOT NULL DEFAULT 'recoger'
        AFTER canal,
    ADD CONSTRAINT chk_pedidos_metodo_entrega
        CHECK (metodo_entrega IN ('recoger', 'envio'));

-- Los pedidos que ya existen son de mostrador o se entregaron en tienda:
-- 'recoger' es lo correcto y es el DEFAULT, así que no hay que tocarlos.
-- Salvo los que sí llevan dirección de envío capturada.
UPDATE pedidos SET metodo_entrega = 'envio' WHERE direccion_envio_id IS NOT NULL;

-- ---------------------------------------------------------------------
--  Configuración de la tienda: clave/valor
--
--  Tabla nueva y deliberadamente simple. No es un módulo de "ajustes":
--  son los pocos datos que el administrador tiene que poder cambiar sin
--  tocar código ni reiniciar el servidor. `publica` dice si el valor lo
--  puede leer un visitante sin sesión (el costo de envío sí; nada
--  sensible vive aquí, pero la bandera evita que mañana se filtre algo).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracion (
    clave          VARCHAR(60) NOT NULL PRIMARY KEY,
    valor          TEXT NULL,
    descripcion    VARCHAR(255) NULL,
    publica        TINYINT(1) NOT NULL DEFAULT 0,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO configuracion (clave, valor, descripcion, publica) VALUES
 ('envio_costo_fijo', '0.00',
  'Lo que se cobra por enviar a domicilio, en pesos. Tarifa única.', 1),
 ('transferencia_banco', NULL,
  'Banco al que el cliente deposita cuando paga por transferencia.', 1),
 ('transferencia_titular', NULL,
  'A nombre de quién está la cuenta.', 1),
 ('transferencia_clabe', NULL,
  'CLABE o número de cuenta que se le muestra al cliente.', 1),
 ('tienda_telefono', NULL,
  'Teléfono de contacto que ve el cliente al confirmar su pedido.', 1),
 ('tienda_direccion', NULL,
  'Dónde se recoge el pedido. Se le muestra al cliente que elige recoger.', 1)
ON DUPLICATE KEY UPDATE clave = clave;
