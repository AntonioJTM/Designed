'use strict';

const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');

// Acceso a datos de la tabla `clientes`.
//
// La tabla tiene DOS vidas y hay que tenerlo presente al tocarla:
//   · CUENTA de la tienda en línea: correo + contrasena_hash, se registra
//     el cliente solo y entra a ver sus pedidos.
//   · EXPEDIENTE de mostrador: lo captura el personal, no tiene cuenta —
//     `correo` y `contrasena_hash` quedan en NULL— y sirve para saber qué
//     le vendes a quién, cuánto te debe y qué colores se lleva.
// Es la misma fila: un cliente de años puede abrirse cuenta después y no
// hay que duplicarlo.

const CAMPOS_PUBLICOS = `
  id, nombre, correo, telefono, acepta_marketing, activo, creado_en, actualizado_en
`;

// El expediente completo, como lo ve el personal.
const CAMPOS_EXPEDIENTE = `
  c.id, c.codigo, c.nombre, c.nombre_comercial, c.rfc, c.tipo_cliente_id,
  c.correo, c.telefono, c.telefono_alt, c.direccion, c.ciudad, c.estado,
  c.como_llego, DATE_FORMAT(c.fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento,
  DATE_FORMAT(c.cliente_desde, '%Y-%m-%d') AS cliente_desde,
  c.limite_credito, c.notas, c.activo, c.creado_en, c.actualizado_en,
  (c.contrasena_hash IS NOT NULL) AS tiene_cuenta
`;

// Los pedidos que NO cuentan para el historial ni para los totales.
const ESTADOS_MUERTOS = "('cancelado', 'devuelto')";

/** Busca un cliente por correo incluyendo el hash (solo para login). */
async function buscarPorCorreoConHash(correo) {
  const [rows] = await pool.query(
    `SELECT id, nombre, correo, telefono, contrasena_hash, acepta_marketing,
            activo, creado_en, actualizado_en
       FROM clientes
      WHERE correo = :correo
      LIMIT 1`,
    { correo }
  );
  return rows[0] || null;
}

