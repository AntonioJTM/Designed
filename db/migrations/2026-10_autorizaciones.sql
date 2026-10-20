-- AUTORIZACIONES (2026-10-19): "que se haga la solicitud y el administrador o
-- quien tenga el permiso autorice la operación; mientras, no se puede hacer"
-- (usuario). Quien no tiene el permiso de HACER una operación pero sí el de
-- PEDIRLA deja una solicitud con todo lo que pidió; quien sí puede hacerla la
-- acepta (y el sistema la hace en ese momento) o la rechaza. También se
-- autoriza en el momento, con la clave de quien autoriza en la pantalla de
-- quien pide (el cliente que espera en el mostrador), con su CLAVE DE
-- AUTORIZACIÓN: un número aparte de la contraseña de entrar (si alguien la ve en
-- la computadora de la caja, no puede entrar al sistema con ella).
--
-- Fase 1: sacar o meter efectivo, cancelar venta, devolución, corregir deuda,
-- ajustar el saldo a favor, cambiar precios, ajuste y merma, fiar con cuenta
-- atrasada y subir el crédito de un cliente.

CREATE TABLE IF NOT EXISTS autorizaciones (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operacion       VARCHAR(40)  NOT NULL,          -- la clave de `autorizaciones/operaciones.js`
  estado          VARCHAR(12)  NOT NULL DEFAULT 'pendiente',
  metodo          VARCHAR(8)   NOT NULL,           -- la petición tal cual, para hacerla al aceptar
  ruta            VARCHAR(255) NOT NULL,
  cuerpo          MEDIUMTEXT   NULL,
  resumen         VARCHAR(500) NOT NULL,           -- lo que se pide, en palabras
  almacenes       VARCHAR(100) NULL,               -- de qué tiendas es ("1,9"); NULL = de ninguna en particular
  solicitante_id  BIGINT UNSIGNED NOT NULL,
  solicitado_en   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  autorizador_id  BIGINT UNSIGNED NULL,
  en_el_momento   TINYINT(1)   NOT NULL DEFAULT 0, -- con su clave, en la pantalla de quien pidió
  aprobando_en    DATETIME     NULL,
  resuelto_en     DATETIME     NULL,
  motivo          VARCHAR(255) NULL,               -- por qué se rechazó
  ultimo_error    VARCHAR(500) NULL,               -- por qué no se pudo hacer al aceptarla
  resultado       MEDIUMTEXT   NULL,
  contexto        MEDIUMTEXT   NULL,               -- lo que se revisa al aceptarla (el saldo de un ajuste)
  secreto         CHAR(64)     NULL,               -- sha256 de la llave de un solo uso al aceptarla
  PRIMARY KEY (id),
  KEY idx_autorizaciones_estado (estado, solicitado_en),
  KEY idx_autorizaciones_solicitante (solicitante_id, solicitado_en),
  CONSTRAINT fk_autorizaciones_solicitante FOREIGN KEY (solicitante_id) REFERENCES usuarios (id),
  CONSTRAINT fk_autorizaciones_autorizador FOREIGN KEY (autorizador_id) REFERENCES usuarios (id),
  CONSTRAINT chk_autorizaciones_estado CHECK (estado IN ('pendiente', 'aprobando', 'aprobada', 'rechazada', 'cancelada', 'vencida', 'cerrada'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 'cerrada': se interrumpió a media aprobación y alguien la cerró sin saber si se
-- hizo (no es un rechazo). En la base de pruebas la tabla ya existía sin ella.
ALTER TABLE autorizaciones DROP CONSTRAINT IF EXISTS chk_autorizaciones_estado;
ALTER TABLE autorizaciones ADD CONSTRAINT chk_autorizaciones_estado
  CHECK (estado IN ('pendiente', 'aprobando', 'aprobada', 'rechazada', 'cancelada', 'vencida', 'cerrada'));

-- La clave de autorización de cada quien (bcrypt), aparte de su contraseña.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS clave_autorizacion_hash VARCHAR(100) NULL;
-- Las equivocadas SEGUIDAS (de quien sea): a las 10 la clave se APAGA y su dueño
-- la vuelve a poner (así no se adivina a la fuerza: son 4 a 6 números). Se
-- guarda cuándo y quién la escribió mal la última vez, para la campana.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS clave_autorizacion_fallos TINYINT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS clave_autorizacion_apagada_en DATETIME NULL;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS clave_autorizacion_apagada_por BIGINT UNSIGNED NULL;

INSERT IGNORE INTO permisos (clave, descripcion) VALUES
  ('ver:autorizaciones',     'Autorizaciones: lo que se pidió y lo que hay que autorizar'),
  ('hacer:dar_credito',      'Darle o subirle el crédito a un cliente'),
  ('hacer:fiar_atrasado',    'Fiar a quien trae su cuenta atrasada'),
  ('pedir:mover_efectivo',   'Pedir autorización para sacar o meter efectivo'),
  ('pedir:cancelar_venta',   'Pedir autorización para cancelar o devolver una venta'),
  ('pedir:corregir_deuda',   'Pedir autorización para corregir la deuda o el saldo a favor'),
  ('pedir:cambiar_precios',  'Pedir autorización para cambiar precios'),
  ('pedir:ajuste_merma',     'Pedir autorización para un ajuste o una merma'),
  ('pedir:fiar_atrasado',    'Pedir autorización para fiar a quien trae su cuenta atrasada'),
  ('pedir:dar_credito',      'Pedir autorización para darle o subirle el crédito a un cliente');

-- Todos los que entran al sistema ven la pantalla: lo que pidieron y, si
-- autorizan algo, lo que les toca.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.clave = 'ver:autorizaciones'
 WHERE r.entra_al_sistema = 1 AND r.nombre <> 'administrador';

-- El gerente lo hace directo y autoriza, también lo nuevo.
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.clave IN ('hacer:dar_credito', 'hacer:fiar_atrasado')
 WHERE r.nombre = 'gerente';

-- La cajera PIDE lo delicado del mostrador. Sacar o meter efectivo lo hacía
-- directo: ahora lo pide (es de lo que el usuario dijo que necesita autorización).
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.clave IN
       ('pedir:mover_efectivo', 'pedir:cancelar_venta', 'pedir:corregir_deuda', 'pedir:fiar_atrasado', 'pedir:dar_credito')
 WHERE r.nombre = 'cajero';
DELETE rp FROM rol_permisos rp
  JOIN roles r    ON r.id = rp.rol_id
  JOIN permisos p ON p.id = rp.permiso_id
 WHERE r.nombre = 'cajero' AND p.clave = 'hacer:mover_efectivo';

-- El almacenista PIDE el ajuste y la merma (los hacía directo).
INSERT IGNORE INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.clave = 'pedir:ajuste_merma'
 WHERE r.nombre = 'almacenista';
DELETE rp FROM rol_permisos rp
  JOIN roles r    ON r.id = rp.rol_id
  JOIN permisos p ON p.id = rp.permiso_id
 WHERE r.nombre = 'almacenista' AND p.clave = 'hacer:ajuste_merma';
