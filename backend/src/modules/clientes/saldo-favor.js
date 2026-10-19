'use strict';

/**
 * EL SALDO A FAVOR de un cliente (2026-10-13, parte 2). "Un cliente te compra
 * hilo y regresa una parte o todo: no le quiero regresar dinero, lo que se le
 * tiene que agregar es como un saldo a favor de lo que regresó" (usuario).
 *
 * Nace de las devoluciones y de los ANTICIPOS (dinero a cuenta, sin nota).
 * Es un LIBRO de movimientos, como el de crédito: el saldo es su suma y no hay
 * campo de saldo en `clientes` (un valor guardado aparte se descuadra en cuanto
 * algo falla a medias). Va APARTE de la deuda de crédito: "a veces el cliente
 * pide que su saldo a favor se utilice para otras compras y dejar su crédito
 * como está". Él elige:
 *   · usarlo para PAGAR una compra (`usarEnVenta`, desde el punto de venta);
 *   · DESCONTARLO de lo que debe (`aplicarADeuda`): sus notas pendientes de pago
 *     y su cuenta de crédito.
 *
 * Cuando se usa, queda como un PAGO de la venta con el método interno "Saldo a
 * favor" (o como un abono a su cuenta con ese método): así la venta dice cómo
 * se pagó, se liquida, y la comisión se paga como con cualquier pago.
 */

const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const clientesModel = require('./model');
const { aFavorDe } = require('./a-favor');

const SIGNO = { devolucion: 1, anticipo: 1, uso: -1, aplicado: -1, reintegro: 1, ajuste: 1 };
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** El saldo a favor. Con `bloquear`, bloquea la fila del cliente (dos cajas a la vez). */
async function saldoFavor(clienteId, ejecutor = pool, bloquear = false) {
  if (bloquear) {
    await ejecutor.query('SELECT id FROM clientes WHERE id = :id FOR UPDATE', { id: clienteId });
  }
  const [rows] = await ejecutor.query(
    'SELECT tipo, monto FROM saldo_favor_movimientos WHERE cliente_id = :id',
    { id: clienteId }
  );
  return round2(rows.reduce((s, m) => s + (SIGNO[m.tipo] ?? 0) * Number(m.monto), 0));
}

/** Los movimientos del saldo a favor, del más nuevo al más viejo. */
async function movimientos(clienteId, { limit = 50, almacenes = null } = {}) {
  const [rows] = await pool.query(
    `SELECT m.id, m.tipo, m.monto, m.notas, m.creado_en, m.referencia,
            m.pedido_id, p.numero_pedido, m.devolucion_id, d.folio AS devolucion_folio,
            mp.nombre AS metodo, u.nombre AS registro,
            COALESCE(p.almacen_id, cj.almacen_id) AS almacen_id
       FROM saldo_favor_movimientos m
       LEFT JOIN pedidos p      ON p.id = m.pedido_id
       LEFT JOIN sesiones_caja sc ON sc.id = m.sesion_caja_id
       LEFT JOIN cajas cj       ON cj.id = sc.caja_id
       LEFT JOIN devoluciones d ON d.id = m.devolucion_id
       LEFT JOIN metodos_pago mp ON mp.id = m.metodo_pago_id
       LEFT JOIN usuarios u     ON u.id = m.usuario_id
      WHERE m.cliente_id = :id
      ORDER BY m.creado_en DESC, m.id DESC
      LIMIT :limit`,
    { id: clienteId, limit }
  );
  // De OTRA tienda (2026-10-15): el monto sí (su saldo es uno), el folio no.
  return rows.map(({ almacen_id: almacenId, ...m }) =>
    !Array.isArray(almacenes) || almacenId == null || almacenes.includes(Number(almacenId))
      ? m
      : { ...m, pedido_id: null, numero_pedido: null, devolucion_id: null, devolucion_folio: null,
          referencia: null, notas: null, registro: null, otra_tienda: true });
}

async function agregar(conn, {
  clienteId, tipo, monto, pedidoId = null, devolucionId = null, usuarioId = null, notas = null,
  metodoPagoId = null, sesionCajaId = null, referencia = null,
}) {
  const [r] = await conn.query(
    `INSERT INTO saldo_favor_movimientos
       (cliente_id, tipo, monto, pedido_id, devolucion_id, metodo_pago_id, sesion_caja_id, referencia, usuario_id, notas)
     VALUES (:cliente, :tipo, :monto, :pedido, :devolucion, :metodo, :sesion, :referencia, :usuario, :notas)`,
    {
      cliente: clienteId, tipo, monto: round2(monto), pedido: pedidoId, devolucion: devolucionId,
      metodo: metodoPagoId, sesion: sesionCajaId, referencia, usuario: usuarioId, notas,
    }
  );
  return r.insertId;
}