/** Devuelve un cliente por id sin datos sensibles. */
async function buscarPorId(id) {
  const [rows] = await pool.query(
    `SELECT ${CAMPOS_PUBLICOS} FROM clientes WHERE id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

/** Inserta un cliente y devuelve el registro público recién creado. */
async function crear({ nombre, correo, telefono, contrasena_hash, acepta_marketing }) {
  const [result] = await pool.query(
    `INSERT INTO clientes (nombre, correo, telefono, contrasena_hash, acepta_marketing,
                           cliente_desde)
     VALUES (:nombre, :correo, :telefono, :contrasena_hash, :acepta_marketing, CURDATE())`,
    {
      nombre,
      correo,
      telefono: telefono ?? null,
      contrasena_hash,
      acepta_marketing: acepta_marketing ? 1 : 0,
    }
  );
  return buscarPorId(result.insertId);
}

// ---------------------------------------------------------------------------
//  El expediente: lo que usa el personal
// ---------------------------------------------------------------------------

/**
 * Listado con búsqueda. Trae el saldo de cada uno porque el listado tiene que
 * poder ordenarse por quién debe: es la pregunta que se hace todos los días.
 *
 * `q` busca en nombre, apodo, código y los dos teléfonos. Un cliente se busca
 * por como le dicen o por su número, casi nunca por su nombre completo.
 */
async function listar({ q, con_saldo, activo, orden, limit, offset } = {}) {
  const where = [];
  const params = { limit, offset };

  if (q) {
    where.push(`(c.nombre LIKE :q OR c.nombre_comercial LIKE :q OR c.codigo LIKE :q
                 OR c.telefono LIKE :q OR c.telefono_alt LIKE :q OR c.correo LIKE :q)`);
    params.q = `%${q}%`;
  }
  if (activo !== undefined) {
    where.push('c.activo = :activo');
    params.activo = activo ? 1 : 0;
  }
  // Solo los que deben. Va en el WHERE y NO en un HAVING: `s.saldo` viene del
  // LEFT JOIN a la vista, así que ya es un valor —no un agregado de ESTA
  // consulta— y un HAVING no lo alcanza si no está en el SELECT.
  if (con_saldo) where.push('COALESCE(s.saldo, 0) > 0');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const ORDENES = {
    nombre: 'c.nombre',
    saldo: 'saldo DESC',
    // Quién compra más. Lo que la tienda quiere ver para atender mejor.
    compras: 'total_comprado DESC',
    // Quién no ha vuelto. NULL primero sería ruido: van al final.
    reciente: 'ultima_compra IS NULL, ultima_compra DESC',
    nuevo: 'c.id DESC',
  };
  const orderBy = ORDENES[orden] || ORDENES.nombre;

  const sql = `
    SELECT ${CAMPOS_EXPEDIENTE},
           tc.nombre AS tipo_cliente,
           COALESCE(s.saldo, 0) AS saldo,
           COALESCE(s.disponible, c.limite_credito) AS credito_disponible,
           COALESCE(v.num_pedidos, 0) AS num_pedidos,
           COALESCE(v.total_comprado, 0) AS total_comprado,
           v.ultima_compra
      FROM clientes c
      LEFT JOIN tipos_cliente tc ON tc.id = c.tipo_cliente_id
      LEFT JOIN v_clientes_saldo s ON s.cliente_id = c.id
      LEFT JOIN (
        SELECT cliente_id,
               COUNT(*) AS num_pedidos,
               SUM(total) AS total_comprado,
               MAX(creado_en) AS ultima_compra
          FROM pedidos
         WHERE cliente_id IS NOT NULL AND estado NOT IN ${ESTADOS_MUERTOS}
         GROUP BY cliente_id
      ) v ON v.cliente_id = c.id
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT :limit OFFSET :offset`;

  const [rows] = await pool.query(sql, params);

  // El total se cuenta aparte, con el MISMO where. El join a la vista se
  // mantiene siempre: si `con_saldo` filtra por `s.saldo`, sin el join la
  // columna no existiría.
  const { limit: _l, offset: _o, ...paramsConteo } = params;
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM clientes c
       LEFT JOIN v_clientes_saldo s ON s.cliente_id = c.id
       ${whereSql}`,
    paramsConteo
  );

  return { rows, total: Number(total) };
}

