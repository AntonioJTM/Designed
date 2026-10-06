-- =====================================================================
--  Migración · Varias cuentas de banco para transferencias (2026-10-06)
--
--  Lo pidió el usuario: "Apartado de las cuentas de banco para
--  transferencias: se tiene que poder agregar más de una y agregando
--  número de cuenta".
--
--  Antes había UNA cuenta en tres claves sueltas de `configuracion`
--  (transferencia_banco, transferencia_titular y transferencia_clabe, que
--  además mezclaba "CLABE o número de cuenta"). Ahora cada cuenta es un
--  renglón con su banco, a nombre de quién está, su número de cuenta y su
--  CLABE. La que estaba capturada se copia aquí (a CLABE si son 18 dígitos;
--  si no, a número de cuenta) y las tres claves se borran, para que la
--  pantalla y el checkout lean un solo lugar.
-- =====================================================================

CREATE TABLE IF NOT EXISTS cuentas_bancarias (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    banco          VARCHAR(80)  NOT NULL,
    titular        VARCHAR(120) NULL,
    numero_cuenta  VARCHAR(20)  NULL,
    clabe          CHAR(18)     NULL,
    activa         TINYINT(1)   NOT NULL DEFAULT 1,
    creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cuentas_bancarias_clabe (clabe),
    -- Sin número de cuenta ni CLABE, al cliente no le sirve para depositar.
    CONSTRAINT cuentas_bancarias_dato CHECK (numero_cuenta IS NOT NULL OR clabe IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La cuenta que ya estaba capturada, si había una (y si esta tabla está vacía).
INSERT INTO cuentas_bancarias (banco, titular, numero_cuenta, clabe)
SELECT COALESCE(NULLIF(TRIM(b.valor), ''), 'Banco'),
       NULLIF(TRIM(t.valor), ''),
       CASE WHEN REPLACE(TRIM(c.valor), ' ', '') REGEXP '^[0-9]{18}$' THEN NULL
            ELSE LEFT(REPLACE(TRIM(c.valor), ' ', ''), 20) END,
       CASE WHEN REPLACE(TRIM(c.valor), ' ', '') REGEXP '^[0-9]{18}$' THEN REPLACE(TRIM(c.valor), ' ', '')
            ELSE NULL END
  FROM (SELECT 1 AS uno) x
  LEFT JOIN configuracion b ON b.clave = 'transferencia_banco'
  LEFT JOIN configuracion t ON t.clave = 'transferencia_titular'
  LEFT JOIN configuracion c ON c.clave = 'transferencia_clabe'
 WHERE NULLIF(TRIM(c.valor), '') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM cuentas_bancarias);

DELETE FROM configuracion
 WHERE clave IN ('transferencia_banco', 'transferencia_titular', 'transferencia_clabe');