/**
 * Un ANTICIPO: dinero a cuenta, sin nota (2026-10-14: "se dan anticipos en
 * efectivo y transferencia"). El cliente deja dinero antes de comprar y le
 * queda como saldo a favor. Puede dejar parte en efectivo y parte por
 * transferencia: un movimiento por cada una, con su método.
 *   · El EFECTIVO entra al turno de caja que lo recibe como 'ingreso' (al corte
 *     de ese día, como un abono): sin turno abierto se rechaza ANTES de asentar
 *     nada, o habría dinero en el cajón que nada explica.
 *   · La transferencia no toca la caja; lleva su referencia (el folio).
 * Va dentro de la transacción de quien llama.
 */
async function recibirAnticipo(conn, { clienteId, efectivo = 0, transferencia = 0, sesionCajaId = null, referencia = null, notas = null, usuarioId = null }) {
  const ef = round2(efectivo);
  const tr = round2(transferencia);
  if (!(ef > 0) && !(tr > 0)) {
    throw new AppError(422, 'ANTICIPO_VACIO', 'Pon cuánto deja: en efectivo, por transferencia o las dos.');
  }
  const [[cli]] = await conn.query('SELECT id, nombre, activo FROM clientes WHERE id = :id FOR UPDATE', { id: clienteId });
  if (!cli) throw new AppError(404, 'NO_ENCONTRADO', 'Cliente no encontrado');
  if (!cli.activo) throw new AppError(422, 'CLIENTE_INACTIVO', `${cli.nombre} está dado de baja.`);

  const [metodos] = await conn.query('SELECT id, nombre FROM metodos_pago WHERE activo = 1 AND interno = 0');
  const metodoDe = (palabra) => metodos.find((m) => String(m.nombre).toLowerCase().includes(palabra))?.id ?? null;
  const idEfectivo = metodoDe('efectivo');
  const idTransferencia = metodoDe('transferencia');
  if ((ef > 0 && !idEfectivo) || (tr > 0 && !idTransferencia)) {
    throw new AppError(422, 'METODO_PAGO_INVALIDO', 'Falta el método de pago "Efectivo" o "Transferencia" activo.');
  }

  if (ef > 0) {
    if (!sesionCajaId) {
      throw new AppError(409, 'FALTA_SESION_CAJA',
        'El efectivo del anticipo tiene que entrar en un turno de caja abierto, o el corte no va a cuadrar. ' +
        'Abre el turno o recíbelo por transferencia.');
    }
    const [[ses]] = await conn.query('SELECT id, estado FROM sesiones_caja WHERE id = :id FOR UPDATE', { id: sesionCajaId });
    if (!ses) throw new AppError(404, 'SESION_NO_ENCONTRADA', 'Turno de caja no encontrado');
    if (ses.estado !== 'abierta') throw new AppError(409, 'CAJA_CERRADA', 'Ese turno de caja ya está cerrado.');
  }

  const nota = notas ? String(notas).trim().slice(0, 255) || null : null;
  // El primer movimiento: con él se pide su ticket (las dos partes salen juntas).
  let primero = null;
  if (ef > 0) {
    const movId = await agregar(conn, {
      clienteId, tipo: 'anticipo', monto: ef, metodoPagoId: idEfectivo, sesionCajaId, usuarioId,
      notas: nota ?? 'Anticipo en efectivo',
    });
    await conn.query(
      `INSERT INTO movimientos_caja (sesion_caja_id, tipo, monto, referencia_id, motivo)
       VALUES (:sesion, 'ingreso', :monto, :ref, :motivo)`,
      // `referencia_id` apunta al movimiento del saldo a favor, como el del abono al de crédito.
      { sesion: sesionCajaId, monto: ef, ref: movId, motivo: `Anticipo de ${cli.nombre}` }
    );
    primero = movId;
  }
  if (tr > 0) {
    const movId = await agregar(conn, {
      clienteId, tipo: 'anticipo', monto: tr, metodoPagoId: idTransferencia, usuarioId,
      referencia: referencia ? String(referencia).trim().slice(0, 120) || null : null,
      notas: nota ?? 'Anticipo por transferencia',
    });
    primero = primero ?? movId;
  }
  return { movimiento_id: Number(primero), cliente: cli.nombre, efectivo: ef, transferencia: tr, total: round2(ef + tr) };
}