/** El expediente de un cliente, sin historial (eso va aparte). */
async function obtener(id) {
  const [rows] = await pool.query(
    `SELECT ${CAMPOS_EXPEDIENTE},
            tc.nombre AS tipo_cliente,
            COALESCE(s.saldo, 0) AS saldo,
            COALESCE(s.cargos, 0) AS cargos,
            COALESCE(s.abonos, 0) AS abonos,
            COALESCE(s.disponible, c.limite_credito) AS credito_disponible,
            s.ultimo_abono
       FROM clientes c
       LEFT JOIN tipos_cliente tc ON tc.id = c.tipo_cliente_id
       LEFT JOIN v_clientes_saldo s ON s.cliente_id = c.id
      WHERE c.id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

/**
 * Búsqueda rápida para el mostrador. Devuelve pocos campos y pocos resultados:
 * es para teclear tres letras y elegir, no para analizar.
 *
 * Trae el saldo y el crédito disponible porque el cajero necesita saber, EN EL
 * MOMENTO de elegirlo, si a esta persona se le puede fiar.
 */
async function buscarParaVenta(q, limite = 10) {
  const [rows] = await pool.query(
    `SELECT c.id, c.codigo, c.nombre, c.nombre_comercial, c.telefono,
            c.tipo_cliente_id, tc.nombre AS tipo_cliente,
            c.limite_credito,
            COALESCE(s.saldo, 0) AS saldo,
            COALESCE(s.disponible, c.limite_credito) AS credito_disponible
       FROM clientes c
       LEFT JOIN tipos_cliente tc ON tc.id = c.tipo_cliente_id
       LEFT JOIN v_clientes_saldo s ON s.cliente_id = c.id
      WHERE c.activo = 1
        AND (c.nombre LIKE :q OR c.nombre_comercial LIKE :q OR c.codigo LIKE :q
             OR c.telefono LIKE :q OR c.telefono_alt LIKE :q)
      ORDER BY c.nombre
      LIMIT :limite`,
    { q: `%${q}%`, limite }
  );
  return rows;
}

/** Alta desde el panel o el mostrador: sin cuenta, sin contraseña. */
async function crearDesdeStaff(datos) {
  const [r] = await pool.query(
    `INSERT INTO clientes
       (codigo, nombre, nombre_comercial, rfc, tipo_cliente_id, correo, telefono,
        telefono_alt, direccion, ciudad, estado, como_llego, fecha_nacimiento,
        cliente_desde, limite_credito, notas, activo)
     VALUES
       (:codigo, :nombre, :nombre_comercial, :rfc, :tipo_cliente_id, :correo, :telefono,
        :telefono_alt, :direccion, :ciudad, :estado, :como_llego, :fecha_nacimiento,
        :cliente_desde, :limite_credito, :notas, :activo)`,
    datos
  );
  return obtener(r.insertId);
}

async function actualizar(id, datos) {
  await pool.query(
    `UPDATE clientes SET
        codigo = :codigo, nombre = :nombre, nombre_comercial = :nombre_comercial,
        rfc = :rfc, tipo_cliente_id = :tipo_cliente_id, correo = :correo,
        telefono = :telefono, telefono_alt = :telefono_alt, direccion = :direccion,
        ciudad = :ciudad, estado = :estado, como_llego = :como_llego,
        fecha_nacimiento = :fecha_nacimiento, cliente_desde = :cliente_desde,
        limite_credito = :limite_credito, notas = :notas, activo = :activo
      WHERE id = :id`,
    { ...datos, id }
  );
  return obtener(id);
}

/** ¿Ya está usado ese código o ese correo por OTRO cliente? */
async function duplicado({ codigo, correo, exceptoId }) {
  const [rows] = await pool.query(
    `SELECT id, codigo, correo FROM clientes
      WHERE id <> :excepto
        AND ((:codigo IS NOT NULL AND codigo = :codigo)
          OR (:correo IS NOT NULL AND correo = :correo))
      LIMIT 1`,
    { codigo: codigo || null, correo: correo || null, excepto: exceptoId ?? 0 }
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
//  Lo que el cliente ha comprado
// ---------------------------------------------------------------------------

/**
 * Resumen de compras. Los cancelados y devueltos NO cuentan: preguntarle al
 * sistema "cuánto me ha comprado" y que incluya lo que devolvió sería mentir.
 */
async function estadisticas(id) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS num_pedidos,
            COALESCE(SUM(total), 0) AS total_comprado,
            -- Sin ROUND, AVG devuelve 6 decimales y la pantalla mostraría
            -- "$1,234.567890" como ticket promedio.
            ROUND(COALESCE(AVG(total), 0), 2) AS ticket_promedio,
            MIN(creado_en) AS primera_compra,
            MAX(creado_en) AS ultima_compra,
            -- COALESCE porque SUM sobre cero filas es NULL, y "null pedidos
            -- de mostrador" se lee como un dato faltante en vez de un cero.
            COALESCE(SUM(canal = 'punto_venta'), 0) AS pedidos_mostrador,
            COALESCE(SUM(canal = 'tienda_linea'), 0) AS pedidos_linea
       FROM pedidos
      WHERE cliente_id = :id AND estado NOT IN ${ESTADOS_MUERTOS}`,
    { id }
  );

  // Los kilos van aparte: viven en el detalle, no en el pedido.
  const [[k]] = await pool.query(
    `SELECT COALESCE(SUM(d.cantidad), 0) AS kilos
       FROM pedido_detalle d
       JOIN pedidos p ON p.id = d.pedido_id
      WHERE p.cliente_id = :id AND p.estado NOT IN ${ESTADOS_MUERTOS}`,
    { id }
  );

  // Y lo que canceló o devolvió, que también dice algo del cliente.
  const [[dev]] = await pool.query(
    `SELECT COUNT(*) AS num_devueltos, COALESCE(SUM(total), 0) AS total_devuelto
       FROM pedidos
      WHERE cliente_id = :id AND estado IN ${ESTADOS_MUERTOS}`,
    { id }
  );

  return { ...r, kilos: k.kilos, ...dev };
}

