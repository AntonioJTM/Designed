-- =====================================================================
--  Migración · Nómina semanal del personal
--  Semana natural DOMINGO → SÁBADO, pagada ese mismo sábado.
--  La comisión se calcula sobre la VENTA NETA de los pedidos donde el
--  empleado es el vendedor (pedidos.usuario_id): subtotal - descuento,
--  es decir sin IVA y sin costo de envío.
--  Conceptos manuales soportados: horas extra (percepción) y
--  faltas/descuentos (deducción).
-- =====================================================================

-- Configuración de nómina por empleado. Es 1:1 opcional con `usuarios`:
-- solo el staff que aparece aquí entra en la nómina.
CREATE TABLE IF NOT EXISTS nomina_empleados (
    usuario_id          BIGINT UNSIGNED PRIMARY KEY,
    sueldo_base_semanal DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (sueldo_base_semanal >= 0),
    paga_comision       BOOLEAN NOT NULL DEFAULT FALSE,
    porcentaje_comision DECIMAL(5,2)  NOT NULL DEFAULT 0
                          CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100),
    valor_hora_extra    DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (valor_hora_extra >= 0),
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Periodo semanal. `fecha_inicio` es domingo, `fecha_fin` sábado y
-- `fecha_pago` coincide con el sábado del cierre.
CREATE TABLE IF NOT EXISTS nomina_periodos (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fecha_inicio   DATE NOT NULL UNIQUE,
    fecha_fin      DATE NOT NULL,
    fecha_pago     DATE NOT NULL,
    estado         VARCHAR(15) NOT NULL DEFAULT 'borrador'
                     CHECK (estado IN ('borrador','pagado','cancelado')),
    notas          TEXT,
    creado_por     BIGINT UNSIGNED,
    creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creado_por) REFERENCES usuarios(id),
    INDEX idx_nomina_periodos_pago (fecha_pago)
) ENGINE=InnoDB;

-- Recibo de un empleado dentro del periodo. Los montos quedan CONGELADOS
-- al calcular: `ventas_netas` y `porcentaje_comision` se guardan aquí para
-- que el recibo siga siendo auditable aunque cambie la configuración.
CREATE TABLE IF NOT EXISTS nomina_recibos (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    periodo_id          BIGINT UNSIGNED NOT NULL,
    usuario_id          BIGINT UNSIGNED NOT NULL,
    sueldo_base         DECIMAL(12,2) NOT NULL DEFAULT 0,
    num_pedidos         INT UNSIGNED  NOT NULL DEFAULT 0,
    ventas_netas        DECIMAL(12,2) NOT NULL DEFAULT 0,
    porcentaje_comision DECIMAL(5,2)  NOT NULL DEFAULT 0,
    comision            DECIMAL(12,2) NOT NULL DEFAULT 0,
    otras_percepciones  DECIMAL(12,2) NOT NULL DEFAULT 0,
    deducciones         DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_pagar         DECIMAL(12,2) NOT NULL DEFAULT 0,
    notas               TEXT,
    creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE (periodo_id, usuario_id),
    FOREIGN KEY (periodo_id) REFERENCES nomina_periodos(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    INDEX idx_nomina_recibos_usuario (usuario_id)
) ENGINE=InnoDB;

-- Conceptos capturados a mano sobre un recibo. `cantidad` guarda las horas
-- (o los días) cuando aplica; `importe` siempre es positivo y el signo lo
-- determina `tipo`.
CREATE TABLE IF NOT EXISTS nomina_recibo_conceptos (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    recibo_id   BIGINT UNSIGNED NOT NULL,
    tipo        VARCHAR(12) NOT NULL CHECK (tipo IN ('percepcion','deduccion')),
    clave       VARCHAR(20) NOT NULL
                  CHECK (clave IN ('horas_extra','falta','descuento','otro')),
    descripcion VARCHAR(200),
    cantidad    DECIMAL(10,2),
    importe     DECIMAL(12,2) NOT NULL CHECK (importe >= 0),
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recibo_id) REFERENCES nomina_recibos(id) ON DELETE CASCADE,
    INDEX idx_nomina_conceptos_recibo (recibo_id)
) ENGINE=InnoDB;

-- Venta neta por empleado y día. Alimenta el cálculo de comisiones y sirve
-- para auditar de dónde salió la base comisionable de la semana.
CREATE OR REPLACE VIEW v_ventas_por_empleado AS
SELECT  p.usuario_id,
        u.nombre AS usuario,
        DATE(p.creado_en) AS dia,
        COUNT(*) AS num_pedidos,
        COALESCE(SUM(p.subtotal - p.descuento), 0) AS venta_neta,
        COALESCE(SUM(p.total), 0) AS venta_total
FROM pedidos p
JOIN usuarios u ON u.id = p.usuario_id
WHERE p.usuario_id IS NOT NULL
  AND p.estado NOT IN ('cancelado','devuelto')
GROUP BY p.usuario_id, u.nombre, DATE(p.creado_en);