/** El método de pago interno con que se asienta lo que paga el saldo a favor. */
async function metodoSaldoFavor(ejecutor = pool) {
  const [[m]] = await ejecutor.query(
    "SELECT id FROM metodos_pago WHERE nombre = 'Saldo a favor' AND interno = 1 LIMIT 1"
  );
  if (!m) throw new AppError(500, 'SIN_METODO_SALDO', 'Falta el método de pago "Saldo a favor" (migración 2026-10_saldo_a_favor).');
  return Number(m.id);
}

/**
 * Usa saldo a favor para PAGAR una venta (lo llama `crearPedido`, dentro de su
 * transacción). Valida con la fila del cliente bloqueada que le alcance: dos
 * cajas no pueden gastar el mismo saldo. El PAGO lo asienta la venta.
 */
async function usarEnVenta(conn, { clienteId, monto, pedidoId, numeroPedido, usuarioId }) {
  const disponible = await saldoFavor(clienteId, conn, true);
  if (monto > disponible + 0.001) {
    throw new AppError(409, 'SALDO_FAVOR_INSUFICIENTE',
      `Tiene $${disponible.toFixed(2)} a favor y se quieren usar $${round2(monto).toFixed(2)}.`);
  }
  await agregar(conn, {
    clienteId, tipo: 'uso', monto, pedidoId, usuarioId, notas: `Pagó parte de ${numeroPedido}`,
  });
}

/**
 * AJUSTE A MANO del saldo a favor (2026-10-16: "que sea ajuste de saldo a favor:
 * se le puede quitar o agregar"). Como el ajuste de la deuda: con MOTIVO
 * obligatorio (un saldo que cambia sin explicación no se aclara después) y sin
 * dejarlo en negativo. Positivo le agrega, negativo le quita. Lo pide quien
 * tiene «Corregir deuda». Va dentro de la transacción de quien llama.
 */
async function ajustarSaldo(conn, { clienteId, monto, motivo, usuarioId = null }) {
  const m = round2(monto);
  if (!Number.isFinite(m) || m === 0) throw new AppError(422, 'MONTO_INVALIDO', 'Pon de cuánto es el ajuste.');
  const texto = String(motivo ?? '').trim();
  if (!texto) throw new AppError(422, 'FALTA_MOTIVO', 'Escribe el motivo del ajuste.');
  const tenia = await saldoFavor(clienteId, conn, true);
  if (round2(tenia + m) < 0) {
    throw new AppError(409, 'SALDO_FAVOR_INSUFICIENTE',
      `Tiene $${tenia.toFixed(2)} a favor: no se le pueden quitar $${Math.abs(m).toFixed(2)}.`);
  }
  const movimientoId = await agregar(conn, { clienteId, tipo: 'ajuste', monto: m, usuarioId, notas: texto });
  return { movimiento_id: movimientoId, tenia, saldo_favor: round2(tenia + m) };
}

/**
 * Lo que se pagó de una venta con su SALDO A FAVOR, cuánto le QUEDÓ a favor
 * justo después y cuánto tiene HOY (2026-10-15, para el ticket: "que diga que se
 * pagó con saldo a favor y cuánto le queda"). Sale del libro HASTA ese uso, así
 * el ticket reimpreso dice lo mismo que el del día. null si no usó saldo.
 */
async function usadoEnVenta(ejecutor, pedidoId) {
  const [usos] = await ejecutor.query(
    `SELECT id, cliente_id, monto FROM saldo_favor_movimientos
      WHERE pedido_id = :id AND tipo IN ('uso', 'aplicado')
      ORDER BY id`,
    { id: pedidoId }
  );
  if (!usos.length) return null;
  const clienteId = usos[0].cliente_id;
  const [libro] = await ejecutor.query(
    'SELECT tipo, monto FROM saldo_favor_movimientos WHERE cliente_id = :c AND id <= :hasta',
    { c: clienteId, hasta: usos[usos.length - 1].id }
  );
  return {
    usado: round2(usos.reduce((s, m) => s + Number(m.monto), 0)),
    quedo: round2(libro.reduce((s, m) => s + (SIGNO[m.tipo] ?? 0) * Number(m.monto), 0)),
    hoy: await saldoFavor(clienteId, ejecutor),
  };
}