/**
 * Qué colores compra más. Se agrupa por `producto_id` y NO por nombre: el mismo
 * color en dos calibres son dos productos distintos y agruparlos por nombre los
 * sumaría en un renglón que no existe.
 */
async function coloresMasComprados(id, limite = 10) {
  const [rows] = await pool.query(
    `SELECT p.id AS producto_id, p.nombre AS color, p.grosor_calibre AS calibre,
            cat.nombre AS material, l.nombre AS linea,
            SUM(d.cantidad) AS kilos,
            SUM(d.subtotal) AS importe,
            COUNT(DISTINCT ped.id) AS veces,
            MAX(ped.creado_en) AS ultima_vez
       FROM pedido_detalle d
       JOIN pedidos ped            ON ped.id = d.pedido_id
       JOIN producto_variantes pv  ON pv.id = d.variante_id
       JOIN productos p            ON p.id = pv.producto_id
       LEFT JOIN categorias cat    ON cat.id = p.categoria_id
       LEFT JOIN lineas l          ON l.id = p.linea_id
      WHERE ped.cliente_id = :id AND ped.estado NOT IN ${ESTADOS_MUERTOS}
      GROUP BY p.id, p.nombre, p.grosor_calibre, cat.nombre, l.nombre
      ORDER BY kilos DESC
      LIMIT :limite`,
    { id, limite }
  );
  return rows;
}

/** Sus pedidos, lo más reciente primero. */
async function pedidos(id, { limit = 20, offset = 0 } = {}) {
  const [rows] = await pool.query(
    `SELECT p.id, p.numero_pedido, p.canal, p.metodo_entrega, p.estado,
            p.subtotal, p.descuento, p.impuestos, p.costo_envio, p.total,
            p.creado_en, u.nombre AS atendio,
            (SELECT COUNT(*) FROM pedido_detalle d WHERE d.pedido_id = p.id) AS num_lineas
       FROM pedidos p
       LEFT JOIN usuarios u ON u.id = p.usuario_id
      WHERE p.cliente_id = :id
      ORDER BY p.creado_en DESC, p.id DESC
      LIMIT :limit OFFSET :offset`,
    { id, limit, offset }
  );
  const [[{ total }]] = await pool.query(
    'SELECT COUNT(*) AS total FROM pedidos WHERE cliente_id = :id',
    { id }
  );
  return { rows, total: Number(total) };
}

// ---------------------------------------------------------------------------
//  Crédito
// ---------------------------------------------------------------------------

/** El signo con que cada movimiento afecta la deuda. */
const SIGNO_CREDITO = { cargo: 1, abono: -1, ajuste: 1 };

/**
 * Saldo del cliente, bloqueando sus movimientos si se pide.
 *
 * `bloquear` es para la venta a crédito: sin el FOR UPDATE, dos cajas podrían
 * comprobar el límite a la vez y las dos pasarían, dejando al cliente por
 * encima de lo que se le fía.
 */
