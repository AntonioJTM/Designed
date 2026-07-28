'use strict';

const { pool } = require('../../config/db');

/**
 * Lo que está esperando a alguien. Es la campana del panel: si la sucursal de
 * Moroleón pide mercancía, el administrador tiene que enterarse sin andar
 * entrando a la pantalla de traspasos a ver si hay algo.
 *
 * Son cosas VIVAS, no un buzón: se calculan de la base cada vez y desaparecen
 * cuando se atienden. No hay tabla de notificaciones ni "marcar como leída" a
 * propósito — lo que importa es que quede pendiente hasta que se resuelva, y una
 * marca de leída solo taparía el pendiente.
 */
async function pendientes() {
  // Solicitudes esperando que alguien las surta.
  const [porEnviar] = await pool.query(
    `SELECT t.id, t.folio, t.creado_en,
            ao.nombre AS almacen_origen, ad.nombre AS almacen_destino,
            u.nombre AS usuario,
            (SELECT COUNT(*) FROM traspaso_detalle d WHERE d.traspaso_id = t.id) AS num_lineas,
            (SELECT COALESCE(SUM(d.cantidad), 0) FROM traspaso_detalle d
              WHERE d.traspaso_id = t.id) AS kg
       FROM traspasos t
       JOIN almacenes ao    ON ao.id = t.almacen_origen_id
       JOIN almacenes ad    ON ad.id = t.almacen_destino_id
       LEFT JOIN usuarios u ON u.id = t.usuario_id
      WHERE t.estado = 'solicitado'
      ORDER BY t.creado_en`
  );

  // Ya salieron y nadie ha firmado que llegaron.
  const [porRecibir] = await pool.query(
    `SELECT t.id, t.folio, t.enviado_en,
            ao.nombre AS almacen_origen, ad.nombre AS almacen_destino,
            ue.nombre AS enviado_por,
            (SELECT COUNT(*) FROM traspaso_detalle d WHERE d.traspaso_id = t.id) AS num_lineas,
            (SELECT COALESCE(SUM(d.cantidad), 0) FROM traspaso_detalle d
              WHERE d.traspaso_id = t.id) AS kg
       FROM traspasos t
       JOIN almacenes ao     ON ao.id = t.almacen_origen_id
       JOIN almacenes ad     ON ad.id = t.almacen_destino_id
       LEFT JOIN usuarios ue ON ue.id = t.enviado_por
      WHERE t.estado = 'en_transito'
      ORDER BY t.enviado_en`
  );

  // Existencias bajo su mínimo. Solo cuentan las que TIENEN mínimo capturado.
  const [[stock]] = await pool.query(
    `SELECT COUNT(*) AS n FROM inventario i
      WHERE i.stock_minimo > 0 AND (i.cantidad - i.cantidad_reservada) <= i.stock_minimo`
  );

  return {
    traspasos_por_enviar: porEnviar,
    traspasos_por_recibir: porRecibir,
    alertas_stock: Number(stock.n),
    total: porEnviar.length + porRecibir.length + Number(stock.n),
  };
}

module.exports = { pendientes };
