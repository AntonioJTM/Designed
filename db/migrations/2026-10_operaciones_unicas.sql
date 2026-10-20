-- =====================================================================
--  Migración · Una operación de dinero se registra UNA vez (2026-10-20)
--
--  Auditoría (/verificar): solo la VENTA tenía su llave de un solo uso
--  (`pedidos.clave_cobro`). Un abono, un anticipo, el pago de una nota o un
--  retiro de la caja se podían registrar dos veces con un doble clic o al
--  reintentar tras una red lenta: en hitex hay 3 anticipos de $1,000 de INES en
--  98 segundos.
--
--  La pantalla manda una llave por operación (`X-Clave-Unica`, un UUID que
--  cambia al registrarse). La primera vez queda aquí "en_curso"; al contestar
--  bien se guarda su respuesta ("hecha") y una segunda petición con la misma
--  llave recibe ESA respuesta sin registrar nada. Si falla, la llave se borra
--  (se puede reintentar). Se limpia sola a los 2 días.
-- =====================================================================

CREATE TABLE IF NOT EXISTS operaciones_unicas (
  clave       VARCHAR(64)     NOT NULL,
  usuario_id  BIGINT UNSIGNED NULL,
  metodo      VARCHAR(8)      NOT NULL,
  ruta        VARCHAR(255)    NOT NULL,
  estado      VARCHAR(10)     NOT NULL DEFAULT 'en_curso',
  status      SMALLINT        NULL,
  respuesta   MEDIUMTEXT      NULL,
  creado_en   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (clave),
  KEY idx_ou_creado (creado_en),
  CONSTRAINT chk_ou_estado CHECK (estado IN ('en_curso', 'hecha'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
