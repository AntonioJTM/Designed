'use strict';

const crypto = require('crypto');
const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const almacenesModel = require('../almacenes/model');
const configuracionModel = require('../configuracion/model');
const clientesModel = require('../clientes/model');
const archivos = require('../../utils/archivos');
const { hoyLocal } = require('../../utils/fechas');

// Ventas/pedidos unificados (online + POS). La confirmación de venta ocurre en
// UNA transacción: pedidos + pedido_detalle + pagos + descuento de inventario +
// movimientos_inventario (salida) + (si POS) movimientos_caja (venta).

// 'apartado' es destino válido SOLO para reactivar un apartado cancelado; lo
// vigila `_validarCaminoApartado`.
const ESTADOS = [
  'apartado', 'pendiente', 'pagado', 'en_preparacion', 'enviado', 'entregado', 'cancelado', 'devuelto',
];
// Cómo llega la mercancía al cliente. El mostrador siempre es 'recoger'.
const METODOS_ENTREGA = ['recoger', 'envio'];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Las cantidades son DECIMAL(12,3): hasta el gramo.
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

function generarNumero(canal) {
  const pref = canal === 'punto_venta' ? 'POS' : 'WEB';
  return `${pref}-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

/**
 * Calcula el descuento de un cupón válido sobre el subtotal (o lanza).
 * `bloquear` toma FOR UPDATE: se hace al vender —para que dos pedidos no
 * gasten el último uso a la vez— pero no al cotizar, que solo consulta.
 */
async function _resolverCupon(conn, codigo, subtotal, bloquear = true) {
  const [rows] = await conn.query(
    `SELECT * FROM cupones WHERE codigo = :codigo AND activo = 1 ${bloquear ? 'FOR UPDATE' : ''}`,
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

/**
 * Arma el pedido —detalle, impuestos, cupón, envío y total— SIN escribir nada.
 * La venta y la cotización del checkout pasan por aquí, así que el número que
 * el cliente ve antes de confirmar es el mismo que se le cobra.
 *
 *   bloquear  true en la venta: toma FOR UPDATE sobre inventario, bultos y
 *             cupón. En la cotización no, que solo consulta.
 *   esCliente true cuando quien pide es el cliente de la tienda en línea. En
 *             ese caso el backend NO acepta el costo de envío ni los pagos:
 *             los calcula y los ignora respectivamente (ver abajo).
 */
/**
 * Kilos de una presentación que están APARTADOS en un almacén: los de los
 * apartados vigentes que todavía no se entregan. Se calcula de los pedidos y no
 * se lee de `inventario.cantidad_reservada`, que mezcla los apartados con lo
 * pedido por los traspasos.
 */
async function _apartadoEnAlmacen(conn, varianteId, almacenId) {
  const [[r]] = await conn.query(
    `SELECT COALESCE(SUM(pd.cantidad), 0) AS kg
       FROM pedido_detalle pd
       JOIN pedidos p ON p.id = pd.pedido_id
      WHERE p.estado = 'apartado' AND p.inventario_descontado = 0
        AND p.almacen_id = :a AND pd.variante_id = :v`,
    { v: varianteId, a: almacenId }
  );
  return Number(r.kg);
}

async function _cotizar(conn, datos, { bloquear = false, esCliente = false } = {}) {
  const esPOS = datos.canal === 'punto_venta';
  const paraBloquear = bloquear ? 'FOR UPDATE' : '';

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
        WHERE s.id = :id ${paraBloquear}`,
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

  // 2. Cómo se entrega. El mostrador se lleva la mercancía en el momento, así
  //    que siempre es 'recoger'; online lo elige el cliente.
  const metodoEntrega = esPOS ? 'recoger' : (datos.metodo_entrega ?? 'recoger');
  if (!METODOS_ENTREGA.includes(metodoEntrega)) {
    throw new AppError(422, 'ENTREGA_INVALIDA', 'La entrega debe ser "recoger" o "envio"');
  }

  // La dirección tiene que ser del cliente que compra. Se valida SIEMPRE, no
  // solo cuando la manda un cliente: un id ajeno filtrado por el panel también
  // mandaría el paquete a la casa equivocada.
  let direccionId = metodoEntrega === 'envio' ? (datos.direccion_envio_id ?? null) : null;
  if (metodoEntrega === 'envio') {
    if (!direccionId) {
      throw new AppError(422, 'FALTA_DIRECCION',
        'Un pedido a domicilio necesita una dirección de entrega.');
    }
    const [drows] = await conn.query(
      'SELECT id, cliente_id FROM direcciones WHERE id = :id LIMIT 1',
      { id: direccionId }
    );
    const dir = drows[0];
    if (!dir || (datos.cliente_id && Number(dir.cliente_id) !== Number(datos.cliente_id))) {
      throw new AppError(422, 'DIRECCION_INVALIDA',
        'Esa dirección de entrega no existe o no es de este cliente.');
    }
  }

  // 3. Lista de precios con la que se cobra. Sin tipo explícito se usa el
  //    público, que es `producto_variantes.precio`.
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

  // 4. Construir el detalle con precios e impuestos calculados en el backend.
  const detalle = [];
  let subtotal = 0;
  let impuestos = 0;

  for (const item of datos.items) {
    // `precio_tipo` es el precio propio del tipo de cliente, si lo tiene
    // capturado; si no, se cobra el público (pv.precio).
    const [vrows] = await conn.query(
      `SELECT pv.id, pv.precio, pv.precio_oferta, pv.presentacion, pv.activo,
              pv.costo,
              p.nombre AS producto, p.grosor_calibre AS calibre, imp.porcentaje AS imp_pct,
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

    // Orden de prelación: precio del tipo de cliente > oferta > público.
    const precioUnit =
      v.precio_tipo != null
        ? Number(v.precio_tipo)
        : v.precio_oferta != null
          ? Number(v.precio_oferta)
          : Number(v.precio);
    // Un hilo que entró con la lista del proveedor y todavía no tiene precio
    // queda en $0: venderlo así sería regalarlo. Se rechaza hasta que la tienda
    // le ponga su precio por kilo.
    if (!(precioUnit > 0)) {
      throw new AppError(422, 'SIN_PRECIO',
        `«${v.producto}${v.calibre ? ' ' + v.calibre : ''}» todavía no tiene precio. ` +
        'Ponle su precio por kilo en Productos para poder venderlo.');
    }

    // Bloquea existencias y valida disponibilidad.
    const [irows] = await conn.query(
      `SELECT id, cantidad FROM inventario
        WHERE variante_id = :v AND almacen_id = :a ${paraBloquear}`,
      { v: item.variante_id, a: almacenId }
    );
    const existente = irows[0] ? Number(irows[0].cantidad) : 0;
    // Lo apartado por clientes sigue en la bodega pero ya tiene dueño: no se le
    // vende a otro. Si se vendiera, el día que vengan por su apartado no habría
    // con qué entregarlo. Se cuenta APARTE de `cantidad_reservada` porque esa
    // columna también lleva lo pedido por un traspaso, y esa reserva es blanda:
    // el cliente que está enfrente manda sobre una sucursal que pidió.
    const apartado = await _apartadoEnAlmacen(conn, item.variante_id, almacenId);
    const libre = round3(existente - apartado);
    if (libre + 0.0001 < item.cantidad) {
      // Mensaje en términos del producto, no del id interno: lo lee el cliente.
      // Con el calibre: "MARINO OSCURO · Paquete" no dice si es el 1/30 o el 2/30.
      const nombre = `${v.producto}${v.calibre ? ' ' + v.calibre : ''}${v.presentacion ? ' · ' + v.presentacion : ''}`;
      throw new AppError(
        409,
        'STOCK_INSUFICIENTE',
        apartado > 0
          ? `De "${nombre}" hay ${round3(existente)}, pero ${round3(apartado)} están apartados ` +
            `para otros clientes: quedan ${Math.max(0, libre)} para vender y pediste ${item.cantidad}.`
          : existente === 0
            ? `"${nombre}" está agotado.`
            : `Solo quedan ${existente} de "${nombre}" y pediste ${item.cantidad}.`
      );
    }

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
      // El costo se CONGELA igual que el precio: a cómo salió ESE kilo ESE
      // día. Sin congelarlo, el margen de una venta de enero cambiaría cada
      // vez que llega una remesa nueva, y un histórico que se mueve no sirve
      // para decidir. NULL cuando el hilo no tiene costo capturado: el
      // reporte de margen lo dice en vez de suponer cero.
      costo_unitario: v.costo != null ? Number(v.costo) : null,
      descuento: descLinea,
      impuesto: impLinea,
      subtotal: subLinea,
      // Bultos escaneados que formaron la cantidad. No entran a la tabla de
      // detalle: se guardan aparte, ligados a la línea (paso 6 de la venta).
      bultos: item.bultos ?? [],
    });
  }

  // 5. Cupón (opcional).
  let cupon = null;
  let descuento = 0;
  if (datos.cupon_codigo) {
    const r = await _resolverCupon(conn, datos.cupon_codigo, subtotal, bloquear);
    cupon = r.cupon;
    descuento = r.descuento;
  }

  // 6. Envío. Recoger en tienda no cuesta; a domicilio es la tarifa fija que
  //    el administrador configura. Al CLIENTE nunca se le cree el costo que
  //    manda —es dinero, y el navegador no es de fiar—: se lee de la base.
  //    El staff sí puede fijarlo a mano para un pedido capturado por teléfono.
  let costoEnvio = 0;
  if (metodoEntrega === 'envio') {
    const puedeFijarlo = !esCliente && datos.costo_envio !== undefined;
    costoEnvio = puedeFijarlo
      ? round2(datos.costo_envio)
      : round2(await configuracionModel.numero('envio_costo_fijo', 0, conn));
  }

  const total = round2(subtotal - descuento + impuestos + costoEnvio);
  if (total < 0) throw new AppError(422, 'TOTAL_NEGATIVO', 'El total no puede ser negativo');

  return {
    esPOS, almacenId, sesionCajaId, metodoEntrega, direccionId, tipoClienteId,
    detalle, subtotal, impuestos, descuento, cupon, costoEnvio, total,
  };
}

async function crearPedido(datos, usuarioId, { esCliente = false } = {}) {
  // Un apartado desde la tienda en línea se rechaza ANTES de cotizar: si no,
  // la cotización revisaba primero las existencias del almacén en línea y el
  // error decía "no hay" en vez de lo que de verdad pasa.
  if (datos.apartado === true && datos.canal !== 'punto_venta') {
    throw new AppError(422, 'APARTADO_SOLO_MOSTRADOR',
      'Los apartados se hacen en el mostrador, no en la tienda en línea.');
  }
  return withTransaction(async (conn) => {
    const cot = await _cotizar(conn, datos, { bloquear: true, esCliente });
    const {
      esPOS, almacenId, sesionCajaId, metodoEntrega, direccionId, tipoClienteId,
      detalle, subtotal, impuestos, descuento, costoEnvio, total,
    } = cot;
    const cuponId = cot.cupon ? cot.cupon.id : null;

    // 4. Validar pagos y determinar estado.
    //
    // Un CLIENTE de la tienda en línea no cobra: elige cómo va a pagar y ya.
    // Sus `pagos` se descartan —si se aceptaran, cualquiera podría mandar el
    // monto completo y quedar 'pagado' sin haber depositado un peso— y en su
    // lugar se asienta la INTENCIÓN de pago: un `pagos` en estado 'pendiente'
    // por el total, que el administrador confirma cuando ve el depósito o
    // cuando el cliente paga en el mostrador.
    const pagos = esCliente ? [] : (datos.pagos ?? []);
    const intencionPago = esCliente ? (datos.metodo_pago_id ?? null) : null;
    const pagado = round2(pagos.reduce((s, p) => s + Number(p.monto), 0));

    // Lo que se lleva a deber. Un cliente de la tienda en línea no puede
    // fiarse a sí mismo: el crédito lo autoriza el mostrador.
    const aCredito = esCliente ? 0 : round2(datos.a_credito ?? 0);
    if (aCredito > 0) {
      if (!datos.cliente_id) {
        throw new AppError(422, 'FALTA_CLIENTE',
          'Para vender a crédito hay que decir a QUIÉN se le fía.');
      }
      // Fiar más de lo que vale la venta dejaría un cargo que no corresponde
      // a nada.
      if (aCredito > total + 0.0001) {
        throw new AppError(422, 'CREDITO_MAYOR_AL_TOTAL',
          `Se quiere fiar $${aCredito.toFixed(2)} de una venta de $${total.toFixed(2)}.`);
      }
    }

    // Un APARTADO no se cobra completo ni se entrega: el cliente deja lo que
    // quiera y la mercancía se guarda. Se acepta que el anticipo sea menor al
    // total —es lo normal— y por eso salta la validación de pago suficiente.
    const esApartado = datos.apartado === true;
    if (esApartado) {
      if (!esPOS) {
        throw new AppError(422, 'APARTADO_SOLO_MOSTRADOR',
          'Los apartados se hacen en el mostrador, no en la tienda en línea.');
      }
      if (aCredito > 0) {
        // Fiar Y apartar a la vez no tiene sentido: fiar es entregar sin
        // cobrar, apartar es cobrar sin entregar.
        throw new AppError(422, 'APARTADO_A_CREDITO',
          'Un apartado no se puede fiar: o se guarda hasta que lo pague, o se lo lleva a crédito.');
      }
      // Sin cliente no se sabe A QUIÉN se le está guardando la mercancía, y
      // dentro de un mes nadie podrá reclamarla ni identificarla. Un apartado
      // anónimo es mercancía perdida en la bodega.
      if (!datos.cliente_id) {
        throw new AppError(422, 'APARTADO_SIN_CLIENTE',
          'Un apartado necesita saber a quién se le guarda: identifica al cliente.');
      }
    }

    let estado = 'pendiente';
    if (esApartado) {
      estado = 'apartado';
      // El anticipo puede ser cualquier cosa, incluso nada: hay clientes que
      // apartan y vuelven a pagar. Lo único que no se admite es pasarse del
      // total, que sería cobrarle de más.
      if (pagado > total + 0.0001) {
        throw new AppError(422, 'ANTICIPO_MAYOR_AL_TOTAL',
          `El anticipo ($${pagado.toFixed(2)}) es mayor que el apartado ($${total.toFixed(2)}).`);
      }
    } else if (esPOS) {
      // A crédito el cliente cubre la diferencia con su firma, no con dinero.
      if (pagado + aCredito + 0.0001 < total) {
        throw new AppError(409, 'PAGO_INSUFICIENTE',
          `El pago (${pagado})${aCredito ? ` más el crédito (${aCredito})` : ''} ` +
          `no cubre el total (${total})`);
      }
      // Una venta con parte a crédito NO está pagada: la mercancía salió pero
      // el dinero no ha entrado. Queda 'pendiente' hasta que abone.
      estado = aCredito > 0 ? 'pendiente' : 'pagado';
    } else if (pagos.length && pagado + 0.0001 >= total) {
      estado = 'pagado';
    }

    // Lo que se ASIENTA como pago es lo que se COBRÓ, no lo que entregó el
    // cliente. Paga una venta de $432 con un billete de $500: se le dan $68 de
    // cambio, y en `pagos` quedan $432. Si quedaran $500, al cancelar la venta
    // la caja devolvería $500 —`_efectivoDelPedido` suma esos pagos— y el corte
    // saldría con $68 de faltante que nadie se llevó.
    // Solo el efectivo da cambio: con tarjeta o transferencia se cobra justo, y
    // un pago así por encima del total es un error de captura.
    const esEfectivo = {};
    let cambio = 0;
    if (pagos.length) {
      const ids = pagos.map((p) => p.metodo_pago_id);
      const [mrows] = await conn.query('SELECT id, nombre FROM metodos_pago WHERE id IN (:ids)', { ids });
      for (const m of mrows) esEfectivo[m.id] = (m.nombre || '').toLowerCase().includes('efectivo');

      const porCobrar = round2(total - aCredito);
      const sobra = round2(pagado - porCobrar);
      if (sobra > 0.0001) {
        const efectivoRecibido = round2(
          pagos.filter((p) => esEfectivo[p.metodo_pago_id]).reduce((s, p) => s + Number(p.monto), 0)
        );
        if (sobra > efectivoRecibido + 0.0001) {
          throw new AppError(422, 'PAGO_EXCEDE_TOTAL',
            `Se registran $${pagado.toFixed(2)} para cobrar $${porCobrar.toFixed(2)}, y solo el ` +
            'efectivo da cambio: con tarjeta o transferencia se cobra el importe justo.');
        }
        cambio = sobra;
      }
    }

    if (intencionPago) {
      const [mrows] = await conn.query(
        'SELECT id, activo FROM metodos_pago WHERE id = :id LIMIT 1',
        { id: intencionPago }
      );
      if (!mrows[0] || !mrows[0].activo) {
        throw new AppError(422, 'METODO_PAGO_INVALIDO', 'Ese método de pago no existe o está inactivo');
      }
    }

    // 5. Insertar pedido.
    const numero = generarNumero(datos.canal);
    const [pr] = await conn.query(
      `INSERT INTO pedidos
         (numero_pedido, canal, metodo_entrega, cliente_id, tipo_cliente_id, usuario_id,
          sesion_caja_id, almacen_id,
          direccion_envio_id, cupon_id, estado, inventario_descontado,
          subtotal, descuento, impuestos, costo_envio, total, notas)
       VALUES
         (:numero, :canal, :metodo_entrega, :cliente_id, :tipo_cliente_id, :usuario_id,
          :sesion_caja_id, :almacen_id,
          :direccion_envio_id, :cupon_id, :estado, :inventario_descontado,
          :subtotal, :descuento, :impuestos, :costo_envio, :total, :notas)`,
      {
        numero,
        canal: datos.canal,
        metodo_entrega: metodoEntrega,
        cliente_id: datos.cliente_id ?? null,
        tipo_cliente_id: tipoClienteId,
        usuario_id: usuarioId ?? null,
        sesion_caja_id: sesionCajaId,
        almacen_id: almacenId,
        direccion_envio_id: direccionId,
        cupon_id: cuponId,
        estado,
        // El apartado NO descuenta: la mercancía sigue en la bodega, apartada.
        // Se descuenta al entregarla.
        inventario_descontado: esApartado ? 0 : 1,
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
           (pedido_id, variante_id, descripcion, cantidad, precio_unitario, costo_unitario,
            descuento, impuesto, subtotal)
         VALUES (:pedido_id, :variante_id, :descripcion, :cantidad, :precio_unitario, :costo_unitario,
                 :descuento, :impuesto, :subtotal)`,
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
    //    El cambio se le resta al efectivo (ver arriba): lo que queda asentado
    //    es lo cobrado.
    let noEfectivo = 0;
    let cambioPorDar = cambio;
    for (const p of pagos) {
      let monto = round2(Number(p.monto));
      if (cambioPorDar > 0 && esEfectivo[p.metodo_pago_id]) {
        const quita = Math.min(monto, cambioPorDar);
        monto = round2(monto - quita);
        cambioPorDar = round2(cambioPorDar - quita);
      }
      // Un billete que fue todo cambio no es un pago.
      if (monto <= 0) continue;
      await conn.query(
        `INSERT INTO pagos (pedido_id, metodo_pago_id, monto, estado, referencia_transaccion)
         VALUES (:pedido_id, :metodo_pago_id, :monto, 'completado', :ref)`,
        { pedido_id: pedidoId, metodo_pago_id: p.metodo_pago_id, monto, ref: p.referencia_transaccion ?? null }
      );
      if (!esEfectivo[p.metodo_pago_id]) noEfectivo = round2(noEfectivo + monto);
    }

    // Cómo dijo el cliente que va a pagar. Queda como pago 'pendiente' por el
    // total: no es dinero cobrado, es el compromiso, y así el panel sabe si
    // espera un depósito o al cliente en el mostrador.
    if (intencionPago && total > 0) {
      await conn.query(
        `INSERT INTO pagos (pedido_id, metodo_pago_id, monto, estado)
         VALUES (:pedido_id, :metodo_pago_id, :monto, 'pendiente')`,
        { pedido_id: pedidoId, metodo_pago_id: intencionPago, monto: total }
      );
    }
    // Efectivo que ingresa a la caja = total menos lo cubierto con tarjeta/otros
    // y menos lo que se fue A CRÉDITO (el cambio entregado no forma parte del
    // ingreso neto). Sin restar el crédito, el corte esperaría en el cajón un
    // dinero que el cliente no dejó.
    // En un APARTADO entra al cajón solo el ANTICIPO, no el total: el resto
    // todavía no lo ha pagado nadie. En una venta normal el total menos lo
    // cubierto con tarjeta y lo fiado.
    const efectivo = esApartado
      ? round2(Math.max(0, pagado - noEfectivo))
      : round2(Math.max(0, total - noEfectivo - aCredito));

    // 8. La mercancía.
    //
    //    Una venta la DESCUENTA: salió de la tienda, y queda su movimiento en
    //    el kardex.
    //    Un apartado la RESERVA: sigue ahí, pero el mostrador ya no puede
    //    vendérsela a otro. NO se toca el kardex, porque no hubo movimiento de
    //    existencias: apuntar una salida que no ocurrió descuadraría el
    //    inventario contra el conteo físico.
    for (const d of detalle) {
      if (esApartado) {
        await conn.query(
          `INSERT INTO inventario (variante_id, almacen_id, cantidad, cantidad_reservada)
             VALUES (:v, :a, 0, :cant)
           ON DUPLICATE KEY UPDATE cantidad_reservada = cantidad_reservada + :cant`,
          { v: d.variante_id, a: almacenId, cant: d.cantidad }
        );
      } else {
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
    }

    // 9. Movimiento de caja (solo POS y solo la parte en efectivo).
    if (esPOS && efectivo > 0) {
      await conn.query(
        `INSERT INTO movimientos_caja (sesion_caja_id, tipo, monto, referencia_id, motivo)
         VALUES (:sesion, 'venta', :monto, :pedido, :motivo)`,
        { sesion: sesionCajaId, monto: efectivo, pedido: pedidoId, motivo: `Venta ${numero}` }
      );
    }

    // 10. El cargo a la cuenta del cliente. Va DENTRO de esta transacción: si
    //     la venta se revierte, la deuda no queda. Valida el límite con la
    //     fila del cliente bloqueada, así dos cajas cobrando a la vez no
    //     pueden pasarlo entre las dos.
    if (aCredito > 0) {
      await clientesModel.cargarVentaACredito(conn, {
        clienteId: datos.cliente_id,
        monto: aCredito,
        pedidoId,
        numeroPedido: numero,
        usuarioId,
      });
    }

    // 11. Consumir un uso del cupón.
    if (cuponId) {
      await conn.query('UPDATE cupones SET usos_actuales = usos_actuales + 1 WHERE id = :id', { id: cuponId });
    }

    // El cambio no se guarda en ningún lado —no es dinero de la tienda— pero
    // el ticket lo necesita, y calcularlo en la pantalla con un total que
    // pudo cambiar al cobrar daría otra cifra.
    const pedido = await _obtenerConn(conn, pedidoId);
    pedido.cambio = cambio;
    return pedido;
  });
}

/** Detalle completo del pedido (usa la conexión dada o el pool). */
async function _obtenerConn(ejecutor, id) {
  const [prows] = await ejecutor.query(
    `SELECT p.*, c.nombre AS cliente, c.nombre_comercial AS cliente_nombre_comercial,
            u.nombre AS usuario, a.nombre AS almacen, cj.nombre AS caja
       FROM pedidos p
       LEFT JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN usuarios u ON u.id = p.usuario_id
       LEFT JOIN almacenes a ON a.id = p.almacen_id
       LEFT JOIN sesiones_caja sc ON sc.id = p.sesion_caja_id
       LEFT JOIN cajas cj ON cj.id = sc.caja_id
      WHERE p.id = :id LIMIT 1`,
    { id }
  );
  const pedido = prows[0];
  if (!pedido) return null;

  // La dirección completa, no solo su id: quien surte el pedido tiene que leer
  // a dónde va sin abrir otra pantalla. Va aparte y no como JOIN porque un
  // pedido de mostrador o para recoger no tiene ninguna.
  pedido.direccion_envio = null;
  if (pedido.direccion_envio_id) {
    const [drows] = await ejecutor.query(
      `SELECT id, nombre_receptor, calle, numero_ext, numero_int, colonia, ciudad,
              estado, codigo_postal, pais, telefono, referencias
         FROM direcciones WHERE id = :id LIMIT 1`,
      { id: pedido.direccion_envio_id }
    );
    pedido.direccion_envio = drows[0] || null;
  }

  // `pedido_detalle.descripcion` congela lo que se vendió, pero solo dice el
  // color ("BLANCO · Paquete"). Quien atiende una duda necesita saber QUÉ hilo
  // es: el mismo color en dos calibres son dos productos distintos. El calibre,
  // el material y la línea se traen VIVOS del catálogo —no están congelados en
  // el detalle— así que si el producto se renombró después, aquí se ve el
  // nombre de hoy junto a la descripción de entonces. Es lo útil para atender
  // al cliente; el precio y la cantidad sí siguen congelados.
  const [det] = await ejecutor.query(
    `SELECT d.*, pv.sku, pv.tipo_presentacion, pv.presentacion, pv.peso_kg,
            pv.codigo_barras,
            p.nombre AS producto, p.grosor_calibre AS calibre,
            cat.nombre AS material, l.nombre AS linea
       FROM pedido_detalle d
       JOIN producto_variantes pv ON pv.id = d.variante_id
       JOIN productos p          ON p.id = pv.producto_id
       LEFT JOIN categorias cat  ON cat.id = p.categoria_id
       LEFT JOIN lineas l        ON l.id = p.linea_id
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
  // `comprobante_archivo` NO se expone: es el nombre en disco y no le sirve a
  // nadie fuera del servidor. Lo que la pantalla necesita saber es si HAY
  // comprobante, cómo se llamaba y quién lo subió; el archivo se pide aparte,
  // por un endpoint autenticado.
  const [pagos] = await ejecutor.query(
    `SELECT pg.id, pg.metodo_pago_id, mp.nombre AS metodo, pg.monto, pg.estado,
            pg.referencia_transaccion, pg.creado_en,
            (pg.comprobante_archivo IS NOT NULL) AS tiene_comprobante,
            pg.comprobante_nombre, pg.comprobante_tipo, pg.comprobante_subido_en,
            u.nombre AS comprobante_subido_por
       FROM pagos pg
       JOIN metodos_pago mp  ON mp.id = pg.metodo_pago_id
       LEFT JOIN usuarios u  ON u.id = pg.comprobante_subido_por
      WHERE pg.pedido_id = :id ORDER BY pg.id`,
    { id }
  );
  pedido.detalle = det;
  pedido.pagos = pagos;

  // Lo que se fió con este pedido: el cargo de la venta y, si se canceló, el
  // ajuste que quitó la deuda. Es de solo lectura y sirve para que el detalle
  // diga "se fió a su cuenta" y cuente lo que ha pasado.
  const [credito] = await ejecutor.query(
    `SELECT tipo, monto, notas, creado_en
       FROM credito_movimientos WHERE pedido_id = :id ORDER BY creado_en, id`,
    { id }
  );
  pedido.credito = credito;
  // Los abonos a la CUENTA después de la venta. No son de este pedido —lo fiado
  // se paga en la cuenta, no venta por venta— pero sin ellos el pedido parece
  // que nadie lo ha pagado. Solo los últimos cinco: es contexto, no el estado
  // de cuenta.
  pedido.abonos_cuenta = [];
  if (credito.length && pedido.cliente_id) {
    const [abonos] = await ejecutor.query(
      `SELECT monto, creado_en FROM credito_movimientos
        WHERE cliente_id = :cliente AND tipo = 'abono' AND creado_en >= :desde
        ORDER BY creado_en DESC, id DESC LIMIT 5`,
      { cliente: pedido.cliente_id, desde: pedido.creado_en }
    );
    pedido.abonos_cuenta = abonos.reverse();
  }
  return pedido;
}

async function obtener(id) {
  return _obtenerConn(pool, id);
}

async function listar({ canal, estado, cliente_id, q, caja_id, desde, hasta, limit, offset }) {
  const where = [];
  const params = {};
  if (canal) { where.push('p.canal = :canal'); params.canal = canal; }
  if (estado) { where.push('p.estado = :estado'); params.estado = estado; }
  if (cliente_id !== undefined) { where.push('p.cliente_id = :cliente_id'); params.cliente_id = cliente_id; }
  // Rediseño 2026-10 (pantalla Pedidos): buscar por folio o por cliente —por su
  // nombre o por como le dicen—, por caja y por rango de fechas. `hasta` es
  // INCLUSIVO para quien lo teclea (el día completo), por eso se compara contra
  // el día siguiente.
  if (q) {
    where.push('(p.numero_pedido LIKE :q OR c.nombre LIKE :q OR c.nombre_comercial LIKE :q)');
    params.q = `%${q}%`;
  }
  if (caja_id) { where.push('sc.caja_id = :caja_id'); params.caja_id = caja_id; }
  if (desde) { where.push('p.creado_en >= :desde'); params.desde = desde; }
  if (hasta) { where.push('p.creado_en < DATE_ADD(:hasta, INTERVAL 1 DAY)'); params.hasta = hasta; }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Los mismos JOIN en el listado y en el conteo: los filtros por cliente y por
  // caja los necesitan, y sin ellos el total no cuadraría con la lista.
  const joins = `LEFT JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN usuarios u ON u.id = p.usuario_id
       LEFT JOIN sesiones_caja sc ON sc.id = p.sesion_caja_id
       LEFT JOIN cajas cj ON cj.id = sc.caja_id`;

  // `pagado` es lo COBRADO (pagos completados). Con él la pantalla dice cuánto
  // falta de cada venta sin pedir el detalle de cada una.
  const [rows] = await pool.query(
    `SELECT p.id, p.numero_pedido, p.canal, p.metodo_entrega, p.estado, p.total, p.creado_en,
            p.inventario_descontado,
            c.nombre AS cliente, c.nombre_comercial AS cliente_nombre_comercial,
            u.nombre AS usuario, cj.nombre AS caja,
            (SELECT COALESCE(SUM(pg.monto), 0) FROM pagos pg
              WHERE pg.pedido_id = p.id AND pg.estado = 'completado') AS pagado
       FROM pedidos p
       ${joins}
       ${whereSql}
      ORDER BY p.creado_en DESC, p.id DESC
      LIMIT :limit OFFSET :offset`,
    { ...params, limit, offset }
  );

  // Qué se llevó: los hilos de cada pedido, con su CALIBRE (dos ROJO de distinto
  // calibre son dos hilos) y marcando el cono. Va en una segunda consulta y no
  // con GROUP_CONCAT, que se corta a 1,024 caracteres.
  for (const r of rows) {
    r.hilos = [];
    const pagado = Number(r.pagado);
    r.falta = INACTIVOS.includes(r.estado) ? 0 : Math.max(0, round2(Number(r.total) - pagado));
  }
  if (rows.length) {
    const [lineas] = await pool.query(
      `SELECT d.pedido_id, pr.nombre AS producto, pr.grosor_calibre AS calibre,
              pv.tipo_presentacion
         FROM pedido_detalle d
         JOIN producto_variantes pv ON pv.id = d.variante_id
         JOIN productos pr          ON pr.id = pv.producto_id
        WHERE d.pedido_id IN (:ids)
        ORDER BY d.id`,
      { ids: rows.map((r) => r.id) }
    );
    const porPedido = new Map(rows.map((r) => [r.id, r]));
    for (const l of lineas) {
      const r = porPedido.get(l.pedido_id);
      const hilo = `${l.producto}${l.calibre ? ' ' + l.calibre : ''}${l.tipo_presentacion === 'cono' ? ' · cono' : ''}`;
      if (r && !r.hilos.includes(hilo)) r.hilos.push(hilo);
    }
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM pedidos p ${joins} ${whereSql}`,
    params
  );
  return { rows, total };
}

/** Un pedido cancelado o devuelto ya no retiene la mercancía ni el dinero. */
const INACTIVOS = ['cancelado', 'devuelto'];

/**
 * Un APARTADO que no se ha entregado (`inventario_descontado = 0`) tiene su
 * propio camino, y el cambio de estado genérico no puede saltárselo:
 *  · Se ENTREGA con `POST /pedidos/:id/entregar`, que exige que esté liquidado
 *    y es donde por fin se descuenta. Pasarlo a 'pagado' o 'entregado' desde
 *    aquí dejaba la mercancía entregada sin salir del inventario y apartada
 *    para siempre.
 *  · Se CANCELA, que libera la reserva. "Devolver" no aplica: nunca se entregó.
 *  · Cancelado, se REACTIVA como 'apartado', que vuelve a reservar. Como
 *    'pendiente' quedaba una venta viva sin mercancía apartada ni descontada.
 * Y al revés: un pedido que ya descontó no puede volverse 'apartado'.
 * Se valida antes de mover nada.
 */
function _validarCaminoApartado(pedido, estado) {
  const antes = pedido.estado;
  if (estado === antes) return;
  const sinEntregar = !Number(pedido.inventario_descontado);
  const num = pedido.numero_pedido;
  const estabaInactivo = INACTIVOS.includes(antes);

  if (estado === 'apartado') {
    if (!sinEntregar || !estabaInactivo) {
      throw new AppError(409, 'NO_SE_PUEDE_APARTAR',
        `${num} no es un apartado cancelado: solo esos pueden volver a apartarse. ` +
        'Para apartar mercancía, hazlo desde el punto de venta.');
    }
    return;
  }
  if (!sinEntregar) return;

  if (estado === 'devuelto') {
    throw new AppError(409, 'APARTADO_NO_ENTREGADO',
      `${num} es un apartado que no se ha entregado: no hay nada que devolver. Cancélalo.`);
  }
  if (!INACTIVOS.includes(estado)) {
    throw estabaInactivo
      ? new AppError(409, 'REACTIVAR_COMO_APARTADO',
        `${num} era un apartado: se reactiva como "apartado", que vuelve a guardar la mercancía.`)
      : new AppError(409, 'APARTADO_SE_ENTREGA',
        `${num} es un apartado: se entrega desde Apartados, que exige que esté liquidado ` +
        'y descuenta el inventario.');
  }
}

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
      `SELECT estado, numero_pedido, almacen_id, sesion_caja_id, canal,
              inventario_descontado, total
         FROM pedidos WHERE id = :id FOR UPDATE`,
      { id }
    );
    if (!prev[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Pedido no encontrado');

    const pedido = prev[0];
    _validarCaminoApartado(pedido, estado);
    const { estado: antes, numero_pedido: numero, almacen_id: almacenId } = pedido;
    const eraInactivo = INACTIVOS.includes(antes);
    const esInactivo = INACTIVOS.includes(estado);

    // ---- La DEUDA, si la venta fue a crédito: al cancelar se quita, al
    // reactivar vuelve. Va con el resto del dinero y antes del inventario, por
    // la misma razón: que un 409 no deje nada movido a medias.
    if (eraInactivo !== esInactivo) {
      await clientesModel.ajustarCreditoPorPedido(conn, {
        pedidoId: id,
        numeroPedido: numero,
        usuarioId,
        revertir: esInactivo,
      });
    }

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
    // Un APARTADO nunca descontó del inventario: la mercancía se quedó en la
    // bodega, apartada. Cancelarlo solo LIBERA la reserva — reponerla
    // inventaría existencias fantasma, porque nunca salieron.
    //
    // `inventario_descontado` es lo que distingue los dos casos, y por eso
    // existe: sin ese dato habría que adivinarlo por el estado, y un apartado
    // ya entregado (que SÍ descontó) se trataría igual que uno vigente.
    if (antes === 'apartado' && esInactivo && almacenId) {
      const [lineas] = await conn.query(
        'SELECT variante_id, cantidad FROM pedido_detalle WHERE pedido_id = :id',
        { id }
      );
      for (const l of lineas) {
        await conn.query(
          `UPDATE inventario
              SET cantidad_reservada = GREATEST(0, cantidad_reservada - :cant)
            WHERE variante_id = :v AND almacen_id = :a`,
          { v: l.variante_id, a: almacenId, cant: l.cantidad }
        );
      }
      // El anticipo se le devuelve: es su dinero y la mercancía se queda en la
      // tienda. Sale del turno abierto como 'devolucion', igual que al cancelar
      // una venta de mostrador, y los pagos pasan a 'reembolsado'.
      // (Si la tienda quisiera RETENER el anticipo, eso es una decisión de
      // negocio distinta y tendría que capturarse aparte; aquí no se asume.)
    }

    // Reactivar un apartado cancelado: la mercancía se vuelve a apartar. No se
    // descuenta —sigue sin entregarse— así que solo se rehace la reserva.
    if (estado === 'apartado' && eraInactivo && almacenId) {
      const [lineas] = await conn.query(
        'SELECT variante_id, cantidad, descripcion FROM pedido_detalle WHERE pedido_id = :id',
        { id }
      );
      for (const l of lineas) {
        const [irows] = await conn.query(
          `SELECT cantidad, cantidad_reservada FROM inventario
            WHERE variante_id = :v AND almacen_id = :a FOR UPDATE`,
          { v: l.variante_id, a: almacenId }
        );
        const existe = irows[0] ? Number(irows[0].cantidad) : 0;
        const yaApartado = irows[0] ? Number(irows[0].cantidad_reservada) : 0;
        if (existe - yaApartado + 0.0001 < Number(l.cantidad)) {
          throw new AppError(409, 'STOCK_INSUFICIENTE',
            `Ya no se puede volver a apartar "${l.descripcion}": quedan ` +
            `${round3(existe - yaApartado)} disponibles y el apartado es de ${l.cantidad}.`);
        }
        await conn.query(
          `UPDATE inventario SET cantidad_reservada = cantidad_reservada + :cant
            WHERE variante_id = :v AND almacen_id = :a`,
          { v: l.variante_id, a: almacenId, cant: l.cantidad }
        );
      }
    }

    // La reposición normal: solo para pedidos que SÍ descontaron.
    if (eraInactivo !== esInactivo && almacenId && pedido.inventario_descontado) {
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

    // Un pedido en línea que se da por PAGADO a mano —el cliente pagó en
    // efectivo en el mostrador— tiene que dejar su pago como cobrado. Si no, el
    // pedido decía "pagado" y su pago seguía "pendiente": el detalle mostraba
    // que faltaba dinero y una captura del depósito después crearía otro pago.
    // Solo al salir de 'pendiente' hacia adelante; cancelar no lo toca.
    if (antes === 'pendiente' && POR_COBRADO.includes(estado) && pedido.canal === 'tienda_linea') {
      await conn.query(
        `UPDATE pagos SET estado = 'completado'
          WHERE pedido_id = :id AND estado IN ('pendiente', 'procesando')`,
        { id }
      );
    }

    // El UPDATE del estado va al final: si algo de arriba falló (p.ej. no hay
    // existencias para reactivar), el pedido no se mueve.
    await conn.query('UPDATE pedidos SET estado = :estado WHERE id = :id', { estado, id });

    return _obtenerConn(conn, id);
  });
}

