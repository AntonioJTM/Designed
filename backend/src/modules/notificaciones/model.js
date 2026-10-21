'use strict';

const { pool } = require('../../config/db');
const analisisModel = require('../analisis/model');
const { filtroAlmacen } = require('../permisos/service');
const whatsapp = require('../whatsapp/conexion');

// Cuándo un pendiente empieza a doler. Van aquí, con nombre, para poder
// ajustarlos sin buscarlos dentro de una consulta.
// Los días de crédito de una nota que no los dijo (las de antes del 2026-10-20,
// cuando cada venta a crédito empezó a llevar los suyos): con 15, una cuenta está
// atrasada cuando su nota pasó 15 días sin pagarse, como antes. La campana, la
// caja, Cuánto debe y Cómo va el negocio miden el vencimiento de CADA nota.
const DIAS_SIN_ABONAR = 15;
const DIAS_SIN_VENIR = 60;  // compraba seguido y lleva dos meses sin aparecer
// Cuánto tiempo un cliente sigue siendo "nuevo" para el aviso. Pasado eso, si
// nadie le autorizó crédito se entiende que es a propósito y el aviso estorba.
const DIAS_CLIENTE_NUEVO = 15;
// Un turno de caja abierto desde hace 2 días o más sin su corte (2026-10-20,
// auditoría: en hitex dos llevaban 5 días). El corte es diario: el dinero de
// varios días junto ya no se puede cuadrar.
const DIAS_TURNO_ABIERTO = 2;

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
async function pendientes(almacenes = null) {
  // CADA QUIEN, SUS TIENDAS (2026-10-15): surte quien es del origen, firma de
  // recibido quien es del destino, y los mínimos y las notas son de su tienda.
  // La cobranza y los que dejaron de venir llevan a miradas de Clientes que
  // solo ve quien ve todas las tiendas: a los demás no se les avisa.
  const todas = almacenes === null;
  const fo = filtroAlmacen('t.almacen_origen_id', almacenes);
  const fd = filtroAlmacen('t.almacen_destino_id', almacenes);
  const fi = filtroAlmacen('i.almacen_id', almacenes);
  const fp = filtroAlmacen('p.almacen_id', almacenes);

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
      WHERE t.estado = 'solicitado'${fo.sql}
      ORDER BY t.creado_en`,
    fo.params
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
      WHERE t.estado = 'en_transito'${fd.sql}
      ORDER BY t.enviado_en`,
    fd.params
  );

  // Turnos de caja abiertos de varios días, de SUS tiendas.
  const ft = filtroAlmacen('c.almacen_id', almacenes);
  const [turnosViejos] = await pool.query(
    `SELECT s.id, s.caja_id, c.nombre AS caja, a.nombre AS almacen, u.nombre AS usuario,
            DATE_FORMAT(s.fecha_apertura, '%Y-%m-%d %H:%i:%s') AS desde,
            DATEDIFF(CURDATE(), DATE(s.fecha_apertura)) AS dias
       FROM sesiones_caja s
       JOIN cajas c          ON c.id = s.caja_id
       JOIN almacenes a      ON a.id = c.almacen_id
       LEFT JOIN usuarios u  ON u.id = s.usuario_id
      WHERE s.estado = 'abierta' AND DATEDIFF(CURDATE(), DATE(s.fecha_apertura)) >= :diasTurno${ft.sql}
      ORDER BY s.fecha_apertura`,
    { diasTurno: DIAS_TURNO_ABIERTO, ...ft.params }
  );

  // Existencias bajo su mínimo. Solo cuentan las que TIENEN mínimo capturado.
  const [[stock]] = await pool.query(
    `SELECT COUNT(*) AS n FROM inventario i
      WHERE i.stock_minimo > 0 AND (i.cantidad - i.cantidad_reservada) <= i.stock_minimo${fi.sql}`,
    fi.params
  );

  // Cobranza: quién debe una nota que lleva mucho sin pagarse.
  //
  // Se mide desde su NOTA MÁS VIEJA sin pagar (2026-10-20; antes, desde el último
  // abono, y un abono chiquito lo "renovaba"). Se listan pocos —los de mayor saldo— porque esto es un aviso, no la
  // pantalla de cobranza. Sale de la MISMA cartera que Cuánto debe y Cómo va el negocio (2026-10-17):
  // los mismos días y el mismo plazo que la caja, así el aviso y la lista nunca
  // se contradicen.
  //
  // Desde el 2026-10-20 son las NOTAS A CRÉDITO VENCIDAS: cada una pasó sus días de
  // crédito sin pagarse ("después de los días, si no paga, una notificación"). Un
  // aviso con TODAS contadas y las 8 más vencidas a la vista.
  const atrasados = !todas ? [] : (await analisisModel.cartera()).clientes.filter((r) => r.notas_vencidas > 0);
  let notasVencidas = [];
  if (atrasados.length) {
    const { diasSinAbonarDeTodos } = require('../clientes/model');
    const porCliente = await diasSinAbonarDeTodos();
    notasVencidas = atrasados.flatMap((r) => (porCliente.get(Number(r.cliente_id))?.vencidas ?? []).map((n) => ({
      cliente_id: r.cliente_id, nombre: r.nombre, nombre_comercial: r.nombre_comercial, telefono: r.telefono,
      // Sin venta = un ajuste que subió su deuda (Corregir deuda): no es una nota.
      pedido_id: n.pedidoId ?? null, folio: n.folio ?? null, ajuste: n.pedidoId == null,
      clave: `${r.cliente_id}-${n.pedidoId ?? 'aj-' + n.dia}`,
      dias_credito: n.plazo, vence_el: n.venceEl, dias_vencida: n.diasVencida, por_pagar: n.porPagar,
    }))).sort((a, b) => b.dias_vencida - a.dias_vencida || b.por_pagar - a.por_pagar);
  }
  const cobranza = notasVencidas.slice(0, 8);
  const cobranzaTotal = {
    n: atrasados.length,
    monto: Math.round(notasVencidas.reduce((s, n) => s + n.por_pagar, 0) * 100) / 100,
  };

  // Clientes que compraban y dejaron de venir: 2 compras o más y DIAS_SIN_VENIR
  // sin aparecer. Sale de la MISMA consulta que la pestaña Clientes → Dejaron de
  // venir (analisis/model.js → clientesEnfriados), así el número del aviso y la
  // lista que abre son siempre los mismos (lo pidió el usuario el 2026-10-03:
  // "doy clic y no me dice quiénes"). Aquí solo se traen los primeros 8.
  const frios = !todas
    ? { clientes: [], num_clientes: 0 }
    : await analisisModel.clientesEnfriados({ dias: DIAS_SIN_VENIR, minCompras: 2, limite: 8 });

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
              WHERE p.cliente_id = c.id AND p.estado NOT IN ('cancelado', 'devuelto')${fp.sql}) AS compras
       FROM clientes c
      WHERE c.activo = 1
        AND c.limite_credito = 0
        AND c.contrasena_hash IS NULL
        AND DATEDIFF(NOW(), c.creado_en) <= :dias
      ORDER BY c.creado_en DESC`,
    { dias: DIAS_CLIENTE_NUEVO, ...fp.params }
  );
  // Cuántos son TODOS; la lista se recorta (2026-10-20: con 12 decía "8").
  const numNuevosSinCredito = nuevosSinCredito.length;
  nuevosSinCredito.splice(8);

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

  // Notas pendientes de pago (2026-10-13): lo que se llevaron sin pagar y
  // todavía se debe. UN aviso, con cuánto es y cuántos clientes.
  const [[notas]] = await pool.query(
    `SELECT COUNT(*) AS num, COUNT(DISTINCT p.cliente_id) AS clientes,
            COALESCE(SUM(p.total - COALESCE((SELECT SUM(pg.monto) FROM pagos pg
                                              WHERE pg.pedido_id = p.id AND pg.estado = 'completado'), 0)), 0) AS monto,
            DATE_FORMAT(MIN(p.creado_en), '%Y-%m-%d %H:%i:%s') AS desde
       FROM pedidos p
      WHERE p.nota_pendiente = 1 AND p.estado = 'pendiente'${fp.sql}
        AND NOT EXISTS (SELECT 1 FROM credito_movimientos cm WHERE cm.pedido_id = p.id AND cm.tipo = 'cargo')`,
    fp.params
  );

  // El WhatsApp de la tienda se desconectó (2026-10-16): lo ve quien entra a Configuración.
  const avisoWhatsapp = whatsapp.avisoCampana();

  return {
    whatsapp: avisoWhatsapp,
    notas_pendientes: {
      num: Number(notas.num),
      num_clientes: Number(notas.clientes),
      monto: Math.round(Number(notas.monto) * 100) / 100,
      desde: notas.desde,
    },
    traspasos_por_enviar: porEnviar,
    traspasos_por_recibir: porRecibir,
    alertas_stock: Number(stock.n),
    // Hilos sin precio: UN aviso, con los primeros a la vista.
    sin_precio: { num: sinPrecio.length, hilos: sinPrecio.slice(0, 8) },
    // Cobranza atrasada: los pocos de mayor saldo, más el total.
    // Las notas a crédito vencidas (2026-10-20): las 8 más vencidas, y el total.
    cobranza: {
      notas: cobranza,
      num_notas: notasVencidas.length,
      num_clientes: Number(cobranzaTotal.n),
      monto: Number(cobranzaTotal.monto),
    },
    // Clientes que dejaron de venir.
    enfriados: {
      clientes: frios.clientes,
      num_clientes: frios.num_clientes,
      dias: DIAS_SIN_VENIR,
    },
    // Turnos de caja abiertos de varios días sin su corte (2026-10-20).
    turnos_abiertos: {
      turnos: turnosViejos.map((t) => ({ ...t, dias: Number(t.dias) })),
      num: turnosViejos.length,
      dias: DIAS_TURNO_ABIERTO,
    },
    // Clientes nuevos a los que hay que decidir si se les fía.
    nuevos_sin_credito: {
      clientes: nuevosSinCredito,
      num_clientes: numNuevosSinCredito,
      dias: DIAS_CLIENTE_NUEVO,
    },
    // El globo rojo de la campana cuenta PENDIENTES, uno por asunto: los
    // traspasos van uno por uno porque cada uno se atiende aparte, mientras
    // que la cobranza y los enfriados son UN aviso cada cosa —"hay gente que
    // te debe"— aunque dentro haya varios. Contar cada cliente inflaría el
    // globo a decenas y dejaría de significar nada.
    total:
      (avisoWhatsapp ? 1 : 0) +
      (turnosViejos.length > 0 ? 1 : 0) +
      (Number(notas.num) > 0 ? 1 : 0) +
      porEnviar.length +
      porRecibir.length +
      (Number(stock.n) > 0 ? 1 : 0) +
      (sinPrecio.length > 0 ? 1 : 0) +
      (Number(cobranzaTotal.n) > 0 ? 1 : 0) +
      (frios.num_clientes > 0 ? 1 : 0) +
      (nuevosSinCredito.length > 0 ? 1 : 0),
  };
}

module.exports = { pendientes, DIAS_SIN_VENIR, DIAS_SIN_ABONAR };