async function saldo(clienteId, ejecutor = pool, bloquear = false) {
  const [rows] = await ejecutor.query(
    `SELECT tipo, monto FROM credito_movimientos
      WHERE cliente_id = :id ${bloquear ? 'FOR UPDATE' : ''}`,
    { id: clienteId }
  );
  const total = rows.reduce((s, m) => s + SIGNO_CREDITO[m.tipo] * Number(m.monto), 0);
  return Math.round(total * 100) / 100;
}

/** Los movimientos de crédito de un cliente, con el saldo corriente. */
async function movimientosCredito(clienteId, { limit = 50, offset = 0 } = {}) {
  const [rows] = await pool.query(
    `SELECT m.id, m.tipo, m.monto, m.referencia, m.notas, m.creado_en,
            m.pedido_id, p.numero_pedido,
            m.metodo_pago_id, mp.nombre AS metodo_pago,
            m.sesion_caja_id, u.nombre AS registro
       FROM credito_movimientos m
       LEFT JOIN pedidos p       ON p.id = m.pedido_id
       LEFT JOIN metodos_pago mp ON mp.id = m.metodo_pago_id
       LEFT JOIN usuarios u      ON u.id = m.usuario_id
      WHERE m.cliente_id = :id
      ORDER BY m.creado_en DESC, m.id DESC
      LIMIT :limit OFFSET :offset`,
    { id: clienteId, limit, offset }
  );
  const [[{ total }]] = await pool.query(
    'SELECT COUNT(*) AS total FROM credito_movimientos WHERE cliente_id = :id',
    { id: clienteId }
  );
  return { rows, total: Number(total) };
}

/**
 * Inserta un movimiento de crédito. Acepta un `ejecutor` para poder registrar
 * el cargo DENTRO de la transacción de la venta: si la venta se revierte, la
 * deuda no queda.
 */
async function agregarMovimiento(datos, ejecutor = pool) {
  const [r] = await ejecutor.query(
    `INSERT INTO credito_movimientos
       (cliente_id, tipo, monto, pedido_id, metodo_pago_id, sesion_caja_id,
        referencia, notas, usuario_id)
     VALUES
       (:cliente_id, :tipo, :monto, :pedido_id, :metodo_pago_id, :sesion_caja_id,
        :referencia, :notas, :usuario_id)`,
    {
      pedido_id: null,
      metodo_pago_id: null,
      sesion_caja_id: null,
      referencia: null,
      notas: null,
      usuario_id: null,
      ...datos,
    }
  );
  return r.insertId;
}

/**
 * Registra un abono del cliente, en UNA transacción.
 *
 * Si el abono es en EFECTIVO tiene que entrar también a la caja: si no, el
 * corte no cuadraría —hay dinero en el cajón que ninguna venta explica— y el
 * cajero aparecería con un sobrante que nadie sabe de dónde salió. Entra como
 * `'ingreso'` y no como `'venta'` para que no lo cuenten los reportes de
 * ventas: cobrar una deuda vieja no es vender hoy.
 *
 * Los demás métodos (transferencia, tarjeta) no pasan por el cajón, así que
 * solo bajan el saldo.
 */
