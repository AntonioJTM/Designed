-- =============================================================================
-- TRANSFERENCIAS (2026-10-20, usuario: "un apartado en ventas que se llame
-- transferencias", como su hoja: fecha, folio de venta, cliente, cuenta, no. de
-- operación, producto, importe, estado y facturado).
--
-- La lista sale SOLA de lo que ya se guarda (pagos, abonos y anticipos por
-- transferencia). Aquí va solo lo NUEVO de cada una: a qué cuenta llegó, si ya
-- se revisó en el banco ("Procesada") y si se facturó. Se liga por
-- (fuente, fuente_id): 'pago' = pagos.id, 'abono' = el PRIMER renglón de
-- credito_movimientos del depósito, 'anticipo' = saldo_favor_movimientos.id.
-- Sin su renglón la transferencia sale igual, "Por revisar" y sin cuenta.
-- =============================================================================

CREATE TABLE IF NOT EXISTS transferencias (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  fuente             VARCHAR(10)     NOT NULL,
  fuente_id          BIGINT UNSIGNED NOT NULL,
  cuenta_bancaria_id INT UNSIGNED    NULL,
  estado             VARCHAR(12)     NOT NULL DEFAULT 'por_revisar',
  facturada          TINYINT(1)      NOT NULL DEFAULT 0,
  revisada_por       BIGINT UNSIGNED NULL,
  revisada_en        DATETIME        NULL,
  facturada_por      BIGINT UNSIGNED NULL,
  facturada_en       DATETIME        NULL,
  creado_por         BIGINT UNSIGNED NULL,
  creado_en          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_transferencias_fuente (fuente, fuente_id),
  KEY idx_transferencias_cuenta (cuenta_bancaria_id),
  CONSTRAINT fk_transferencias_cuenta FOREIGN KEY (cuenta_bancaria_id) REFERENCES cuentas_bancarias (id),
  CONSTRAINT fk_transferencias_revisada FOREIGN KEY (revisada_por) REFERENCES usuarios (id),
  CONSTRAINT fk_transferencias_facturada FOREIGN KEY (facturada_por) REFERENCES usuarios (id),
  CONSTRAINT fk_transferencias_creado FOREIGN KEY (creado_por) REFERENCES usuarios (id),
  CONSTRAINT chk_transferencias_fuente CHECK (fuente IN ('pago', 'abono', 'anticipo')),
  CONSTRAINT chk_transferencias_estado CHECK (estado IN ('por_revisar', 'procesada'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permisos (clave, descripcion) VALUES
  ('ver:transferencias',           'Transferencias: todo lo que entró por transferencia'),
  ('hacer:revisar_transferencias', 'Marcar transferencias como procesadas o facturadas y corregir su cuenta');

-- Las ven y las marcan quienes hoy ven Reportes (gerente y Contabilidad); el
-- administrador lo puede todo. Como suman todas las tiendas, además piden
-- «Todas las tiendas» en Personal.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, pn.id
  FROM rol_permisos rp
  JOIN permisos p  ON p.id = rp.permiso_id AND p.clave = 'ver:reportes'
  JOIN permisos pn ON pn.clave IN ('ver:transferencias', 'hacer:revisar_transferencias');