/** Estados que dicen que el pedido ya se cobró. */
const POR_COBRADO = ['pagado', 'en_preparacion', 'enviado', 'entregado'];

/**
 * Lo que costaría el pedido, sin crearlo. Es lo que el checkout consulta para
 * mostrar el desglose antes de que el cliente confirme: mismo cálculo que la
 * venta, así que el total que ve es el que se le cobra.
 *
 * Corre dentro de una transacción de solo lectura y NO bloquea filas: cotizar
 * no debe frenar a la caja. Por eso el resultado es una foto del momento —si
 * el último paquete se vende entremedio, el que falla es el POST, con su
 * STOCK_INSUFICIENTE, que es donde debe fallar.
 */
async function cotizar(datos, { esCliente = false } = {}) {
  return withTransaction(async (conn) => {
    const c = await _cotizar(conn, datos, { bloquear: false, esCliente });
    return {
      metodo_entrega: c.metodoEntrega,
      direccion_envio_id: c.direccionId,
      almacen_id: c.almacenId,
      tipo_cliente_id: c.tipoClienteId,
      // El costo NO se le manda al cliente: es información interna del
      // negocio y el checkout no la necesita para nada.
      lineas: c.detalle.map(({ bultos, costo_unitario, ...d }) => d),
      subtotal: c.subtotal,
      descuento: c.descuento,
      impuestos: c.impuestos,
      costo_envio: c.costoEnvio,
      total: c.total,
      cupon: c.cupon ? { codigo: c.cupon.codigo, tipo: c.cupon.tipo, valor: c.cupon.valor } : null,
    };
  });
}