async function registrarAbono(clienteId, datos, usuarioId) {
  return withTransaction(async (conn) => {
    // Se revalida el saldo con las filas bloqueadas: entre que la pantalla lo
    // leyó y el cajero confirmó, pudo entrar otro abono o una venta a crédito.
    const saldoActual = await saldo(clienteId, conn, true);
    if (saldoActual <= 0) {
      throw new AppError(409, 'SIN_DEUDA', 'Ese cliente ya no tiene saldo pendiente.');
    }
    if (Number(datos.monto) > saldoActual + 0.001) {
      throw new AppError(422, 'ABONO_EXCEDE_DEUDA',
        `El abono ($${Number(datos.monto).toFixed(2)}) es mayor a lo que debe ` +
        `ahora ($${saldoActual.toFixed(2)}).`);
    }

    // ¿Entra al cajón? Lo decide el nombre del método, como en la venta.
    let esEfectivo = false;
    if (datos.metodo_pago_id) {
      const [mrows] = await conn.query(
        'SELECT nombre, activo FROM metodos_pago WHERE id = :id LIMIT 1',
        { id: datos.metodo_pago_id }
      );
      if (!mrows[0] || !mrows[0].activo) {
        throw new AppError(422, 'METODO_PAGO_INVALIDO',
          'Ese método de pago no existe o está inactivo');
      }
      esEfectivo = mrows[0].nombre.toLowerCase().includes('efectivo');
    }

    let sesionId = datos.sesion_caja_id ?? null;
    if (esEfectivo) {
      // Con el turno cerrado el dinero quedaría fuera del corte: se rechaza
      // ANTES de tocar el saldo, para que un 409 no deje la deuda movida.
      if (sesionId) {
        const [srows] = await conn.query(
          'SELECT id, estado FROM sesiones_caja WHERE id = :id FOR UPDATE',
          { id: sesionId }
        );
        if (!srows[0]) throw new AppError(404, 'SESION_NO_ENCONTRADA', 'Sesión de caja no encontrada');
        if (srows[0].estado !== 'abierta') {
          throw new AppError(409, 'CAJA_CERRADA', 'La sesión de caja está cerrada');
        }
      } else {
        throw new AppError(409, 'FALTA_SESION_CAJA',
          'Un abono en efectivo tiene que entrar en un turno de caja abierto, ' +
          'o el corte no va a cuadrar. Abre el turno o registra el abono con otro método.');
      }
    } else {
      // Sin efectivo no hay nada que meter al cajón.
      sesionId = null;
    }

    const movId = await agregarMovimiento({
      cliente_id: clienteId,
      tipo: 'abono',
      monto: datos.monto,
      metodo_pago_id: datos.metodo_pago_id ?? null,
      sesion_caja_id: sesionId,
      referencia: datos.referencia ?? null,
      notas: datos.notas ?? null,
      usuario_id: usuarioId ?? null,
    }, conn);

    if (esEfectivo) {
      const [[cli]] = await conn.query('SELECT nombre FROM clientes WHERE id = :id', { id: clienteId });
      await conn.query(
        `INSERT INTO movimientos_caja (sesion_caja_id, tipo, monto, referencia_id, motivo)
         VALUES (:sesion, 'ingreso', :monto, :ref, :motivo)`,
        {
          sesion: sesionId,
          monto: datos.monto,
          // `referencia_id` apunta al movimiento de crédito, no al cliente:
          // así desde el corte se puede llegar al abono exacto.
          ref: movId,
          motivo: `Abono de ${cli ? cli.nombre : 'cliente'}`,
        }
      );
    }

    return { movimiento_id: movId, saldo_nuevo: await saldo(clienteId, conn) };
  });
}

/**
 * Carga a la cuenta del cliente lo que se llevó a crédito. Se llama DENTRO de
 * la transacción de la venta: si la venta se revierte, la deuda no queda.
 *
 * Valida el límite con las filas bloqueadas, para que dos cajas cobrando a la
 * vez no puedan pasarlo entre las dos.
 */
