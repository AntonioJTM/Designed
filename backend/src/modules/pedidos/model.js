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

    // 6. Detalle.
    for (const d of detalle) {
      await conn.query(
        `INSERT INTO pedido_detalle
           (pedido_id, variante_id, descripcion, cantidad, precio_unitario, descuento, impuesto, subtotal)
         VALUES (:pedido_id, :variante_id, :descripcion, :cantidad, :precio_unitario, :descuento, :impuesto, :subtotal)`,
        { pedido_id: pedidoId, ...d }
      );
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

async function cambiarEstado(id, estado) {
  if (!ESTADOS.includes(estado)) {
    throw new AppError(422, 'ESTADO_INVALIDO', `Estado inválido: ${estado}`);
  }
  const [r] = await pool.query('UPDATE pedidos SET estado = :estado WHERE id = :id', { estado, id });
  if (r.affectedRows === 0) throw new AppError(404, 'NO_ENCONTRADO', 'Pedido no encontrado');
  return obtener(id);
}

module.exports = { crearPedido, obtener, listar, cambiarEstado, ESTADOS };
