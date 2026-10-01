-- =====================================================================
--  Migración · El expediente del cliente y su crédito
--
--  QUÉ DIJO EL USUARIO (2026-09-09)
--    "Cada vez que se realiza una venta se pide el nombre del cliente y
--    tengo clientes que llevo trabajando mucho tiempo. Quiero una tabla
--    para llevar el registro de cada uno de mis clientes, sea nuevo o sea
--    de años; quiero saber todos los detalles sobre sus compras, sus
--    créditos, sus pedidos, qué colores compra más."
--    Sobre el crédito: "fío y me abonan, sin plazo fijo".
--
--  EL PROBLEMA QUE RESUELVE
--    `clientes` existía pero era una CUENTA de la tienda en línea: nombre,
--    correo, teléfono y contraseña. No servía de expediente, y el mostrador
--    no la usaba en absoluto: el POS solo elegía la lista de precios, así
--    que TODAS las ventas de mostrador quedaban anónimas (`cliente_id` en
--    NULL) y no había forma de saber qué le vendes a quién.
--
--  DECISIONES QUE VALE LA PENA CONOCER
--    · `cliente_desde` es distinto de `creado_en`. Los clientes de años se
--      capturan hoy pero son clientes desde hace mucho: `creado_en` dice
--      cuándo entró al sistema, `cliente_desde` cuándo empezó a comprar.
--      Sin esa distinción, el día que se capturen todos parecería que la
--      tienda estrenó clientela.
--    · El cliente de mostrador NO tiene cuenta: `contrasena_hash` y
--      `correo` se quedan en NULL. `correo` es UNIQUE, y MySQL permite
--      varios NULL en un índice único, así que conviven sin chocar.
--    · `direccion` es un campo libre y NO reemplaza a `direcciones`: esa
--      tabla es para los envíos de la tienda en línea, con receptor y
--      código postal. Aquí basta con "por dónde vive" para el expediente.
--    · El SALDO NO se guarda en `clientes`: se calcula sumando
--      `credito_movimientos`. Un campo desnormalizado se descuadra en
--      cuanto una transacción falla a medias, y entonces el sistema dice
--      que alguien debe algo que no debe. La vista `v_clientes_saldo` lo
--      resuelve de una consulta.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. El expediente
-- ---------------------------------------------------------------------
ALTER TABLE clientes
    -- Número de cliente legible, para buscarlo rápido en el mostrador.
    -- Opcional: quien no lo use busca por nombre o teléfono.
    ADD COLUMN codigo VARCHAR(20) NULL AFTER id,
    -- Como le dicen de verdad ("Doña Mari", "la de la mercería"). Es con
    -- lo que la tienda lo busca, no con su nombre completo.
    ADD COLUMN nombre_comercial VARCHAR(120) NULL AFTER nombre,
    ADD COLUMN rfc VARCHAR(20) NULL AFTER nombre_comercial,
    -- Su lista de precios habitual. Al elegirlo en el POS se aplica sola,
    -- así nadie le cobra precio público a un cliente de mayoreo por
    -- descuido.
    ADD COLUMN tipo_cliente_id SMALLINT UNSIGNED NULL AFTER rfc,
    ADD COLUMN telefono_alt VARCHAR(20) NULL AFTER telefono,
    ADD COLUMN direccion VARCHAR(255) NULL AFTER telefono_alt,
    ADD COLUMN ciudad VARCHAR(100) NULL AFTER direccion,
    ADD COLUMN estado VARCHAR(100) NULL AFTER ciudad,
    -- Recomendación, redes, pasaba por aquí. Sirve para saber qué trae
    -- clientes.
    ADD COLUMN como_llego VARCHAR(60) NULL AFTER estado,
    ADD COLUMN fecha_nacimiento DATE NULL AFTER como_llego,
    -- Desde cuándo es cliente DE VERDAD, no desde cuándo está capturado.
    ADD COLUMN cliente_desde DATE NULL AFTER fecha_nacimiento,
    -- Hasta cuánto se le fía. 0 = no se le fía.
    ADD COLUMN limite_credito DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER cliente_desde,
    ADD COLUMN notas TEXT NULL AFTER limite_credito,
    ADD CONSTRAINT fk_clientes_tipo_cliente
        FOREIGN KEY (tipo_cliente_id) REFERENCES tipos_cliente(id),
    ADD CONSTRAINT chk_clientes_limite_credito CHECK (limite_credito >= 0),
    -- UNIQUE y no PRIMARY: es opcional, y varios NULL conviven.
    ADD UNIQUE KEY uq_clientes_codigo (codigo),
    -- El mostrador busca por teléfono más que por nombre.
    ADD INDEX idx_clientes_telefono (telefono),
    ADD INDEX idx_clientes_nombre (nombre);

