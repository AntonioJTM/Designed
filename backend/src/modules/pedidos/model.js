'use strict';

const crypto = require('crypto');
const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const almacenesModel = require('../almacenes/model');
const { hoyLocal } = require('../../utils/fechas');

// Ventas/pedidos unificados (online + POS). La confirmación de venta ocurre en
// UNA transacción: pedidos + pedido_detalle + pagos + descuento de inventario +
// movimientos_inventario (salida) + (si POS) movimientos_caja (venta).

const ESTADOS = ['pendiente', 'pagado', 'en_preparacion', 'enviado', 'entregado', 'cancelado', 'devuelto'];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Las cantidades son DECIMAL(12,3): hasta el gramo.
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

function generarNumero(canal) {
  const pref = canal === 'punto_venta' ? 'POS' : 'WEB';
  return `${pref}-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

/** Calcula el descuento de un cupón válido sobre el subtotal (o lanza). */
async function _resolverCupon(conn, codigo, subtotal) {
  const [rows] = await conn.query(
    'SELECT * FROM cupones WHERE codigo = :codigo AND activo = 1 FOR UPDATE',
    { codigo }
  );
  const cupon = rows[0];
  if (!cupon) throw new AppError(422, 'CUPON_INVALIDO', 'El cupón no existe o está inactivo');

  const hoy = hoyLocal();
  if (cupon.fecha_inicio && hoy < String(cupon.fecha_inicio).slice(0, 10)) {
    throw new AppError(422, 'CUPON_NO_VIGENTE', 'El cupón aún no es vigente');
  }
  if (cupon.fecha_fin && hoy > String(cupon.fecha_fin).slice(0, 10)) {
    throw new AppError(422, 'CUPON_EXPIRADO', 'El cupón ya expiró');
  }
  if (cupon.usos_maximos != null && cupon.usos_actuales >= cupon.usos_maximos) {
    throw new AppError(422, 'CUPON_AGOTADO', 'El cupón alcanzó su límite de usos');
  }
  if (subtotal < Number(cupon.compra_minima)) {
    throw new AppError(422, 'CUPON_COMPRA_MINIMA',
      `Requiere una compra mínima de ${cupon.compra_minima}`);
  }

  const descuento =
    cupon.tipo === 'porcentaje'
      ? round2((subtotal * Number(cupon.valor)) / 100)
      : Math.min(round2(cupon.valor), subtotal);
  return { cupon, descuento };
}

async function crearPedido(datos, usuarioId) {
  return withTransaction(async (conn) => {
    const esPOS = datos.canal === 'punto_venta';

    // 1. Resolver almacén y sesión de caja (POS).
    let almacenId = datos.almacen_id ?? null;
    let sesionCajaId = null;
    if (esPOS) {
      if (!datos.sesion_caja_id) {
        throw new AppError(422, 'FALTA_SESION_CAJA', 'Una venta POS requiere sesion_caja_id');
      }
      const [srows] = await conn.query(
        `SELECT s.id, s.estado, c.almacen_id
           FROM sesiones_caja s JOIN cajas c ON c.id = s.caja_id
          WHERE s.id = :id FOR UPDATE`,
        { id: datos.sesion_caja_id }
      );
      const sesion = srows[0];
      if (!sesion) throw new AppError(404, 'SESION_NO_ENCONTRADA', 'Sesión de caja no encontrada');
      if (sesion.estado !== 'abierta') {
        throw new AppError(409, 'SESION_CERRADA', 'La sesión de caja está cerrada');
      }
      sesionCajaId = sesion.id;
      almacenId = almacenId ?? sesion.almacen_id;
    } else if (!almacenId) {
      // Online sin almacén explícito: el marcado como `es_tienda_linea`.
      almacenId = await almacenesModel.idTiendaLinea(conn);
    }
    if (!almacenId) {
      throw new AppError(422, 'FALTA_ALMACEN', 'Se requiere almacen_id para descontar inventario');
    }

    // 2. Lista de precios con la que se cobra. Sin tipo explícito se usa el
    // público, que es `producto_variantes.precio`.
    let tipoClienteId = datos.tipo_cliente_id ?? null;
    if (tipoClienteId) {
      const [trows] = await conn.query(
        'SELECT id, activo FROM tipos_cliente WHERE id = :id',
        { id: tipoClienteId }
      );
      if (!trows[0]) {
        throw new AppError(422, 'TIPO_CLIENTE_INVALIDO', 'El tipo de cliente no existe');
      }
      if (!trows[0].activo) {
        throw new AppError(422, 'TIPO_CLIENTE_INACTIVO', 'Ese tipo de cliente está inactivo');
      }
    } else {
      const [prows] = await conn.query('SELECT id FROM tipos_cliente WHERE es_publico = 1 LIMIT 1');
      tipoClienteId = prows[0]?.id ?? null;
    }

    // 3. Construir el detalle con precios e impuestos calculados en el backend.
    const detalle = [];
    let subtotal = 0;
    let impuestos = 0;

    for (const item of datos.items) {
      // `precio_tipo` es el precio propio del tipo de cliente, si lo tiene
      // capturado; si no, se cobra el público (pv.precio).
      const [vrows] = await conn.query(
        `SELECT pv.id, pv.precio, pv.precio_oferta, pv.presentacion, pv.activo,
                p.nombre AS producto, imp.porcentaje AS imp_pct,
                (SELECT vp.precio FROM variante_precios vp
                  WHERE vp.variante_id = pv.id AND vp.tipo_cliente_id = :tipo_cliente) AS precio_tipo
           FROM producto_variantes pv
           JOIN productos p        ON p.id = pv.producto_id
           LEFT JOIN impuestos imp ON imp.id = p.impuesto_id
          WHERE pv.id = :id`,
        { id: item.variante_id, tipo_cliente: tipoClienteId ?? 0 }
      );
      const v = vrows[0];
      if (!v) throw new AppError(422, 'VARIANTE_INVALIDA', `Variante ${item.variante_id} no existe`);
      if (!v.activo) throw new AppError(422, 'VARIANTE_INACTIVA', `La variante ${item.variante_id} está inactiva`);

      // Bloquea existencias y valida disponibilidad.
      const [irows] = await conn.query(
        `SELECT id, cantidad FROM inventario
          WHERE variante_id = :v AND almacen_id = :a FOR UPDATE`,
        { v: item.variante_id, a: almacenId }
      );
      const existente = irows[0] ? Number(irows[0].cantidad) : 0;
      if (existente < item.cantidad) {
        // Mensaje en términos del producto, no del id interno: lo lee el cliente.
        const nombre = `${v.producto}${v.presentacion ? ' · ' + v.presentacion : ''}`;
        throw new AppError(
          409,
          'STOCK_INSUFICIENTE',
          existente === 0
            ? `"${nombre}" está agotado.`
            : `Solo quedan ${existente} de "${nombre}" y pediste ${item.cantidad}.`
        );
      }

      // Orden de prelación: precio del tipo de cliente > oferta > público.
      const precioUnit =
        v.precio_tipo != null
          ? Number(v.precio_tipo)
          : v.precio_oferta != null
            ? Number(v.precio_oferta)
            : Number(v.precio);
      const descLinea = round2(item.descuento ?? 0);
      const base = round2(precioUnit * item.cantidad);
      const subLinea = round2(base - descLinea);
      const impPct = v.imp_pct != null ? Number(v.imp_pct) : 0;
      const impLinea = round2((subLinea * impPct) / 100);

      subtotal = round2(subtotal + subLinea);
      impuestos = round2(impuestos + impLinea);

      detalle.push({
        variante_id: item.variante_id,
        descripcion: `${v.producto}${v.presentacion ? ' · ' + v.presentacion : ''}`,
        cantidad: item.cantidad,
        precio_unitario: precioUnit,
        descuento: descLinea,
        impuesto: impLinea,
        subtotal: subLinea,
        // Bultos escaneados que formaron la cantidad. No entran a la tabla de
        // detalle: se guardan aparte, ligados a la línea (paso 6).
        bultos: item.bultos ?? [],
      });
    }

    // 3. Cupón (opcional) y totales.
    let cuponId = null;
    let descuento = 0;
    if (datos.cupon_codigo) {
      const r = await _resolverCupon(conn, datos.cupon_codigo, subtotal);
      cuponId = r.cupon.id;
      descuento = r.descuento;
    }
    const costoEnvio = round2(datos.costo_envio ?? 0);
    const total = round2(subtotal - descuento + impuestos + costoEnvio);
    if (total < 0) throw new AppError(422, 'TOTAL_NEGATIVO', 'El total no puede ser negativo');

    // 4. Validar pagos y determinar estado.
    const pagos = datos.pagos ?? [];
    const pagado = round2(pagos.reduce((s, p) => s + Number(p.monto), 0));
    let estado = 'pendiente';
    if (esPOS) {
      if (pagado + 0.0001 < total) {
        throw new AppError(409, 'PAGO_INSUFICIENTE', `El pago (${pagado}) no cubre el total (${total})`);
      }
      estado = 'pagado';
    } else if (pagos.length && pagado + 0.0001 >= total) {
      estado = 'pagado';
    }

    // 5. Insertar pedido.
    const numero = generarNumero(datos.canal);
    const [pr] = await conn.query(
      `INSERT INTO pedidos
         (numero_pedido, canal, cliente_id, tipo_cliente_id, usuario_id, sesion_caja_id, almacen_id,
          direccion_envio_id, cupon_id, estado, subtotal, descuento, impuestos, costo_envio, total, notas)
       VALUES
         (:numero, :canal, :cliente_id, :tipo_cliente_id, :usuario_id, :sesion_caja_id, :almacen_id,
          :direccion_envio_id, :cupon_id, :estado, :subtotal, :descuento, :impuestos, :costo_envio, :total, :notas)`,
      {
        numero,
        canal: datos.canal,
        cliente_id: datos.cliente_id ?? null,
        tipo_cliente_id: tipoClienteId,
        usuario_id: usuarioId ?? null,
        sesion_caja_id: sesionCajaId,
        almacen_id: almacenId,
        direccion_envio_id: datos.direccion_envio_id ?? null,
        cupon_id: cuponId,
        estado,
        subtotal,
        descuento,
        impuestos,
        costo_envio: costoEnvio,
        total,
        notas: datos.notas ?? null,
      }
    );
    const pedidoId = pr.insertId;

    // 6. Detalle, y el rastro de qué bultos formó cada línea.
    for (const { bultos, ...d } of detalle) {
      const [dr] = await conn.query(
        `INSERT INTO pedido_detalle
           (pedido_id, variante_id, descripcion, cantidad, precio_unitario, descuento, impuesto, subtotal)
         VALUES (:pedido_id, :variante_id, :descripcion, :cantidad, :precio_unitario, :descuento, :impuesto, :subtotal)`,
        { pedido_id: pedidoId, ...d }
      );

      for (const b of bultos) {
        // El bulto se bloquea para que dos cajas no puedan venderlo a la vez.
        const [brows] = await conn.query(
          'SELECT id, lote, estado FROM variante_codigos WHERE codigo = :c LIMIT 1 FOR UPDATE',
          { c: b.codigo }
        );
        const bulto = brows[0];

        // Un bulto es una pieza física única: si ya salió, no se vuelve a vender.
        // Al lanzar aquí se revierte la venta completa, que es lo correcto: no
        // hay media venta.
        if (bulto && bulto.estado !== 'disponible') {
          throw new AppError(409, 'BULTO_NO_DISPONIBLE',
            `El bulto ${b.codigo} ya está ${bulto.estado}; no se puede vender otra vez.`);
        }

        // El código y el peso se CONGELAN aquí: si mañana se borra el bulto, el
        // pedido sigue diciendo qué se entregó. `variante_codigo_id` es la
        // referencia viva y queda en NULL si eso pasa.
        await conn.query(
          `INSERT INTO pedido_detalle_bultos
             (detalle_id, variante_codigo_id, codigo, peso_kg, lote)
           VALUES (:detalle, :codigo_id, :codigo, :peso, :lote)`,
          {
            detalle: dr.insertId,
            codigo_id: bulto?.id ?? null,
            codigo: b.codigo,
            peso: b.peso_kg,
            lote: b.lote ?? bulto?.lote ?? null,
          }
        );

        if (bulto) {
          // Se marca vendido y se corrige su ubicación al almacén donde se
          // escaneó. El traspaso asigna los bultos por FIFO, pero quien surte se
          // lleva los que tiene a mano, así que la ubicación registrada puede no
          // ser la real: el escaneo en el mostrador es el dato bueno y manda.
          // NO se valida que el bulto "estuviera" aquí: eso bloquearía ventas
          // legítimas por un detalle de registro que la tienda no lleva.
          await conn.query(
            `UPDATE variante_codigos
                SET estado = 'vendido', consumido_en = NOW(),
                    consumido_tipo = 'pedido', consumido_id = :pedido,
                    almacen_id = :almacen
              WHERE id = :id`,
            { pedido: pedidoId, id: bulto.id, almacen: almacenId }
          );
        }
      }
    }

    // 7. Pagos. Se acumula lo pagado con métodos NO-efectivo (tarjeta, etc.)
    //    para deducir el efectivo neto que queda en la caja.
    let noEfectivo = 0;
    if (pagos.length) {
      const ids = pagos.map((p) => p.metodo_pago_id);
      const [mrows] = await conn.query('SELECT id, nombre FROM metodos_pago WHERE id IN (:ids)', { ids });
      const nombrePorId = Object.fromEntries(mrows.map((m) => [m.id, m.nombre]));
      for (const p of pagos) {
        await conn.query(
          `INSERT INTO pagos (pedido_id, metodo_pago_id, monto, estado, referencia_transaccion)
           VALUES (:pedido_id, :metodo_pago_id, :monto, 'completado', :ref)`,
          { pedido_id: pedidoId, metodo_pago_id: p.metodo_pago_id, monto: p.monto, ref: p.referencia_transaccion ?? null }
        );
        if (!(nombrePorId[p.metodo_pago_id] || '').toLowerCase().includes('efectivo')) {
          noEfectivo = round2(noEfectivo + Number(p.monto));
        }
      }
    }
    // Efectivo que ingresa a la caja = total menos lo cubierto con tarjeta/otros
    // (el cambio entregado no forma parte del ingreso neto).
    const efectivo = round2(Math.max(0, total - noEfectivo));

    // 8. Descontar inventario + bitácora (salida) por cada línea.
    for (const d of detalle) {
      await conn.query(
        `INSERT INTO inventario (variante_id, almacen_id, cantidad)
           VALUES (:v, :a, 0)
         ON DUPLICATE KEY UPDATE cantidad = cantidad - :cant`,
        { v: d.variante_id, a: almacenId, cant: d.cantidad }
      );
      await conn.query(
        `INSERT INTO movimientos_inventario
           (variante_id, almacen_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id, motivo)
         VALUES (:v, :a, 'salida', :cant, 'pedido', :pedido, :usuario, :motivo)`,
        {
          v: d.variante_id,
          a: almacenId,
          cant: -d.cantidad,
          pedido: pedidoId,
          usuario: usuarioId ?? null,
          motivo: `Venta ${numero}`,
        }
      );
    }

    // 9. Movimiento de caja (solo POS y solo la parte en efectivo).
    if (esPOS && efectivo > 0) {
      await conn.query(
        `INSERT INTO movimientos_caja (sesion_caja_id, tipo, monto, referencia_id, motivo)
         VALUES (:sesion, 'venta', :monto, :pedido, :motivo)`,
        { sesion: sesionCajaId, monto: efectivo, pedido: pedidoId, motivo: `Venta ${numero}` }
      );
    }

    // 10. Consumir un uso del cupón.
    if (cuponId) {
      await conn.query('UPDATE cupones SET usos_actuales = usos_actuales + 1 WHERE id = :id', { id: cuponId });
    }

    return _obtenerConn(conn, pedidoId);
  });
}

/** Detalle completo del pedido (usa la conexión dada o el pool). */
async function _obtenerConn(ejecutor, id) {
  const [prows] = await ejecutor.query(
    `SELECT p.*, c.nombre AS cliente, u.nombre AS usuario, a.nombre AS almacen
       FROM pedidos p
       LEFT JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN usuarios u ON u.id = p.usuario_id
       LEFT JOIN almacenes a ON a.id = p.almacen_id
      WHERE p.id = :id LIMIT 1`,
    { id }
  );
  const pedido = prows[0];
  if (!pedido) return null;

  const [det] = await ejecutor.query(
    `SELECT d.*, pv.sku FROM pedido_detalle d
       JOIN producto_variantes pv ON pv.id = d.variante_id
      WHERE d.pedido_id = :id ORDER BY d.id`,
    { id }
  );

  // En qué otras presentaciones puede regresar cada línea, con la cantidad ya
  // calculada. Va aquí para que la pantalla de devolución solo pinte opciones y
  // no haga aritmética de inventario.
  for (const d of det) {
    d.alternativas_devolucion = await _alternativasDeDevolucion(
      ejecutor,
      d.variante_id,
      d.cantidad
    );
  }

  // Qué bultos formaron cada línea: es lo que permite responder de qué lote era
  // el hilo que se le entregó a este cliente.
  if (det.length) {
    const [bultos] = await ejecutor.query(
      `SELECT b.detalle_id, b.codigo, b.peso_kg, b.lote
         FROM pedido_detalle_bultos b
        WHERE b.detalle_id IN (:ids)
        ORDER BY b.lote, b.id`,
      { ids: det.map((d) => d.id) }
    );
    for (const d of det) {
      d.bultos = bultos.filter((b) => b.detalle_id === d.id);
    }
  }
  const [pagos] = await ejecutor.query(
    `SELECT pg.id, pg.metodo_pago_id, mp.nombre AS metodo, pg.monto, pg.estado, pg.referencia_transaccion, pg.creado_en
       FROM pagos pg JOIN metodos_pago mp ON mp.id = pg.metodo_pago_id
      WHERE pg.pedido_id = :id ORDER BY pg.id`,
    { id }
  );
  pedido.detalle = det;
  pedido.pagos = pagos;
  return pedido;
}

async function obtener(id) {
  return _obtenerConn(pool, id);
}

async function listar({ canal, estado, cliente_id, limit, offset }) {
  const where = [];
  const params = {};
  if (canal) { where.push('p.canal = :canal'); params.canal = canal; }
  if (estado) { where.push('p.estado = :estado'); params.estado = estado; }
  if (cliente_id !== undefined) { where.push('p.cliente_id = :cliente_id'); params.cliente_id = cliente_id; }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT p.id, p.numero_pedido, p.canal, p.estado, p.total, p.creado_en,
            c.nombre AS cliente, u.nombre AS usuario
       FROM pedidos p
       LEFT JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN usuarios u ON u.id = p.usuario_id
       ${whereSql}
      ORDER BY p.creado_en DESC, p.id DESC
      LIMIT :limit OFFSET :offset`,
    { ...params, limit, offset }
  );
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM pedidos p ${whereSql}`, params);
  return { rows, total };
}

/** Un pedido cancelado o devuelto ya no retiene la mercancía ni el dinero. */
const INACTIVOS = ['cancelado', 'devuelto'];

/**
 * Efectivo que la caja recibió por este pedido. Solo cuenta los pagos en
 * efectivo: lo pagado con tarjeta se reembolsa por el banco, no por el cajón.
 * Mismo criterio que al vender (el nombre del método contiene "efectivo").
 *
 * `estadoPago` importa por la dirección del movimiento: al cancelar se buscan
 * los pagos cobrados ('completado') y al reactivar los que se habían devuelto
 * ('reembolsado'), porque ese es el estado en que quedaron.
 */
async function _efectivoDelPedido(conn, pedidoId, estadoPago) {
  const [rows] = await conn.query(
    `SELECT COALESCE(SUM(pg.monto), 0) AS total
       FROM pagos pg
       JOIN metodos_pago mp ON mp.id = pg.metodo_pago_id
      WHERE pg.pedido_id = :id
        AND pg.estado = :estado
        AND LOWER(mp.nombre) LIKE '%efectivo%'`,
    { id: pedidoId, estado: estadoPago }
  );
  return round2(Number(rows[0].total));
}

/**
 * En qué OTRAS presentaciones puede regresar lo que se vendió.
 *
 * El caso real: se entrega un paquete y el cliente devuelve los conos, porque ya
 * lo desarmó. Como paquete y cono se llevan los DOS en kilos —es el mismo hilo,
 * solo enconado— la equivalencia es 1:1: los kilos que salieron son los kilos que
 * vuelven, solo cambia en qué presentación entran.
 *
 * La cantidad sigue siendo editable: si el cono ganó peso por el destare, o si
 * regresa menos de lo que se llevó, se ajusta al confirmar.
 */
async function _alternativasDeDevolucion(conn, varianteId, cantidad) {
  const [vrows] = await conn.query(
    `SELECT pv.id, pv.sku, pv.presentacion, pv.tipo_presentacion, pv.peso_kg,
            pv.origen_variante_id, pv.piezas_por_origen, pv.producto_id
       FROM producto_variantes pv WHERE pv.id = :id`,
    { id: varianteId }
  );
  const v = vrows[0];
  if (!v) return [];

  const cant = Number(cantidad);
  const alternativas = [];

  if (v.tipo_presentacion === 'paquete') {
    // Se vendió el paquete: puede volver como cualquiera de sus conos.
    const [conos] = await conn.query(
      `SELECT id, sku, presentacion, piezas_por_origen FROM producto_variantes
        WHERE origen_variante_id = :id AND tipo_presentacion = 'cono' AND activo = 1`,
      { id: v.id }
    );
    for (const c of conos) {
      alternativas.push({
        variante_id: c.id,
        sku: c.sku,
        presentacion: c.presentacion,
        unidad: 'kg',
        // Mismo hilo, mismos kilos.
        cantidad_equivalente: round3(cant),
      });
    }
  } else if (v.tipo_presentacion === 'cono' && v.origen_variante_id) {
    // Se vendieron conos: pueden volver como el paquete del que salieron.
    const [prows] = await conn.query(
      `SELECT id, sku, presentacion, peso_kg FROM producto_variantes
        WHERE id = :id AND activo = 1`,
      { id: v.origen_variante_id }
    );
    const paq = prows[0];
    if (paq) {
      alternativas.push({
        variante_id: paq.id,
        sku: paq.sku,
        presentacion: paq.presentacion,
        unidad: 'kg',
        cantidad_equivalente: round3(cant),
      });
    }
  }
  return alternativas;
}

/**
 * Valida que una línea pueda regresar en la presentación pedida y devuelve qué
 * reponer. Sin `devolucion` indicada, vuelve tal como se vendió.
 */
async function _resolverRetorno(conn, linea, devolucion) {
  if (!devolucion || Number(devolucion.variante_id) === Number(linea.variante_id)) {
    return {
      variante_id: linea.variante_id,
      cantidad: Number(devolucion?.cantidad ?? linea.cantidad),
      cambioDePresentacion: null,
    };
  }

  const alternativas = await _alternativasDeDevolucion(conn, linea.variante_id, linea.cantidad);
  const alt = alternativas.find((a) => Number(a.variante_id) === Number(devolucion.variante_id));
  if (!alt) {
    throw new AppError(422, 'PRESENTACION_INCOMPATIBLE',
      `"${linea.descripcion}" no puede regresar en esa presentación: solo en ` +
      (alternativas.length ? alternativas.map((a) => a.sku).join(', ') : 'la misma en que se vendió') + '.');
  }

  const cantidad = Number(devolucion.cantidad ?? alt.cantidad_equivalente);
  if (!(cantidad > 0)) {
    throw new AppError(422, 'CANTIDAD_INVALIDA',
      `La cantidad que regresa de "${linea.descripcion}" debe ser mayor a cero`);
  }
  return {
    variante_id: alt.variante_id,
    cantidad: round3(cantidad),
    // Lo que se escribe en el kardex: el cambio debe quedar explicado.
    cambioDePresentacion: {
      sku: alt.sku,
      equivalente: alt.cantidad_equivalente,
      unidad: alt.unidad,
      ajustada: round3(cantidad) !== alt.cantidad_equivalente,
    },
  };
}

/**
 * Dónde registrar el movimiento de caja de una devolución. Si el turno en que se
 * vendió sigue abierto, va ahí. Si ya se cerró, NO se toca —su corte está
 * cuadrado y firmado— y el dinero sale del turno abierto de la misma caja, que
 * es de donde de verdad se saca el efectivo.
 */
async function _sesionParaDevolucion(conn, pedido) {
  if (!pedido.sesion_caja_id) return null;

  const [srows] = await conn.query(
    'SELECT id, estado, caja_id FROM sesiones_caja WHERE id = :id',
    { id: pedido.sesion_caja_id }
  );
  const sesion = srows[0];
  if (!sesion) return null;
  if (sesion.estado === 'abierta') return sesion.id;

  const [arows] = await conn.query(
    `SELECT id FROM sesiones_caja
      WHERE caja_id = :caja AND estado = 'abierta'
      ORDER BY id DESC LIMIT 1`,
    { caja: sesion.caja_id }
  );
  return arows[0]?.id ?? null;
}

async function cambiarEstado(id, estado, usuarioId = null, devoluciones = null) {
  if (!ESTADOS.includes(estado)) {
    throw new AppError(422, 'ESTADO_INVALIDO', `Estado inválido: ${estado}`);
  }

  return withTransaction(async (conn) => {
    const [prev] = await conn.query(
      `SELECT estado, numero_pedido, almacen_id, sesion_caja_id, canal
         FROM pedidos WHERE id = :id FOR UPDATE`,
      { id }
    );
    if (!prev[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Pedido no encontrado');

    const pedido = prev[0];
    const { estado: antes, numero_pedido: numero, almacen_id: almacenId } = pedido;
    const eraInactivo = INACTIVOS.includes(antes);
    const esInactivo = INACTIVOS.includes(estado);

    // ---- El dinero: se devuelve el efectivo al cancelar, se reingresa al
    // reactivar. Va antes de tocar inventario para que un 409 por caja cerrada
    // no deje nada movido.
    if (eraInactivo !== esInactivo && pedido.canal === 'punto_venta') {
      const efectivo = await _efectivoDelPedido(
        conn,
        id,
        esInactivo ? 'completado' : 'reembolsado'
      );

      if (efectivo > 0) {
        const sesionId = await _sesionParaDevolucion(conn, pedido);
        if (!sesionId) {
          throw new AppError(409, 'CAJA_CERRADA',
            `Hay $${efectivo.toFixed(2)} en efectivo que ${esInactivo ? 'devolver' : 'reingresar'} ` +
            `por ${numero} y la caja está cerrada. Abre el turno para poder registrarlo.`);
        }

        if (esInactivo) {
          // 'devolucion' ya resta en el corte (ver SIGNO_CAJA en caja/model.js).
          await conn.query(
            `INSERT INTO movimientos_caja (sesion_caja_id, tipo, monto, referencia_id, motivo)
             VALUES (:sesion, 'devolucion', :monto, :pedido, :motivo)`,
            {
              sesion: sesionId,
              monto: efectivo,
              pedido: id,
              motivo: `${estado === 'devuelto' ? 'Devolución' : 'Cancelación'} de ${numero}`,
            }
          );
          await conn.query(
            `UPDATE pagos SET estado = 'reembolsado'
              WHERE pedido_id = :id AND estado = 'completado'`,
            { id }
          );
        } else {
          // Se reactiva: el dinero vuelve a la caja. Entra como 'ingreso' y no
          // como 'venta' para no contarlo dos veces en los reportes de ventas.
          await conn.query(
            `INSERT INTO movimientos_caja (sesion_caja_id, tipo, monto, referencia_id, motivo)
             VALUES (:sesion, 'ingreso', :monto, :pedido, :motivo)`,
            { sesion: sesionId, monto: efectivo, pedido: id, motivo: `Reactivación de ${numero}` }
          );
          await conn.query(
            `UPDATE pagos SET estado = 'completado'
              WHERE pedido_id = :id AND estado = 'reembolsado'`,
            { id }
          );
        }
      } else if (esInactivo) {
        // Sin efectivo que mover (todo fue tarjeta), pero los pagos igual dejan
        // de estar cobrados: el reembolso lo hace el banco.
        await conn.query(
          `UPDATE pagos SET estado = 'reembolsado'
            WHERE pedido_id = :id AND estado = 'completado'`,
          { id }
        );
      } else {
        await conn.query(
          `UPDATE pagos SET estado = 'completado'
            WHERE pedido_id = :id AND estado = 'reembolsado'`,
          { id }
        );
      }
    }

    // La mercancía vuelve al almacén DE DONDE SALIÓ (pedidos.almacen_id), que es
    // el de la caja que vendió o el de la tienda en línea. Se compara el estado
    // anterior contra el nuevo para no reponer dos veces si se vuelve a mandar
    // 'cancelado' sobre un pedido ya cancelado.
    if (eraInactivo !== esInactivo && almacenId) {
      const [lineas] = await conn.query(
        // `id` hace falta para casar cada línea con su devolución.
        'SELECT id, variante_id, cantidad, descripcion FROM pedido_detalle WHERE pedido_id = :id',
        { id }
      );

      for (const l of lineas) {
        const cant = Number(l.cantidad);

        if (esInactivo) {
          // Cancelado o devuelto: regresa al inventario. Puede volver en OTRA
          // presentación —se entregó el paquete y devuelven los conos—, así que
          // se resuelve qué reponer antes de tocar saldos.
          const dev = (devoluciones ?? []).find(
            (d) => Number(d.detalle_id) === Number(l.id)
          );
          const retorno = await _resolverRetorno(conn, l, dev);
          const cambio = retorno.cambioDePresentacion;

          let motivo = `${estado === 'devuelto' ? 'Devolución' : 'Cancelación'} de ${numero}`;
          if (cambio) {
            motivo += ` · se vendió ${cant} de ${l.descripcion} y regresó como ${cambio.sku}`;
            if (cambio.ajustada) motivo += ` (equivalente ${cambio.equivalente})`;
          }

          await conn.query(
            `INSERT INTO inventario (variante_id, almacen_id, cantidad)
               VALUES (:v, :a, :cant)
             ON DUPLICATE KEY UPDATE cantidad = cantidad + :cant`,
            { v: retorno.variante_id, a: almacenId, cant: retorno.cantidad }
          );
          await conn.query(
            `INSERT INTO movimientos_inventario
               (variante_id, almacen_id, tipo, cantidad, referencia_tipo, referencia_id,
                usuario_id, motivo)
             VALUES (:v, :a, 'entrada', :cant, 'pedido', :id, :usuario, :motivo)`,
            {
              v: retorno.variante_id,
              a: almacenId,
              cant: retorno.cantidad,
              id,
              usuario: usuarioId,
              motivo,
            }
          );
        } else {
          // Se reactiva: la mercancía vuelve a salir, así que hay que tenerla.
          // Si volvió en OTRA presentación (se vendió el paquete y devolvieron
          // los conos), ese paquete ya no existe: deshacerlo automáticamente
          // dejaría el inventario mintiendo, así que se para aquí.
          const [otras] = await conn.query(
            `SELECT DISTINCT variante_id FROM movimientos_inventario
              WHERE referencia_tipo = 'pedido' AND referencia_id = :id
                AND tipo = 'entrada' AND variante_id <> :v`,
            { id, v: l.variante_id }
          );
          if (otras.length) {
            throw new AppError(409, 'DEVUELTO_EN_OTRA_PRESENTACION',
              `${numero} se devolvió en otra presentación, así que no se puede reactivar ` +
              `automáticamente: la mercancía ya no está como se vendió. Ajusta el inventario a mano.`);
          }
          const [srows] = await conn.query(
            `SELECT cantidad FROM inventario
              WHERE variante_id = :v AND almacen_id = :a FOR UPDATE`,
            { v: l.variante_id, a: almacenId }
          );
          const saldo = srows[0] ? Number(srows[0].cantidad) : 0;
          if (saldo < cant) {
            throw new AppError(409, 'STOCK_INSUFICIENTE',
              `No se puede reactivar ${numero}: de "${l.descripcion}" hay ${saldo} y ` +
              `el pedido necesita ${cant}.`);
          }
          await conn.query(
            'UPDATE inventario SET cantidad = cantidad - :cant WHERE variante_id = :v AND almacen_id = :a',
            { v: l.variante_id, a: almacenId, cant }
          );
          await conn.query(
            `INSERT INTO movimientos_inventario
               (variante_id, almacen_id, tipo, cantidad, referencia_tipo, referencia_id,
                usuario_id, motivo)
             VALUES (:v, :a, 'salida', :cant, 'pedido', :id, :usuario, :motivo)`,
            {
              v: l.variante_id,
              a: almacenId,
              cant: -cant,
              id,
              usuario: usuarioId,
              motivo: `Reactivación de ${numero}`,
            }
          );
        }
      }
    }

    // Los bultos siguen al pedido: si se cancela o se devuelve, el bulto volvió
    // y queda disponible para venderse de nuevo. Si el pedido se reactiva, se
    // vuelven a tomar.
    if (!eraInactivo && esInactivo) {
      await conn.query(
        `UPDATE variante_codigos
            SET estado = 'disponible', consumido_en = NULL,
                consumido_tipo = NULL, consumido_id = NULL
          WHERE consumido_tipo = 'pedido' AND consumido_id = :id`,
        { id }
      );
    } else if (eraInactivo && !esInactivo) {
      // Retoma solo los bultos que nadie más haya tomado mientras estuvo cancelado.
      await conn.query(
        `UPDATE variante_codigos vc
            JOIN pedido_detalle_bultos b ON b.variante_codigo_id = vc.id
            JOIN pedido_detalle pd       ON pd.id = b.detalle_id
             SET vc.estado = 'vendido', vc.consumido_en = NOW(),
                 vc.consumido_tipo = 'pedido', vc.consumido_id = :id
           WHERE pd.pedido_id = :id AND vc.estado = 'disponible'`,
        { id }
      );
    }

    // El UPDATE del estado va al final: si algo de arriba falló (p.ej. no hay
    // existencias para reactivar), el pedido no se mueve.
    await conn.query('UPDATE pedidos SET estado = :estado WHERE id = :id', { estado, id });

    return _obtenerConn(conn, id);
  });
}

module.exports = { crearPedido, obtener, listar, cambiarEstado, ESTADOS };
