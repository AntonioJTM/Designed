-- =============================================================================
-- 2026-10-14 · Datos fiscales y leyenda del TICKET
-- -----------------------------------------------------------------------------
-- "El ticket tiene que llevar la información de la constancia fiscal" (usuario).
-- El encabezado del ticket lleva razón social, RFC, régimen y domicilio fiscal,
-- y al pie una leyenda. Van en `configuracion` (Admin -> Configuración, grupos
-- "Datos fiscales" y "Ticket"), no en el código: el repositorio es PÚBLICO.
--
-- Las claves nacen VACÍAS: los datos reales se capturan en la pantalla (o con
-- un UPDATE directo en cada base), nunca en este archivo. Solo la leyenda trae
-- un valor genérico. Son públicas (`publica = 1`) porque las lee el ticket con
-- la misma consulta del resto de los datos de la tienda, y es lo que se le
-- entrega impreso a cada cliente.
--
-- Idempotente: volver a correrla no pisa lo capturado.
-- =============================================================================

INSERT INTO configuracion (clave, valor, descripcion, publica) VALUES
 ('fiscal_razon_social', NULL, 'Razón social, como viene en la Constancia de Situación Fiscal. Va arriba del ticket.', 1),
 ('fiscal_rfc', NULL, 'RFC de la empresa. Va arriba del ticket.', 1),
 ('fiscal_regimen', NULL, 'Régimen fiscal (clave y nombre). Va arriba del ticket.', 1),
 ('fiscal_domicilio', NULL, 'Domicilio fiscal completo. Va arriba del ticket.', 1),
 ('ticket_leyenda', 'Este ticket no es un comprobante fiscal.', 'Lo que va al pie de cada ticket.', 1)
ON DUPLICATE KEY UPDATE clave = clave;
