-- =====================================================================
--  Migración · Nómina por días, horario, horas extra y vacaciones (2026-10)
--
--  Lo pidió el usuario el 2026-10-06:
--   · "que pregunte cuántos días de la semana trabaja que se calcule solo en
--     base a su sueldo": el día vale sueldo semanal ÷ días que trabaja, y el
--     recibo paga los días trabajados.
--   · Vacaciones por ley (sin prima), contadas desde la fecha de ingreso,
--     "y esos días se pagan como si fueran normales".
--   · Horas extra calculadas solas contra el horario de CADA empleado, que
--     puede cambiar de un día a otro. Se pagan al DOBLE (decisión del usuario).
--
--  Solo AGREGA tablas y columnas; no cambia ni borra nada. Un recibo viejo
--  queda con las columnas nuevas en NULL / 0 y se sigue leyendo igual.
-- =====================================================================

-- Fecha de ingreso (para la antigüedad y las vacaciones) y los minutos de
-- comida que se restan de cada día para sacar las horas reales de trabajo.
ALTER TABLE nomina_empleados
  ADD COLUMN fecha_ingreso DATE NULL AFTER valor_hora_extra,
  ADD COLUMN comida_min SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER fecha_ingreso;

-- El horario de cada empleado, día por día (0 = domingo … 6 = sábado). Un día
-- sin renglón es su descanso. De aquí salen los días que trabaja, las horas
-- de su semana y el valor de su hora.
CREATE TABLE IF NOT EXISTS nomina_horarios (
    usuario_id   BIGINT UNSIGNED NOT NULL,
    dia_semana   TINYINT UNSIGNED NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
    hora_entrada TIME NOT NULL,
    hora_salida  TIME NOT NULL,
    PRIMARY KEY (usuario_id, dia_semana),
    CONSTRAINT nomina_horarios_salida CHECK (hora_salida > hora_entrada),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Vacaciones tomadas, por rango de fechas. `dias` son los días de TRABAJO que
-- caen en el rango según su horario (sus descansos no cuentan), congelados al
-- registrarlas.
CREATE TABLE IF NOT EXISTS nomina_vacaciones (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id   BIGINT UNSIGNED NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin    DATE NOT NULL,
    dias         DECIMAL(4,1) NOT NULL CHECK (dias > 0),
    notas        VARCHAR(255) NULL,
    creado_por   BIGINT UNSIGNED NULL,
    creado_en    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT nomina_vacaciones_rango CHECK (fecha_fin >= fecha_inicio),
    KEY idx_nomina_vacaciones_usuario (usuario_id, fecha_inicio),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- El recibo congela con qué se calculó: días de su horario, días trabajados,
-- días de vacaciones, lo que valía su día y su hora, y lo pagado por
-- vacaciones. En NULL = recibo calculado sin horario (sueldo semanal completo).
ALTER TABLE nomina_recibos
  ADD COLUMN dias_laborales  DECIMAL(3,1) NULL AFTER sueldo_base,
  ADD COLUMN dias_trabajados DECIMAL(3,1) NULL AFTER dias_laborales,
  ADD COLUMN dias_vacaciones DECIMAL(3,1) NOT NULL DEFAULT 0 AFTER dias_trabajados,
  ADD COLUMN salario_diario  DECIMAL(12,2) NULL AFTER dias_vacaciones,
  ADD COLUMN valor_hora      DECIMAL(12,2) NULL AFTER salario_diario,
  ADD COLUMN pago_vacaciones DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER valor_hora;

-- Las horas extra dicen de qué día son y a qué hora entró o salió de verdad.
ALTER TABLE nomina_recibo_conceptos
  ADD COLUMN fecha        DATE NULL AFTER cantidad,
  ADD COLUMN hora_entrada TIME NULL AFTER fecha,
  ADD COLUMN hora_salida  TIME NULL AFTER hora_entrada;