/**
 * Al CANCELAR una venta donde se usó saldo a favor (al cobrarla, o descontado
 * de su nota pendiente), el saldo REGRESA (no se devuelve en efectivo: no era
 * dinero del cajón). Idempotente: regresa el neto de lo usado en esa venta, así
 * cancelar dos veces no lo regresa dos veces.
 */
async function reintegrarDeVenta(conn, { pedidoId, numeroPedido, usuarioId }) {
  const [rows] = await conn.query(
    `SELECT cliente_id, tipo, monto FROM saldo_favor_movimientos
      WHERE pedido_id = :id AND tipo IN ('uso', 'aplicado', 'reintegro')`,
    { id: pedidoId }
  );
  if (!rows.length) return 0;
  const neto = round2(rows.reduce((s, m) => s + (m.tipo === 'reintegro' ? -1 : 1) * Number(m.monto), 0));
  if (neto <= 0.004) return 0;
  await agregar(conn, {
    clienteId: rows[0].cliente_id, tipo: 'reintegro', monto: neto, pedidoId, usuarioId,
    notas: `Se canceló ${numeroPedido}: regresa lo que pagó con su saldo a favor`,
  });
  await conn.query(
    `UPDATE pagos p JOIN metodos_pago mp ON mp.id = p.metodo_pago_id
        SET p.estado = 'reembolsado'
      WHERE p.pedido_id = :id AND mp.interno = 1 AND p.estado = 'completado'`,
    { id: pedidoId }
  );
  return neto;
}

/** Asienta un pago "Saldo a favor" a una nota pendiente de pago; con el último queda pagada. */
async function _pagarNota(conn, { clienteId, nota, usa, metodo, usuarioId, origen, notas }) {
  const falta = round2(Number(nota.total) - Number(nota.pagado));
  await conn.query(
    `INSERT INTO pagos (pedido_id, metodo_pago_id, monto, estado, referencia_transaccion)
     VALUES (:p, :m, :monto, 'completado', :ref)`,
    { p: nota.id, m: metodo, monto: usa, ref: origen ? `Saldo a favor (${origen})` : 'Saldo a favor' }
  );
  const pagada = usa + 0.004 >= falta;
  if (pagada) await conn.query("UPDATE pedidos SET estado = 'pagado' WHERE id = :id", { id: nota.id });
  await agregar(conn, { clienteId, tipo: 'aplicado', monto: usa, pedidoId: nota.id, usuarioId, notas });
  return { a: 'nota', pedido_id: Number(nota.id), numero_pedido: nota.numero_pedido, monto: usa, pagada };
}

/**
 * DESCUENTA saldo a favor de lo que el cliente debe, hasta `monto` (o todo lo
 * que alcance): sus notas pendientes de pago de la más vieja a la más nueva, y
 * luego su cuenta de crédito.
 *   · a una nota pendiente le asienta un PAGO "Saldo a favor" (con el último
 *     queda pagada);
 *   · a la cuenta de crédito, un ABONO con ese método (se liquidan solas las
 *     ventas que cubre, de la más vieja a la más nueva).
 * Devuelve cuánto aplicó y a qué. (Lo que regresa de una venta que todavía se
 * debe va primero a ESA venta: `descontarDeVenta`.)
 */