// ---------------------------------------------------------------------------
//  Comprobante de pago
//
//  La tienda en línea no cobra: el cliente deposita y le manda la captura al
//  administrador, que la sube aquí. Subirla es UN PASO —decisión del usuario el
//  2026-09-05—: el pago queda 'completado' y el pedido 'pagado' en la misma
//  transacción. No hay estado intermedio "por validar".
// ---------------------------------------------------------------------------

/** La carpeta donde viven las capturas. */
const CARPETA_COMPROBANTES = 'comprobantes';

/**
 * Guarda la captura del comprobante y da el pedido por pagado.
 *
 * El archivo se escribe en disco ANTES de abrir la transacción: si falla el
 * disco no se toca la base, y si falla la base queda un archivo huérfano que no
 * le estorba a nadie (nadie lo referencia) en vez de una fila apuntando a un
 * archivo que no existe.
 */
async function guardarComprobante(pedidoId, buf, nombreOriginal, usuarioId) {
  const guardado = await archivos.guardar(CARPETA_COMPROBANTES, buf);
  if (!guardado) {
    throw new AppError(422, 'ARCHIVO_INVALIDO',
      'La captura debe ser una imagen (JPG, PNG o WEBP) o un PDF.');
  }

  return withTransaction(async (conn) => {
    const [prows] = await conn.query(
      'SELECT id, numero_pedido, estado, total FROM pedidos WHERE id = :id FOR UPDATE',
      { id: pedidoId }
    );
    const pedido = prows[0];
    if (!pedido) {
      await archivos.borrar(CARPETA_COMPROBANTES, guardado.nombre);
      throw new AppError(404, 'NO_ENCONTRADO', 'Pedido no encontrado');
    }
    // Un pedido cancelado o devuelto no se marca pagado por subirle una captura:
    // si de verdad entró el dinero, primero hay que reactivarlo.
    if (INACTIVOS.includes(pedido.estado)) {
      await archivos.borrar(CARPETA_COMPROBANTES, guardado.nombre);
      throw new AppError(409, 'PEDIDO_INACTIVO',
        `${pedido.numero_pedido} está ${pedido.estado}. Reactívalo antes de registrar el pago.`);
    }

    // Un apartado se paga con ABONOS (Apartados → Abonar), que llevan la cuenta
    // de lo que falta. Pegarle una captura creaba un pago por el TOTAL, y el
    // apartado quedaba "liquidado" con dinero que nunca entró.
    if (pedido.estado === 'apartado') {
      await archivos.borrar(CARPETA_COMPROBANTES, guardado.nombre);
      throw new AppError(409, 'APARTADO_USA_ABONOS',
        `${pedido.numero_pedido} es un apartado: registra el depósito como un abono en ` +
        'Apartados, con el método Transferencia, para que cuente contra lo que falta.');
    }

    // A qué pago se le pega la captura, por orden de preferencia:
    //   1. el que YA tiene un comprobante  → se está reemplazando la captura;
    //   2. el que está esperando cobro     → se está registrando el pago;
    //   3. una transferencia ya cobrada    → solo se le adjunta la prueba;
    //   4. ninguno                         → se crea uno por lo que FALTA.
    // El paso 1 importa: sin él, subir una segunda captura creaba un pago NUEVO
    // (el primero ya estaba 'completado' y no lo encontraba), y el pedido
    // acababa con el doble de pagos registrados. Los pasos 3 y 4, por lo mismo:
    // en una venta ya cobrada se creaba otro pago por el total.
    const [pgrows] = await conn.query(
      `SELECT pg.id FROM pagos pg
         JOIN metodos_pago mp ON mp.id = pg.metodo_pago_id
        WHERE pg.pedido_id = :id
          AND (pg.comprobante_archivo IS NOT NULL
               OR pg.estado IN ('pendiente', 'procesando')
               OR (pg.estado = 'completado' AND LOWER(mp.nombre) LIKE '%transferencia%'))
        ORDER BY (pg.comprobante_archivo IS NOT NULL) DESC,
                 (pg.estado IN ('pendiente', 'procesando')) DESC, pg.id
        LIMIT 1 FOR UPDATE`,
      { id: pedidoId }
    );
    let pagoId = pgrows[0]?.id ?? null;

    if (!pagoId) {
      const cobrado = await _abonado(conn, pedidoId);
      const falta = round2(Number(pedido.total) - cobrado);
      if (falta <= 0.004) {
        await archivos.borrar(CARPETA_COMPROBANTES, guardado.nombre);
        throw new AppError(409, 'PEDIDO_YA_PAGADO',
          `${pedido.numero_pedido} ya está cobrado completo y no tiene un pago por ` +
          'transferencia al cual pegar la captura.');
      }
      const [mrows] = await conn.query(
        `SELECT id FROM metodos_pago
          WHERE activo = 1 AND LOWER(nombre) LIKE '%transferencia%' LIMIT 1`
      );
      if (!mrows[0]) {
        await archivos.borrar(CARPETA_COMPROBANTES, guardado.nombre);
        throw new AppError(422, 'SIN_METODO_PAGO',
          'No hay un método de pago "Transferencia" activo al cual registrar el comprobante.');
      }
      const [ins] = await conn.query(
        `INSERT INTO pagos (pedido_id, metodo_pago_id, monto, estado)
         VALUES (:pedido, :metodo, :monto, 'pendiente')`,
        { pedido: pedidoId, metodo: mrows[0].id, monto: falta }
      );
      pagoId = ins.insertId;
    }

    // Reemplazar la captura borra la anterior: si no, el disco se llena de
    // archivos que ya nadie referencia.
    const [anterior] = await conn.query(
      'SELECT comprobante_archivo FROM pagos WHERE id = :id',
      { id: pagoId }
    );
    const archivoViejo = anterior[0]?.comprobante_archivo ?? null;

    await conn.query(
      `UPDATE pagos SET
          comprobante_archivo = :archivo,
          comprobante_nombre = :nombre,
          comprobante_tipo = :tipo,
          comprobante_subido_en = NOW(),
          comprobante_subido_por = :usuario,
          estado = 'completado'
        WHERE id = :id`,
      {
        id: pagoId,
        archivo: guardado.nombre,
        // El nombre original solo se muestra y se usa al descargar; se recorta
        // para que quepa en la columna.
        nombre: (nombreOriginal || 'comprobante').slice(0, 255),
        tipo: guardado.tipo,
        usuario: usuarioId ?? null,
      }
    );

    // Y el pedido queda pagado. De 'pendiente' a 'pagado' no se mueve
    // inventario ni caja —ambos son estados activos— así que basta el UPDATE;
    // `cambiarEstado` solo actúa al cruzar la frontera activo/inactivo.
    if (pedido.estado === 'pendiente') {
      await conn.query("UPDATE pedidos SET estado = 'pagado' WHERE id = :id", { id: pedidoId });
    }

    if (archivoViejo) await archivos.borrar(CARPETA_COMPROBANTES, archivoViejo);

    return _obtenerConn(conn, pedidoId);
  });
}