-- Los clientes que ya existan son clientes desde que se dieron de alta.
-- Sin esto quedarían sin antigüedad y el expediente no sabría desde cuándo
-- compran.
UPDATE clientes SET cliente_desde = DATE(creado_en) WHERE cliente_desde IS NULL;

-- ---------------------------------------------------------------------
--  2. El crédito: cargos y abonos
--
--  Es un libro de movimientos, no un saldo. Cada renglón dice qué pasó y
--  el saldo es su suma, igual que el kardex de inventario y los
--  movimientos de caja: si algo no cuadra, se puede ver exactamente
--  dónde.
--
--  El signo lo define el TIPO, no el monto (como `SIGNO_CAJA` en
--  caja/model.js):
--    cargo  → SUBE la deuda   (se llevó mercancía a crédito)
--    abono  → la BAJA         (pagó)
--    ajuste → la corrige; es el único que admite monto negativo, para
--             condonar un saldo o arreglar una captura mala.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credito_movimientos (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cliente_id     BIGINT UNSIGNED NOT NULL,
    tipo           VARCHAR(10) NOT NULL,
    monto          DECIMAL(12,2) NOT NULL,
    -- La venta que generó el cargo. Queda en NULL si el pedido se borra:
    -- el movimiento se conserva porque la deuda existió, igual que los
    -- bultos de `pedido_detalle_bultos`.
    pedido_id      BIGINT UNSIGNED NULL,
    -- Con qué pagó el abono (efectivo, transferencia…).
    metodo_pago_id SMALLINT UNSIGNED NULL,
    -- Si el abono se recibió en el mostrador, en qué turno de caja entró.
    -- Sin esto el corte no cuadraría: entra dinero que no es una venta.
    sesion_caja_id BIGINT UNSIGNED NULL,
    referencia     VARCHAR(120) NULL,
    notas          VARCHAR(255) NULL,
    -- Quién lo registró. Un saldo que cambia sin responsable no se puede
    -- aclarar después.
    usuario_id     BIGINT UNSIGNED NULL,
    creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_credmov_cliente  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
    CONSTRAINT fk_credmov_pedido   FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE SET NULL,
    CONSTRAINT fk_credmov_metodo   FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago(id),
    CONSTRAINT fk_credmov_sesion   FOREIGN KEY (sesion_caja_id) REFERENCES sesiones_caja(id),
    CONSTRAINT fk_credmov_usuario  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    CONSTRAINT chk_credmov_tipo    CHECK (tipo IN ('cargo', 'abono', 'ajuste')),
    -- Un movimiento de cero no dice nada; y solo el ajuste puede ser negativo.
    CONSTRAINT chk_credmov_monto   CHECK (monto <> 0 AND (monto > 0 OR tipo = 'ajuste')),
    INDEX idx_credmov_cliente (cliente_id, creado_en),
    INDEX idx_credmov_pedido (pedido_id),
    INDEX idx_credmov_sesion (sesion_caja_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  3. El saldo de cada cliente, de una consulta
--
--  Incluye a los clientes SIN movimientos (saldo 0): el listado los
--  necesita a todos, y un INNER JOIN los dejaría fuera.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_clientes_saldo AS
SELECT  c.id AS cliente_id,
        c.nombre,
        c.limite_credito,
        COALESCE(SUM(CASE WHEN m.tipo = 'abono' THEN 0 ELSE m.monto END), 0) AS cargos,
        COALESCE(SUM(CASE WHEN m.tipo = 'abono' THEN m.monto ELSE 0 END), 0) AS abonos,
        COALESCE(SUM(CASE WHEN m.tipo = 'abono' THEN -m.monto ELSE m.monto END), 0) AS saldo,
        -- Cuánto más se le puede fiar. Nunca negativo: si ya se pasó del
        -- límite, lo disponible es cero, no una cifra en rojo que se
        -- confundiría con crédito a favor.
        GREATEST(
          c.limite_credito
            - COALESCE(SUM(CASE WHEN m.tipo = 'abono' THEN -m.monto ELSE m.monto END), 0),
          0
        ) AS disponible,
        MAX(CASE WHEN m.tipo = 'abono' THEN m.creado_en END) AS ultimo_abono
FROM clientes c
LEFT JOIN credito_movimientos m ON m.cliente_id = c.id
GROUP BY c.id, c.nombre, c.limite_credito;