async function aplicarADeuda(conn, { clienteId, monto = null, usuarioId = null, origen = '' }) {
  const disponible = await saldoFavor(clienteId, conn, true);
  let resta = round2(monto == null ? disponible : Math.min(monto, disponible));
  if (resta <= 0.004) return { aplicado: 0, detalle: [] };
  const metodo = await metodoSaldoFavor(conn);
  const detalle = [];

  const [notas] = await conn.query(
    `SELECT p.id, p.numero_pedido, p.total,
            COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.pedido_id = p.id AND pg.estado = 'completado'), 0) AS pagado
       FROM pedidos p
      WHERE p.cliente_id = :cli AND p.nota_pendiente = 1 AND p.estado = 'pendiente'
        AND NOT EXISTS (SELECT 1 FROM credito_movimientos cm WHERE cm.pedido_id = p.id AND cm.tipo = 'cargo')
      ORDER BY p.creado_en, p.id
      FOR UPDATE`,
    { cli: clienteId }
  );
  for (const n of notas) {
    if (resta <= 0.004) break;
    const usa = round2(Math.min(round2(Number(n.total) - Number(n.pagado)), resta));
    if (usa <= 0.004) continue;
    detalle.push(await _pagarNota(conn, {
      clienteId, nota: n, usa, metodo, usuarioId, origen,
      notas: `Pagó la nota ${n.numero_pedido}${origen ? ' (' + origen + ')' : ''}`,
    }));
    resta = round2(resta - usa);
  }

  if (resta > 0.004) {
    const deuda = await clientesModel.saldo(clienteId, conn, true);
    const usa = round2(Math.min(deuda, resta));
    if (usa > 0.004) {
      await clientesModel.agregarMovimiento({
        cliente_id: clienteId, tipo: 'abono', monto: usa, metodo_pago_id: metodo, usuario_id: usuarioId,
        notas: `Con su saldo a favor${origen ? ' (' + origen + ')' : ''}`,
      }, conn);
      await clientesModel.liquidarVentasACredito(conn, clienteId);
      await agregar(conn, {
        clienteId, tipo: 'aplicado', monto: usa, usuarioId,
        notas: `A su cuenta de crédito${origen ? ' (' + origen + ')' : ''}`,
      });
      detalle.push({ a: 'credito', monto: usa });
    }
  }
  const aplicado = round2(detalle.reduce((s, d) => s + d.monto, 0));
  return { aplicado, detalle };
}

/**
 * Lo que todavía debe UNA venta: la fiada, lo que le falta de su cargo (con el
 * reparto de los abonos de la cuenta, de lo más viejo a lo más nuevo); la nota
 * pendiente de pago, lo que le falta de sus pagos. `tipo` null y 0 si ya está
 * pagada o nunca se debió.
 */
async function debeDeVenta(ejecutor, pedidoId) {
  const [[p]] = await ejecutor.query(
    `SELECT p.id, p.numero_pedido, p.cliente_id, p.total, p.estado, p.nota_pendiente,
            EXISTS (SELECT 1 FROM credito_movimientos cm WHERE cm.pedido_id = p.id AND cm.tipo = 'cargo') AS fiada,
            COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.pedido_id = p.id AND pg.estado = 'completado'), 0) AS pagado
       FROM pedidos p WHERE p.id = :id`,
    { id: pedidoId }
  );
  const nada = { tipo: null, debe: 0, venta: p ?? null };
  if (!p || !p.cliente_id || ['cancelado', 'devuelto'].includes(p.estado)) return nada;
  if (Number(p.fiada)) {
    const d = (await clientesModel.aplicarAbonos(ejecutor, p.cliente_id)).find((x) => x.pedidoId === Number(p.id));
    const debe = round2(d?.porPagar ?? 0);
    return debe > 0.004 ? { tipo: 'credito', debe, venta: p } : nada;
  }
  if (Number(p.nota_pendiente) && p.estado === 'pendiente') {
    const debe = round2(Math.max(0, Number(p.total) - Number(p.pagado)));
    return debe > 0.004 ? { tipo: 'nota', debe, venta: p } : nada;
  }
  return nada;
}

/**
 * Lo que REGRESA de una venta que todavía se debe se descuenta de ESA venta
 * (2026-10-14: "una nota a crédito y el cliente regresa hilo: cuando es un
 * crédito que aún no está pagado, esa devolución se le descuenta a la nota"),
 * hasta lo que debe:
 *   · la fiada, con un AJUSTE negativo ligado a la venta en su cuenta: baja lo
 *     que debe ESA venta, no lo más viejo (un abono se iría a lo más viejo);
 *   · la nota pendiente de pago, con un pago "Saldo a favor".
 * El saldo a favor que dejó la devolución se gasta en eso ('aplicado'). Devuelve
 * cuánto se descontó; lo que sobre sigue a favor.
 */
