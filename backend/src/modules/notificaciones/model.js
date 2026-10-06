'use strict';

const { pool } = require('../../config/db');
const analisisModel = require('../analisis/model');

// Cuándo un pendiente empieza a doler. Van aquí, con nombre, para poder
// ajustarlos sin buscarlos dentro de una consulta.
const DIAS_SIN_ABONAR = 30; // debe y no ha movido su cuenta en un mes
const DIAS_SIN_VENIR = 60;  // compraba seguido y lleva dos meses sin aparecer
// Cuánto tiempo un cliente sigue siendo "nuevo" para el aviso. Pasado eso, si
// nadie le autorizó crédito se entiende que es a propósito y el aviso estorba.
const DIAS_CLIENTE_NUEVO = 15;

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

  // Cobranza: quién debe y lleva mucho sin dar señales.
  //
  // Se mide desde el ÚLTIMO MOVIMIENTO de su cuenta, no desde el cargo: quien
  // abonó la semana pasada está pagando, y avisar de él sería mandar a cobrarle
  // a quien no toca. Se listan pocos —los de mayor saldo— porque esto es un
  // aviso, no la pantalla de cobranza.
  const [cobranza] = await pool.query(
    `SELECT c.id AS cliente_id, c.nombre, c.nombre_comercial, c.telefono,
            s.saldo,
            DATEDIFF(NOW(), COALESCE(ult.ultimo_movimiento, c.creado_en)) AS dias_sin_abonar
       FROM v_clientes_saldo s
       JOIN clientes c ON c.id = s.cliente_id
       LEFT JOIN (
         SELECT cliente_id, MAX(creado_en) AS ultimo_movimiento
           FROM credito_movimientos GROUP BY cliente_id
       ) ult ON ult.cliente_id = c.id
      WHERE s.saldo > 0
        AND DATEDIFF(NOW(), COALESCE(ult.ultimo_movimiento, c.creado_en)) >= :dias
      ORDER BY s.saldo DESC
      LIMIT 8`,
    { dias: DIAS_SIN_ABONAR }
  );
  const [[cobranzaTotal]] = await pool.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(s.saldo), 0) AS monto
       FROM v_clientes_saldo s
       JOIN clientes c ON c.id = s.cliente_id
       LEFT JOIN (
         SELECT cliente_id, MAX(creado_en) AS ultimo_movimiento
           FROM credito_movimientos GROUP BY cliente_id
       ) ult ON ult.cliente_id = c.id
      WHERE s.saldo > 0
        AND DATEDIFF(NOW(), COALESCE(ult.ultimo_movimiento, c.creado_en)) >= :dias`,
    { dias: DIAS_SIN_ABONAR }
  );

  // Clientes que compraban y dejaron de venir: 2 compras o más y DIAS_SIN_VENIR
  // sin aparecer. Sale de la MISMA consulta que la pestaña Clientes → Dejaron de
  // venir (analisis/model.js → clientesEnfriados), así el número del aviso y la
  // lista que abre son siempre los mismos (lo pidió el usuario el 2026-10-03:
  // "doy clic y no me dice quiénes"). Aquí solo se traen los primeros 8.
  const frios = await analisisModel.clientesEnfriados({ dias: DIAS_SIN_VENIR, minCompras: 2, limite: 8 });

  // Clientes recién capturados SIN crédito autorizado.
  //
  // Un cliente nuevo nace con límite en cero, así que se le cobra completo —eso
  // es lo correcto: todavía no se sabe si paga—. El aviso existe para que el
  // administrador DECIDA: o le autoriza un límite, o lo deja así a propósito.
  // Sin el aviso, la decisión no se toma nunca y el cajero se topa con un "no
  // tiene crédito" sin saber a quién pedírselo.
  const [nuevosSinCredito] = await pool.query(
    `SELECT c.id AS cliente_id, c.nombre, c.nombre_comercial, c.telefono,
            DATE_FORMAT(c.creado_en, '%Y-%m-%d') AS capturado,
            DATEDIFF(NOW(), c.creado_en) AS dias,
            -- Cuántas veces ya le vendieron: un cliente que va por su tercera
            -- compra y sigue sin crédito es un caso más claro que uno que
            -- acaban de capturar y no ha vuelto.
            (SELECT COUNT(*) FROM pedidos p
              WHERE p.cliente_id = c.id AND p.estado NOT IN ('cancelado', 'devuelto')) AS compras
       FROM clientes c
      WHERE c.activo = 1
        AND c.limite_credito = 0
        AND c.contrasena_hash IS NULL
        AND DATEDIFF(NOW(), c.creado_en) <= :dias
      ORDER BY c.creado_en DESC
      LIMIT 8`,
    { dias: DIAS_CLIENTE_NUEVO }
  );

  // Hilos que no se pueden vender porque no tienen precio. Los crea así la
  // lista completa del proveedor (Surtir inventario): entra la mercancía y el
  // precio se pone después en Productos. El aviso sigue hasta que se le ponga.
  const [sinPrecio] = await pool.query(
    `SELECT p.id AS producto_id, p.nombre, p.grosor_calibre AS calibre,
            (SELECT DATE_FORMAT(MIN(r.creado_en), '%Y-%m-%d %H:%i:%s')
               FROM remesas r JOIN producto_variantes rv ON rv.id = r.variante_id
              WHERE rv.producto_id = p.id) AS llego_en
       FROM productos p
      WHERE p.activo = 1
        AND EXISTS (SELECT 1 FROM producto_variantes pv
                     WHERE pv.producto_id = p.id AND pv.activo = 1
                       AND pv.tipo_presentacion <> 'cono' AND pv.precio <= 0)
      ORDER BY p.nombre, p.grosor_calibre`
  );

  // Apartados ya pagados completos: la mercancía sigue en la bodega y el cliente
  // ya puede llevársela. Es lo más urgente de los apartados.
  const [listos] = await pool.query(
    `SELECT pedido_id, numero_pedido, COALESCE(nombre_comercial, cliente) AS cliente,
            ultimo_abono AS liquidado_en
       FROM v_apartados WHERE pendiente <= 0 ORDER BY ultimo_abono`
  );

  return {
    apartados_listos: { num: listos.length, pedidos: listos },
    traspasos_por_enviar: porEnviar,
    traspasos_por_recibir: porRecibir,
    alertas_stock: Number(stock.n),
    // Hilos sin precio: UN aviso, con los primeros a la vista.
    sin_precio: { num: sinPrecio.length, hilos: sinPrecio.slice(0, 8) },
    // Cobranza atrasada: los pocos de mayor saldo, más el total.
    cobranza: {
      clientes: cobranza,
      num_clientes: Number(cobranzaTotal.n),
      monto: Number(cobranzaTotal.monto),
      dias: DIAS_SIN_ABONAR,
    },
    // Clientes que dejaron de venir.
    enfriados: {
      clientes: frios.clientes,
      num_clientes: frios.num_clientes,
      dias: DIAS_SIN_VENIR,
    },
    // Clientes nuevos a los que hay que decidir si se les fía.
    nuevos_sin_credito: {
      clientes: nuevosSinCredito,
      num_clientes: nuevosSinCredito.length,
      dias: DIAS_CLIENTE_NUEVO,
    },
    // El globo rojo de la campana cuenta PENDIENTES, uno por asunto: los
    // traspasos van uno por uno porque cada uno se atiende aparte, mientras
    // que la cobranza y los enfriados son UN aviso cada cosa —"hay gente que
    // te debe"— aunque dentro haya varios. Contar cada cliente inflaría el
    // globo a decenas y dejaría de significar nada.
    total:
      (listos.length > 0 ? 1 : 0) +
      porEnviar.length +
      porRecibir.length +
      (Number(stock.n) > 0 ? 1 : 0) +
      (sinPrecio.length > 0 ? 1 : 0) +
      (Number(cobranzaTotal.n) > 0 ? 1 : 0) +
      (frios.num_clientes > 0 ? 1 : 0) +
      (nuevosSinCredito.length > 0 ? 1 : 0),
  };
}

module.exports = { pendientes, DIAS_SIN_VENIR };
