-- =====================================================================
--  Migración · DEVOLUCIONES con SALDO A FAVOR (2026-10-13, parte 2)
--
--  "Un cliente te compra hilo y regresa una parte o todo: no le quiero
--  regresar dinero, lo que se le tiene que agregar es como un saldo a favor de
--  lo que regresó" (usuario). La devolución se hace desde la NOTA del cliente,
--  línea por línea: los paquetes cerrados se escanean y vuelven como paquetes
--  con su peso; los conos sueltos se pesan y vuelven como conos (lo que marque
--  la báscula, sin restar tubos). Lo que regresa queda a favor al precio con
--  que se vendió.
--
--  El saldo a favor va APARTE de la deuda: "a veces el cliente pide que su
--  saldo a favor se utilice para otras compras y dejar su crédito como está".
--  Se descuenta de lo que debe o se usa al cobrarle, como él elija.
--
--  · devoluciones / devolucion_detalle / devolucion_bultos: qué regresó de qué
--    nota, a qué presentación entró, cuánto quedó a favor y qué paquetes.
--  · saldo_favor_movimientos: el LIBRO del saldo a favor (como el de crédito):
--      devolucion (+)  lo que regresó;
--      uso        (−)  se usó para pagar una compra;
--      aplicado   (−)  se descontó de lo que debía (crédito o nota pendiente);
--      reintegro  (+)  se canceló la venta donde se había usado;
--      ajuste     (±)  corrección, con motivo.
--    El saldo es la suma; no hay campo de saldo en `clientes`.
--  · metodos_pago.interno: un método que el sistema usa por su cuenta y no se
--    ofrece al cobrar. "Saldo a favor" es uno: el pago que hace el saldo.
-- =====================================================================

CREATE TABLE devoluciones (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  folio       VARCHAR(40) NOT NULL,
  pedido_id   BIGINT UNSIGNED NOT NULL,
  cliente_id  BIGINT UNSIGNED NOT NULL,
  almacen_id  SMALLINT UNSIGNED NOT NULL,
  usuario_id  BIGINT UNSIGNED NULL,
  total       DECIMAL(12,2) NOT NULL,
  -- De lo que regresó, cuánto se descontó en ese momento de lo que debía.
  aplicado_a_deuda DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  notas       VARCHAR(255) NULL,
  creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devoluciones_folio (folio),
  KEY idx_devoluciones_pedido (pedido_id),
  KEY idx_devoluciones_cliente (cliente_id, creado_en),
  CONSTRAINT fk_devoluciones_pedido  FOREIGN KEY (pedido_id)  REFERENCES pedidos (id),
  CONSTRAINT fk_devoluciones_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id),
  CONSTRAINT fk_devoluciones_almacen FOREIGN KEY (almacen_id) REFERENCES almacenes (id),
  CONSTRAINT fk_devoluciones_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT chk_devoluciones_total CHECK (total > 0 AND aplicado_a_deuda >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE devolucion_detalle (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  devolucion_id  BIGINT UNSIGNED NOT NULL,
  -- La línea de la nota de donde regresa.
  detalle_id     BIGINT UNSIGNED NOT NULL,
  -- A qué presentación entró: el paquete (cerrado) o el cono (suelto).
  variante_id    BIGINT UNSIGNED NOT NULL,
  cantidad       DECIMAL(12,3) NOT NULL,
  -- Cuántos conos eran (informativo, como pedido_detalle.piezas).
  piezas         INT UNSIGNED NULL,
  importe        DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_devdet_devolucion (devolucion_id),
  KEY idx_devdet_detalle (detalle_id),
  CONSTRAINT fk_devdet_devolucion FOREIGN KEY (devolucion_id) REFERENCES devoluciones (id) ON DELETE CASCADE,
  CONSTRAINT fk_devdet_detalle    FOREIGN KEY (detalle_id)    REFERENCES pedido_detalle (id),
  CONSTRAINT fk_devdet_variante   FOREIGN KEY (variante_id)   REFERENCES producto_variantes (id),
  CONSTRAINT chk_devdet_cantidad  CHECK (cantidad > 0 AND importe >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE devolucion_bultos (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  devolucion_detalle_id  BIGINT UNSIGNED NOT NULL,
  -- La referencia viva; el código y el peso se congelan, como en la venta.
  variante_codigo_id     BIGINT UNSIGNED NULL,
  codigo                 VARCHAR(60) NOT NULL,
  peso_kg                DECIMAL(12,3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_devbul_detalle (devolucion_detalle_id),
  KEY idx_devbul_codigo (variante_codigo_id),
  CONSTRAINT fk_devbul_detalle FOREIGN KEY (devolucion_detalle_id) REFERENCES devolucion_detalle (id) ON DELETE CASCADE,
  CONSTRAINT fk_devbul_codigo  FOREIGN KEY (variante_codigo_id) REFERENCES variante_codigos (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE saldo_favor_movimientos (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id     BIGINT UNSIGNED NOT NULL,
  tipo           VARCHAR(12) NOT NULL,
  monto          DECIMAL(12,2) NOT NULL,
  pedido_id      BIGINT UNSIGNED NULL,
  devolucion_id  BIGINT UNSIGNED NULL,
  usuario_id     BIGINT UNSIGNED NULL,
  notas          VARCHAR(255) NULL,
  creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sfm_cliente (cliente_id, creado_en),
  KEY idx_sfm_pedido (pedido_id),
  CONSTRAINT fk_sfm_cliente    FOREIGN KEY (cliente_id)    REFERENCES clientes (id) ON DELETE CASCADE,
  CONSTRAINT fk_sfm_pedido     FOREIGN KEY (pedido_id)     REFERENCES pedidos (id) ON DELETE SET NULL,
  CONSTRAINT fk_sfm_devolucion FOREIGN KEY (devolucion_id) REFERENCES devoluciones (id) ON DELETE SET NULL,
  CONSTRAINT fk_sfm_usuario    FOREIGN KEY (usuario_id)    REFERENCES usuarios (id),
  CONSTRAINT chk_sfm_tipo  CHECK (tipo IN ('devolucion', 'uso', 'aplicado', 'reintegro', 'ajuste')),
  CONSTRAINT chk_sfm_monto CHECK (monto <> 0 AND (monto > 0 OR tipo = 'ajuste'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE metodos_pago
    ADD COLUMN interno TINYINT(1) NOT NULL DEFAULT 0 AFTER activo;
INSERT INTO metodos_pago (nombre, activo, interno)
SELECT 'Saldo a favor', 1, 1 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM metodos_pago WHERE nombre = 'Saldo a favor');