async function descontarDeVenta(conn, { clienteId, pedidoId, monto, usuarioId = null, origen = '' }) {
  const { tipo, debe, venta } = await debeDeVenta(conn, pedidoId);
  const usa = round2(Math.min(Number(monto), debe));
  if (!tipo || usa <= 0.004) return { aplicado: 0, detalle: [] };
  if (tipo === 'nota') {
    const r = await _pagarNota(conn, {
      clienteId, nota: venta, usa, metodo: await metodoSaldoFavor(conn), usuarioId, origen,
      notas: `Se descontó de ${venta.numero_pedido}, de donde regresó${origen ? ' (' + origen + ')' : ''}`,
    });
    return { aplicado: usa, detalle: [{ ...r, de_esta: true }] };
  }
  await clientesModel.agregarMovimiento({
    cliente_id: clienteId, tipo: 'ajuste', monto: -usa, pedido_id: pedidoId, usuario_id: usuarioId,
    notas: `Regresó mercancía${origen ? ' (' + origen + ')' : ''}: se descuenta de ${venta.numero_pedido}`,
  }, conn);
  await clientesModel.liquidarVentasACredito(conn, clienteId);
  // Si lo que regresó cubre todo lo que se debía, la venta queda pagada (la
  // liquidación de arriba no toca una venta cuya deuda quedó en $0).
  const pagada = usa + 0.004 >= debe;
  if (pagada) await conn.query("UPDATE pedidos SET estado = 'pagado' WHERE id = :id AND estado = 'pendiente'", { id: pedidoId });
  await agregar(conn, {
    clienteId, tipo: 'aplicado', monto: usa, pedidoId, usuarioId,
    notas: `Se descontó de ${venta.numero_pedido}, de donde regresó${origen ? ' (' + origen + ')' : ''}`,
  });
  return {
    aplicado: usa,
    detalle: [{ a: 'credito', pedido_id: Number(pedidoId), numero_pedido: venta.numero_pedido, monto: usa, pagada, de_esta: true }],
  };
}

/** Cuánto debe en total: su cuenta de crédito y sus notas pendientes de pago. */
async function deudaTotal(clienteId, ejecutor = pool) {
  const credito = Math.max(0, await clientesModel.saldo(clienteId, ejecutor));
  const [[n]] = await ejecutor.query(
    `SELECT COALESCE(SUM(p.total - COALESCE((SELECT SUM(pg.monto) FROM pagos pg
                                              WHERE pg.pedido_id = p.id AND pg.estado = 'completado'), 0)), 0) AS falta
       FROM pedidos p
      WHERE p.cliente_id = :cli AND p.nota_pendiente = 1 AND p.estado = 'pendiente'
        AND NOT EXISTS (SELECT 1 FROM credito_movimientos cm WHERE cm.pedido_id = p.id AND cm.tipo = 'cargo')`,
    { cli: clienteId }
  );
  const notas = round2(n.falta);
  return { credito: round2(credito), notas, total: round2(credito + notas) };
}

/**
 * QUIÉN TIENE SALDO A FAVOR, cuánto y desde cuándo (2026-10-19): lo que la
 * tienda les guarda (anticipos y lo que regresaron). Del que más tiene al que
 * menos. Es de todos los clientes (el cliente es compartido entre tiendas).
 */
async function aFavorDeClientes() {
  const [movs] = await pool.query(
    `SELECT cliente_id, tipo, monto, DATE_FORMAT(creado_en, '%Y-%m-%d') AS dia
       FROM saldo_favor_movimientos ORDER BY cliente_id, creado_en, id`
  );
  const porCliente = new Map();
  for (const mv of movs) {
    if (!porCliente.has(mv.cliente_id)) porCliente.set(mv.cliente_id, []);
    porCliente.get(mv.cliente_id).push(mv);
  }
  const con = [];
  for (const [id, lista] of porCliente) {
    const r = aFavorDe(lista);
    if (r.saldo > 0) con.push({ cliente_id: Number(id), saldo: r.saldo, desde: r.desde, ultimo_movimiento: r.ultimo });
  }
  if (con.length) {
    const [cl] = await pool.query(
      `SELECT id, codigo, nombre, nombre_comercial, telefono FROM clientes WHERE id IN (:ids)`,
      { ids: con.map((c) => c.cliente_id) }
    );
    const datos = new Map(cl.map((c) => [Number(c.id), c]));
    for (const c of con) {
      const d = datos.get(c.cliente_id) ?? {};
      Object.assign(c, { codigo: d.codigo ?? null, nombre: d.nombre ?? '', nombre_comercial: d.nombre_comercial ?? null, telefono: d.telefono ?? null });
    }
  }
  con.sort((a, b) => b.saldo - a.saldo);
  return { total: round2(con.reduce((s, c) => s + c.saldo, 0)), num_clientes: con.length, clientes: con };
}

module.exports = {
  aFavorDeClientes,
  saldoFavor, movimientos, agregar, metodoSaldoFavor, usarEnVenta, usadoEnVenta, reintegrarDeVenta, aplicarADeuda, deudaTotal,
  ajustarSaldo,
  debeDeVenta, descontarDeVenta, recibirAnticipo,
};
