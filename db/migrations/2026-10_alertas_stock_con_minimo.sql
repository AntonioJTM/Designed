-- =====================================================================
--  Migración · "Por reabastecer" solo cuenta lo que tiene mínimo capturado
--
--  `stock_minimo = 0` significa "no configurado", no "el mínimo es cero".
--  Inventario y la campana ya lo respetaban (`COND_ALERTA` en
--  inventario/model.js), pero esta vista no: con `disponible <= stock_minimo`
--  a secas, una fila en cero y sin mínimo (0 <= 0) salía como alerta. La
--  usan Reportes → Por reabastecer y la herramienta `por_reabastecer` del
--  asistente, así que los dos listaban hilos agotados que nadie pidió vigilar
--  y contradecían a la campana.
--
--  Solo cambia el filtro: las columnas son las mismas y el backend desplegado
--  sigue funcionando con la vista nueva.
-- =====================================================================

CREATE OR REPLACE VIEW v_alertas_stock AS
SELECT * FROM v_stock_disponible
 WHERE stock_minimo > 0 AND disponible <= stock_minimo;