/**
 * El archivo del comprobante de un pedido, para servirlo. Devuelve
 * `{ buf, tipo, nombre }` o `null` si el pedido no tiene o el archivo ya no
 * está en disco.
 */
async function leerComprobante(pedidoId) {
  const [rows] = await pool.query(
    `SELECT comprobante_archivo, comprobante_nombre, comprobante_tipo
       FROM pagos
      WHERE pedido_id = :id AND comprobante_archivo IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    { id: pedidoId }
  );
  const pago = rows[0];
  if (!pago) return null;

  const buf = await archivos.leer(CARPETA_COMPROBANTES, pago.comprobante_archivo);
  if (!buf) return null;
  return { buf, tipo: pago.comprobante_tipo, nombre: pago.comprobante_nombre };
}

/**
 * Quita la captura. NO revierte el pago ni el estado del pedido: se borra
 * cuando se subió la equivocada, y eso no significa que el dinero no haya
 * entrado. Para deshacer el cobro está el cambio de estado.
 */
async function borrarComprobante(pedidoId) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, comprobante_archivo FROM pagos
        WHERE pedido_id = :id AND comprobante_archivo IS NOT NULL
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      { id: pedidoId }
    );
    const pago = rows[0];
    if (!pago) throw new AppError(404, 'SIN_COMPROBANTE', 'Este pedido no tiene comprobante');

    await conn.query(
      `UPDATE pagos SET comprobante_archivo = NULL, comprobante_nombre = NULL,
              comprobante_tipo = NULL, comprobante_subido_en = NULL,
              comprobante_subido_por = NULL
        WHERE id = :id`,
      { id: pago.id }
    );
    await archivos.borrar(CARPETA_COMPROBANTES, pago.comprobante_archivo);
    return _obtenerConn(conn, pedidoId);
  });
}

// ---------------------------------------------------------------------------
//  Apartados
// ---------------------------------------------------------------------------

/** Cuánto lleva pagado un pedido. Solo los pagos COMPLETADOS cuentan. */
async function _abonado(conn, pedidoId) {
  const [[r]] = await conn.query(
    `SELECT COALESCE(SUM(monto), 0) AS abonado FROM pagos
      WHERE pedido_id = :id AND estado = 'completado'`,
    { id: pedidoId }
  );
  return round2(r.abonado);
}

/**
 * Registra un abono a un apartado.
 *
 * Si el abono es en EFECTIVO tiene que entrar a un turno de caja abierto: si
 * no, el corte no cuadraría —hay dinero en el cajón que ninguna venta
 * explica— y el cajero aparecería con un sobrante inexplicable. Entra como
 * 'ingreso' y no como 'venta', porque la venta ya se contó el día que se
 * apartó: contarla otra vez duplicaría las ventas del día.
 */
async function abonarApartado(pedidoId, datos, usuarioId) {
  return withTransaction(async (conn) => {
    const [prows] = await conn.query(
      'SELECT id, numero_pedido, estado, total FROM pedidos WHERE id = :id FOR UPDATE',
      { id: pedidoId }
    );
    const pedido = prows[0];
    if (!pedido) throw new AppError(404, 'NO_ENCONTRADO', 'Pedido no encontrado');
    if (pedido.estado !== 'apartado') {
      throw new AppError(409, 'NO_ES_APARTADO',
        `${pedido.numero_pedido} no es un apartado vigente (está ${pedido.estado}).`);
    }

    const monto = round2(datos.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      throw new AppError(422, 'MONTO_INVALIDO', 'El abono debe ser mayor a cero');
    }

    const abonado = await _abonado(conn, pedidoId);
    const pendiente = round2(Number(pedido.total) - abonado);
    if (monto > pendiente + 0.0001) {
      throw new AppError(422, 'ABONO_EXCEDE_PENDIENTE',
        `Le faltan $${pendiente.toFixed(2)} y el abono es de $${monto.toFixed(2)}.`);
    }

    // ¿Entra al cajón? Lo decide el nombre del método, como en la venta.
    let esEfectivo = false;
    const [mrows] = await conn.query(
      'SELECT nombre, activo FROM metodos_pago WHERE id = :id LIMIT 1',
      { id: datos.metodo_pago_id }
    );
    if (!mrows[0] || !mrows[0].activo) {
      throw new AppError(422, 'METODO_PAGO_INVALIDO',
        'Ese método de pago no existe o está inactivo');
    }
    esEfectivo = mrows[0].nombre.toLowerCase().includes('efectivo');

    let sesionId = datos.sesion_caja_id ?? null;
    if (esEfectivo) {
      // Se valida ANTES de registrar el pago, para que un 409 no deje el abono
      // asentado y el dinero fuera del corte.
      if (!sesionId) {
        throw new AppError(409, 'FALTA_SESION_CAJA',
          'Un abono en efectivo tiene que entrar en un turno de caja abierto, ' +
          'o el corte no va a cuadrar.');
      }
      const [srows] = await conn.query(
        'SELECT id, estado FROM sesiones_caja WHERE id = :id FOR UPDATE',
        { id: sesionId }
      );
      if (!srows[0]) throw new AppError(404, 'SESION_NO_ENCONTRADA', 'Sesión de caja no encontrada');
      if (srows[0].estado !== 'abierta') {
        throw new AppError(409, 'CAJA_CERRADA', 'La sesión de caja está cerrada');
      }
    } else {
      sesionId = null;
    }

    await conn.query(
      `INSERT INTO pagos (pedido_id, metodo_pago_id, monto, estado, referencia_transaccion)
       VALUES (:pedido, :metodo, :monto, 'completado', :ref)`,
      {
        pedido: pedidoId,
        metodo: datos.metodo_pago_id,
        monto,
        ref: datos.referencia ?? null,
      }
    );

    if (esEfectivo) {
      await conn.query(
        `INSERT INTO movimientos_caja (sesion_caja_id, tipo, monto, referencia_id, motivo)
         VALUES (:sesion, 'ingreso', :monto, :pedido, :motivo)`,
        {
          sesion: sesionId,
          monto,
          pedido: pedidoId,
          motivo: `Abono al apartado ${pedido.numero_pedido}`,
        }
      );
    }

    const nuevoAbonado = round2(abonado + monto);
    const nuevoPendiente = round2(Number(pedido.total) - nuevoAbonado);
    return {
      pedido_id: pedidoId,
      numero_pedido: pedido.numero_pedido,
      total: round2(pedido.total),
      abonado: nuevoAbonado,
      pendiente: nuevoPendiente,
      // Ya lo pagó todo: se puede entregar.
      liquidado: nuevoPendiente <= 0.0001,
    };
  });
}

/**
 * Entrega la mercancía de un apartado: AQUÍ es donde por fin se descuenta del
 * inventario y se libera la reserva.
 *
 * Exige que esté LIQUIDADO. Entregar un apartado a medio pagar sería regalar
 * mercancía: si la tienda quiere hacerlo, lo que corresponde es fiar el resto
 * (otra operación, que sí deja constancia de la deuda).
 *
 * El descuento EXIGE existencias: entre que se apartó y hoy pudo pasar
 * cualquier cosa —una merma, un traspaso que se llevó lo apartado— y entregar
 * dejaría el inventario en negativo.
 */
async function entregarApartado(pedidoId, usuarioId) {
  return withTransaction(async (conn) => {
    const [prows] = await conn.query(
      `SELECT id, numero_pedido, estado, total, almacen_id, inventario_descontado
         FROM pedidos WHERE id = :id FOR UPDATE`,
      { id: pedidoId }
    );
    const pedido = prows[0];
    if (!pedido) throw new AppError(404, 'NO_ENCONTRADO', 'Pedido no encontrado');
    if (pedido.estado !== 'apartado') {
      throw new AppError(409, 'NO_ES_APARTADO',
        `${pedido.numero_pedido} no es un apartado vigente (está ${pedido.estado}).`);
    }

    const abonado = await _abonado(conn, pedidoId);
    const pendiente = round2(Number(pedido.total) - abonado);
    if (pendiente > 0.0001) {
      throw new AppError(409, 'APARTADO_NO_LIQUIDADO',
        `Le faltan $${pendiente.toFixed(2)} por pagar. Cóbralos antes de entregar, ` +
        'o véndeselo a crédito si se lo va a llevar debiendo.');
    }

    const [det] = await conn.query(
      'SELECT variante_id, cantidad, descripcion FROM pedido_detalle WHERE pedido_id = :id',
      { id: pedidoId }
    );

    for (const d of det) {
      // Se bloquea la fila y se comprueba que la mercancía siga ahí.
      const [irows] = await conn.query(
        `SELECT cantidad, cantidad_reservada FROM inventario
          WHERE variante_id = :v AND almacen_id = :a FOR UPDATE`,
        { v: d.variante_id, a: pedido.almacen_id }
      );
      const existe = irows[0] ? Number(irows[0].cantidad) : 0;
      if (existe + 0.0001 < Number(d.cantidad)) {
        throw new AppError(409, 'STOCK_INSUFICIENTE',
          `Ya no hay suficiente de "${d.descripcion}": quedan ${existe} y el apartado ` +
          `es de ${d.cantidad}. Revisa el inventario antes de entregar.`);
      }

      // Sale del inventario y se libera lo apartado, todo de un golpe. El
      // GREATEST evita dejar la reserva en negativo si alguien la liberó por
      // fuera (un ajuste manual, por ejemplo).
      await conn.query(
        `UPDATE inventario
            SET cantidad = cantidad - :cant,
                cantidad_reservada = GREATEST(0, cantidad_reservada - :cant)
          WHERE variante_id = :v AND almacen_id = :a`,
        { v: d.variante_id, a: pedido.almacen_id, cant: d.cantidad }
      );
      await conn.query(
        `INSERT INTO movimientos_inventario
           (variante_id, almacen_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id, motivo)
         VALUES (:v, :a, 'salida', :cant, 'pedido', :pedido, :usuario, :motivo)`,
        {
          v: d.variante_id,
          a: pedido.almacen_id,
          cant: -d.cantidad,
          pedido: pedidoId,
          usuario: usuarioId ?? null,
          motivo: `Entrega del apartado ${pedido.numero_pedido}`,
        }
      );
    }

    await conn.query(
      `UPDATE pedidos
          SET estado = 'entregado', inventario_descontado = 1, entregado_en = NOW()
        WHERE id = :id`,
      { id: pedidoId }
    );

    return _obtenerConn(conn, pedidoId);
  });
}

/** Los apartados vigentes, con lo que llevan pagado. */
async function listarApartados({ cliente_id, orden } = {}) {
  const where = [];
  const params = {};
  if (cliente_id) {
    where.push('cliente_id = :cliente_id');
    params.cliente_id = cliente_id;
  }
  const ORDENES = {
    // Los que están a punto de liquidar: son los que hay que llamar.
    por_liquidar: 'pct_pagado DESC, pendiente',
    antiguos: 'dias_apartado DESC',
    monto: 'total DESC',
  };
  const orderBy = ORDENES[orden] || ORDENES.antiguos;

  const [rows] = await pool.query(
    `SELECT * FROM v_apartados
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${orderBy}`,
    params
  );

  // Qué se guardó y cuántos kilos (rediseño 2026-10): la pantalla dice "NEGRO
  // 2/30 · 3 paquetes" y cuánta mercancía de la bodega ya tiene dueño. Solo
  // lectura, en una consulta aparte para no tocar la vista.
  for (const r of rows) { r.hilos = []; r.kg = 0; }
  let kgApartado = 0;
  if (rows.length) {
    const [lineas] = await pool.query(
      `SELECT d.pedido_id, d.cantidad, pr.nombre AS producto, pr.grosor_calibre AS calibre,
              pv.tipo_presentacion, pv.peso_kg
         FROM pedido_detalle d
         JOIN producto_variantes pv ON pv.id = d.variante_id
         JOIN productos pr          ON pr.id = pv.producto_id
        WHERE d.pedido_id IN (:ids)
        ORDER BY d.id`,
      { ids: rows.map((r) => r.pedido_id) }
    );
    const porPedido = new Map(rows.map((r) => [r.pedido_id, r]));
    for (const l of lineas) {
      const r = porPedido.get(l.pedido_id);
      if (!r) continue;
      const kg = Number(l.cantidad);
      // Cuántos paquetes son, con el peso de referencia de la presentación.
      // Es aproximado (cada bulto pesa distinto) y por eso se redondea.
      const pesoPaquete = Number(l.peso_kg);
      const paquetes = l.tipo_presentacion === 'paquete' && pesoPaquete > 0
        ? Math.max(1, Math.round(kg / pesoPaquete))
        : null;
      r.hilos.push({
        hilo: `${l.producto}${l.calibre ? ' ' + l.calibre : ''}`,
        tipo_presentacion: l.tipo_presentacion,
        kg: round3(kg),
        paquetes,
      });
      r.kg = round3(r.kg + kg);
      kgApartado += kg;
    }
  }
  return {
    items: rows,
    num_apartados: rows.length,
    kg_apartado: round3(kgApartado),
    // Cuánto dinero de la tienda está comprometido en mercancía guardada.
    total_apartado: round2(rows.reduce((s, r) => s + Number(r.total), 0)),
    // Y cuánto han dejado ya.
    total_abonado: round2(rows.reduce((s, r) => s + Number(r.abonado), 0)),
  };
}

/**
 * Las cifras de arriba de la pantalla Pedidos. En "por cobrar", `ventas` es en
 * realidad el número de CLIENTES que deben (ver abajo).
 */
async function resumen() {
  const vivo = "estado NOT IN ('cancelado', 'devuelto')";
  const [[hoy]] = await pool.query(
    `SELECT COUNT(*) AS ventas, COALESCE(SUM(total), 0) AS total FROM pedidos
      WHERE ${vivo} AND DATE(creado_en) = CURDATE()`
  );
  const [[semana]] = await pool.query(
    `SELECT COUNT(*) AS ventas, COALESCE(SUM(total), 0) AS total FROM pedidos
      WHERE ${vivo} AND creado_en >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)`
  );
  // Lo fiado se debe en la CUENTA del cliente, no en cada venta: los abonos se
  // aplican al saldo, así que una venta fiada sigue "pendiente" aunque el
  // cliente ya haya pagado. Lo que de verdad se debe es el saldo de las cuentas.
  const [[fiado]] = await pool.query(
    `SELECT COUNT(*) AS ventas, COALESCE(SUM(saldo), 0) AS monto FROM v_clientes_saldo WHERE saldo > 0`
  );
  const [[canceladas]] = await pool.query(
    `SELECT COUNT(*) AS ventas, COALESCE(SUM(total), 0) AS total FROM pedidos
      WHERE estado IN ('cancelado', 'devuelto') AND creado_en >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`
  );
  const n = (x) => ({ ventas: Number(x.ventas), total: round2(Number(x.total ?? x.monto)) });
  return { hoy: n(hoy), semana: n(semana), por_cobrar: n(fiado), canceladas_mes: n(canceladas) };
}

module.exports = {
  resumen,
  crearPedido, cotizar, obtener, listar, cambiarEstado,
  guardarComprobante, leerComprobante, borrarComprobante,
  abonarApartado, entregarApartado, listarApartados,
  ESTADOS, METODOS_ENTREGA,
};
