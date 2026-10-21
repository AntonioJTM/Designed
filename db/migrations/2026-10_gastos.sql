-- =====================================================================
--  Migración · GASTOS de la caja, con su tipo y su límite (2026-10-20)
--
--  "Vamos a hacer otro apartado de gastos con límites; va en caja porque el
--  dinero sale de caja y no se calcula en nómina; tiene que llevar tipo, por
--  ejemplo viajes, limpieza, papelería" (usuario). Decidió:
--    · el LÍMITE es POR GASTO (un tope por gasto suelto de ese tipo);
--    · si un gasto lo pasa, se PIDE AUTORIZACIÓN (como un retiro);
--    · la foto del ticket o factura es OPCIONAL.
--
--  El gasto sale del cajón del turno abierto: un `movimientos_caja` de tipo
--  'gasto' (nuevo; el corte lo resta como un retiro) ligado a su renglón en
--  `gastos`. Cancelarlo (mismo turno abierto) regresa el dinero como 'ingreso'.
-- =====================================================================

-- Los tipos (Viajes, Limpieza, Papelería…) con su tope por gasto. Sin tope
-- (NULL), TODO gasto de ese tipo se autoriza (salvo quien autoriza, que lo hace
-- directo): "sin límite" no es "pasa todo" (revisor de tiendas, 2026-10-20).
CREATE TABLE IF NOT EXISTS tipos_gasto (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  nombre     VARCHAR(60)   NOT NULL,
  limite     DECIMAL(12,2) NULL,
  activo     TINYINT(1)    NOT NULL DEFAULT 1,
  creado_en  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipos_gasto_nombre (nombre),
  CONSTRAINT chk_tipos_gasto_limite CHECK (limite IS NULL OR limite > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cada gasto: de qué turno salió, de qué tipo, cuánto y qué se compró. El tope
-- con que se registró queda CONGELADO (`limite`), como el precio de una venta.
CREATE TABLE IF NOT EXISTS gastos (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sesion_caja_id      BIGINT UNSIGNED NOT NULL,
  movimiento_caja_id  BIGINT UNSIGNED NULL,
  tipo_gasto_id       INT UNSIGNED    NOT NULL,
  monto               DECIMAL(12,2)   NOT NULL,
  descripcion         VARCHAR(255)    NOT NULL,
  limite              DECIMAL(12,2)   NULL,
  autorizacion_id     BIGINT UNSIGNED NULL,
  comprobante         VARCHAR(60)     NULL,   -- el nombre en disco (uploads/gastos)
  comprobante_nombre  VARCHAR(255)    NULL,   -- el que traía el archivo, para mostrarlo
  comprobante_tipo    VARCHAR(40)     NULL,
  usuario_id          BIGINT UNSIGNED NOT NULL,
  estado              VARCHAR(12)     NOT NULL DEFAULT 'registrado',
  cancelado_en        DATETIME        NULL,
  cancelado_por       BIGINT UNSIGNED NULL,
  motivo_cancelacion  VARCHAR(255)    NULL,
  creado_en           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gastos_sesion (sesion_caja_id),
  KEY idx_gastos_tipo (tipo_gasto_id),
  KEY idx_gastos_fecha (creado_en),
  CONSTRAINT fk_gastos_sesion  FOREIGN KEY (sesion_caja_id) REFERENCES sesiones_caja (id) ON DELETE CASCADE,
  CONSTRAINT fk_gastos_tipo    FOREIGN KEY (tipo_gasto_id)  REFERENCES tipos_gasto (id),
  CONSTRAINT fk_gastos_usuario FOREIGN KEY (usuario_id)     REFERENCES usuarios (id),
  CONSTRAINT chk_gastos_monto  CHECK (monto > 0),
  CONSTRAINT chk_gastos_estado CHECK (estado IN ('registrado', 'cancelado'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El movimiento de caja nuevo: 'gasto' (sale del cajón, como un retiro).
ALTER TABLE movimientos_caja DROP CONSTRAINT IF EXISTS movimientos_caja_chk_1;
ALTER TABLE movimientos_caja ADD CONSTRAINT movimientos_caja_chk_1
  CHECK (tipo IN ('venta', 'ingreso', 'retiro', 'devolucion', 'gasto'));

-- Los que dio de ejemplo el usuario, SIN tope (todo se autoriza) hasta que el
-- administrador les ponga el suyo.
INSERT IGNORE INTO tipos_gasto (nombre) VALUES ('Viajes'), ('Limpieza'), ('Papelería');

INSERT IGNORE INTO permisos (clave, descripcion) VALUES
  ('hacer:registrar_gasto',    'Registrar gastos de la caja hasta su límite'),
  ('hacer:gasto_sobre_limite', 'Registrar gastos arriba de su límite (y autorizarlos)'),
  ('pedir:gasto_sobre_limite', 'Pedir autorización para un gasto arriba de su límite'),
  ('hacer:tipos_gasto',        'Dar de alta los tipos de gasto y sus límites');

-- Registra gastos quien hoy saca o pide sacar efectivo (cajero y gerente).
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, pn.id
  FROM rol_permisos rp
  JOIN permisos p  ON p.id = rp.permiso_id AND p.clave IN ('hacer:mover_efectivo', 'pedir:mover_efectivo')
  JOIN permisos pn ON pn.clave = 'hacer:registrar_gasto';

-- Pasa el límite (y lo autoriza) quien saca efectivo directo; lo PIDE quien lo pide.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, pn.id
  FROM rol_permisos rp
  JOIN permisos p  ON p.id = rp.permiso_id AND p.clave = 'hacer:mover_efectivo'
  JOIN permisos pn ON pn.clave = 'hacer:gasto_sobre_limite';
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, pn.id
  FROM rol_permisos rp
  JOIN permisos p  ON p.id = rp.permiso_id AND p.clave = 'pedir:mover_efectivo'
  JOIN permisos pn ON pn.clave = 'pedir:gasto_sobre_limite';
-- Los tipos y sus límites: solo el administrador (lo puede todo) hasta que se dé en Permisos.