async function cargarVentaACredito(conn, { clienteId, monto, pedidoId, numeroPedido, usuarioId }) {
  const [crows] = await conn.query(
    'SELECT id, nombre, limite_credito, activo FROM clientes WHERE id = :id FOR UPDATE',
    { id: clienteId }
  );
  const cliente = crows[0];
  if (!cliente) throw new AppError(422, 'CLIENTE_INVALIDO', 'Ese cliente no existe');
  if (!cliente.activo) {
    throw new AppError(422, 'CLIENTE_INACTIVO', `${cliente.nombre} está dado de baja.`);
  }

  const limite = Number(cliente.limite_credito);
  if (limite <= 0) {
    throw new AppError(409, 'SIN_CREDITO',
      `${cliente.nombre} no tiene crédito autorizado. Captúrale un límite en su expediente.`);
  }

  const saldoActual = await saldo(clienteId, conn, true);
  const disponible = Math.round((limite - saldoActual) * 100) / 100;
  if (monto > disponible + 0.001) {
    throw new AppError(409, 'CREDITO_INSUFICIENTE',
      `${cliente.nombre} debe $${saldoActual.toFixed(2)} de un límite de ` +
      `$${limite.toFixed(2)}: le quedan $${disponible.toFixed(2)} y esta venta es ` +
      `de $${monto.toFixed(2)}.`);
  }

  return agregarMovimiento({
    cliente_id: clienteId,
    tipo: 'cargo',
    monto,
    pedido_id: pedidoId,
    notas: `Venta a crédito ${numeroPedido}`,
    usuario_id: usuarioId ?? null,
  }, conn);
}

/**
 * Deshace (o repone) la deuda de un pedido cuando se cancela o se reactiva.
 *
 * NO borra el cargo original: el libro de crédito no se borra, se corrige con
 * otro movimiento, igual que el kardex. Así el estado de cuenta sigue contando
 * lo que pasó ("se llevó, se canceló") en vez de fingir que nunca ocurrió.
 *
 * Es IDEMPOTENTE: revierte el NETO de todos los movimientos del pedido, así que
 * cancelar dos veces no perdona la deuda dos veces.
 */
async function ajustarCreditoPorPedido(conn, { pedidoId, numeroPedido, usuarioId, revertir }) {
  const [rows] = await conn.query(
    `SELECT tipo, monto FROM credito_movimientos
      WHERE pedido_id = :id FOR UPDATE`,
    { id: pedidoId }
  );
  if (rows.length === 0) return null; // No fue una venta a crédito.

  const neto = Math.round(
    rows.reduce((s, m) => s + SIGNO_CREDITO[m.tipo] * Number(m.monto), 0) * 100
  ) / 100;

  if (revertir) {
    // Ya está en cero: se canceló antes y no hay nada que perdonar.
    if (neto <= 0) return null;
    return agregarMovimiento({
      cliente_id: (await conn.query(
        'SELECT cliente_id FROM credito_movimientos WHERE pedido_id = :id LIMIT 1',
        { id: pedidoId }
      ))[0][0].cliente_id,
      tipo: 'ajuste',
      monto: -neto,
      pedido_id: pedidoId,
      notas: `Cancelación de ${numeroPedido}: se quita la deuda`,
      usuario_id: usuarioId ?? null,
    }, conn);
  }

  // Reactivar: la deuda vuelve. Se repone lo que se perdonó, no el cargo
  // original, por si entretanto hubo abonos parciales sobre ese pedido.
  if (neto >= 0) return null;
  const [[{ cliente_id }]] = await conn.query(
    'SELECT cliente_id FROM credito_movimientos WHERE pedido_id = :id LIMIT 1',
    { id: pedidoId }
  );
  return agregarMovimiento({
    cliente_id,
    tipo: 'ajuste',
    monto: -neto,
    pedido_id: pedidoId,
    notas: `Reactivación de ${numeroPedido}: vuelve la deuda`,
    usuario_id: usuarioId ?? null,
  }, conn);
}

module.exports = {
  // Cuenta de la tienda en línea
  buscarPorCorreoConHash,
  buscarPorId,
  crear,
  // Expediente
  listar,
  obtener,
  buscarParaVenta,
  crearDesdeStaff,
  actualizar,
  duplicado,
  // Historial
  estadisticas,
  coloresMasComprados,
  pedidos,
  // Crédito
  saldo,
  movimientosCredito,
  agregarMovimiento,
  registrarAbono,
  cargarVentaACredito,
  ajustarCreditoPorPedido,
  SIGNO_CREDITO,
};
