'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');
const { hashPassword, verificarPassword } = require('../../utils/password');
const { firmarToken } = require('../../utils/jwt');

/** Quita cualquier campo sensible antes de responder. */
function sanitizar(cliente) {
  if (!cliente) return cliente;
  const { contrasena_hash, ...publico } = cliente;
  return publico;
}

/** Construye el JWT de un cliente. */
function emitirToken(cliente) {
  return firmarToken({ sub: cliente.id, tipo: 'cliente' });
}

/** Registra una nueva cuenta de cliente. */
async function registrar({ nombre, correo, telefono, contrasena, acepta_marketing }) {
  const existente = await model.buscarPorCorreoConHash(correo);
  if (existente) {
    throw new AppError(409, 'CORREO_EN_USO', 'Ya existe una cuenta con ese correo');
  }

  const contrasena_hash = await hashPassword(contrasena);
  const cliente = await model.crear({ nombre, correo, telefono, contrasena_hash, acepta_marketing });

  return { cliente: sanitizar(cliente), token: emitirToken(cliente) };
}

/** Autentica a un cliente por correo y contraseña. */
async function iniciarSesion({ correo, contrasena }) {
  const cliente = await model.buscarPorCorreoConHash(correo);

  const credencialesInvalidas = new AppError(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos');
  if (!cliente) throw credencialesInvalidas;

  // Cliente invitado sin contraseña definida: no puede iniciar sesión.
  const ok = await verificarPassword(contrasena, cliente.contrasena_hash);
  if (!ok) throw credencialesInvalidas;

  if (!cliente.activo) {
    throw new AppError(403, 'CUENTA_INACTIVA', 'La cuenta está desactivada');
  }

  return { cliente: sanitizar(cliente), token: emitirToken(cliente) };
}

/** Devuelve el perfil del cliente autenticado. */
async function perfil(id) {
  const cliente = await model.buscarPorId(id);
  if (!cliente) throw new AppError(404, 'NO_ENCONTRADO', 'Cliente no encontrado');
  return sanitizar(cliente);
}

// ---------------------------------------------------------------------------
//  El expediente: lo que administra el personal
// ---------------------------------------------------------------------------

const { paginado } = require('../../utils/query');

/**
 * Normaliza lo que llega del formulario. Los opcionales vacíos se guardan como
 * NULL y no como cadena vacía: un `codigo` en '' choca con el UNIQUE en cuanto
 * hay dos clientes sin código, mientras que varios NULL conviven.
 */
function _normalizar(datos, actual = {}) {
  const tomar = (campo, respaldo = null) => {
    const v = datos[campo] !== undefined ? datos[campo] : actual[campo];
    if (v === undefined || v === null) return respaldo;
    if (typeof v === 'string' && v.trim() === '') return respaldo;
    return typeof v === 'string' ? v.trim() : v;
  };
  return {
    codigo: tomar('codigo'),
    nombre: tomar('nombre'),
    nombre_comercial: tomar('nombre_comercial'),
    rfc: tomar('rfc'),
    tipo_cliente_id: tomar('tipo_cliente_id'),
    correo: (() => {
      const c = tomar('correo');
      return c ? String(c).toLowerCase() : null;
    })(),
    telefono: tomar('telefono'),
    telefono_alt: tomar('telefono_alt'),
    direccion: tomar('direccion'),
    ciudad: tomar('ciudad'),
    estado: tomar('estado'),
    como_llego: tomar('como_llego'),
    fecha_nacimiento: tomar('fecha_nacimiento'),
    // Un cliente de años es cliente desde antes de capturarlo. Si no se dice,
    // se asume hoy, pero el campo está para corregirlo.
    cliente_desde: tomar('cliente_desde') || new Date().toISOString().slice(0, 10),
    limite_credito: Number(tomar('limite_credito', 0)) || 0,
    notas: tomar('notas'),
    activo: datos.activo !== undefined ? (datos.activo ? 1 : 0) : (actual.activo ?? 1),
  };
}

async function listarClientes(filtros) {
  const { rows, total } = await model.listar(filtros);
  return paginado(rows, total, filtros.page, filtros.limit);
}

/** El expediente completo: datos, estadísticas, colores y saldo. */
async function expediente(id) {
  const cliente = await model.obtener(id);
  if (!cliente) throw new AppError(404, 'NO_ENCONTRADO', 'Cliente no encontrado');

  const [stats, colores, pedidos, credito] = await Promise.all([
    model.estadisticas(id),
    model.coloresMasComprados(id),
    model.pedidos(id, { limit: 20 }),
    model.movimientosCredito(id, { limit: 20 }),
  ]);

  return {
    ...sanitizar(cliente),
    estadisticas: stats,
    colores_mas_comprados: colores,
    pedidos: pedidos.rows,
    total_pedidos: pedidos.total,
    credito_movimientos: credito.rows,
    total_movimientos: credito.total,
  };
}

async function buscarParaVenta(q) {
  // Menos de dos letras devuelve media tienda: no vale la pena el viaje.
  if (!q || q.trim().length < 2) return [];
  return model.buscarParaVenta(q.trim());
}

async function _exigirSinDuplicado(datos, exceptoId) {
  if (!datos.codigo && !datos.correo) return;
  const dup = await model.duplicado({
    codigo: datos.codigo,
    correo: datos.correo,
    exceptoId,
  });
  if (!dup) return;
  const cual = dup.codigo && dup.codigo === datos.codigo ? 'código' : 'correo';
  throw new AppError(409, 'CLIENTE_DUPLICADO',
    `Ya hay otro cliente con ese ${cual}.`);
}

async function crearDesdeStaff(datos) {
  const limpio = _normalizar(datos);
  if (!limpio.nombre) {
    throw new AppError(422, 'FALTA_NOMBRE', 'El cliente necesita al menos un nombre');
  }
  await _exigirSinDuplicado(limpio, null);
  return model.crearDesdeStaff(limpio);
}

async function actualizarCliente(id, datos) {
  const actual = await model.obtener(id);
  if (!actual) throw new AppError(404, 'NO_ENCONTRADO', 'Cliente no encontrado');

  const limpio = _normalizar(datos, actual);
  if (!limpio.nombre) {
    throw new AppError(422, 'FALTA_NOMBRE', 'El cliente necesita al menos un nombre');
  }
  await _exigirSinDuplicado(limpio, id);
  return model.actualizar(id, limpio);
}

// ---------------------------------------------------------------------------
//  Crédito
// ---------------------------------------------------------------------------

async function estadoDeCuenta(id, filtros = {}) {
  const cliente = await model.obtener(id);
  if (!cliente) throw new AppError(404, 'NO_ENCONTRADO', 'Cliente no encontrado');
  const { rows, total } = await model.movimientosCredito(id, filtros);
  return {
    cliente: {
      id: cliente.id, codigo: cliente.codigo, nombre: cliente.nombre,
      nombre_comercial: cliente.nombre_comercial, telefono: cliente.telefono,
    },
    saldo: Number(cliente.saldo),
    cargos: Number(cliente.cargos),
    abonos: Number(cliente.abonos),
    limite_credito: Number(cliente.limite_credito),
    credito_disponible: Number(cliente.credito_disponible),
    movimientos: rows,
    total_movimientos: total,
  };
}

/**
 * Registra un abono del cliente. Si el dinero entra en efectivo por el
 * mostrador, tiene que quedar en la CAJA además del estado de cuenta: si no,
 * el corte no cuadraría —entra dinero que no es una venta— y el cajero
 * aparecería con un sobrante que nadie sabe explicar.
 */
async function registrarAbono(id, datos, usuarioId) {
  const cliente = await model.obtener(id);
  if (!cliente) throw new AppError(404, 'NO_ENCONTRADO', 'Cliente no encontrado');

  const monto = Math.round(Number(datos.monto) * 100) / 100;
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new AppError(422, 'MONTO_INVALIDO', 'El abono debe ser mayor a cero');
  }

  const saldoActual = Number(cliente.saldo);
  if (saldoActual <= 0) {
    throw new AppError(409, 'SIN_DEUDA',
      `${cliente.nombre} no tiene saldo pendiente.`);
  }
  // Cobrar más de lo que se debe dejaría el saldo en negativo, que se leería
  // como crédito a favor y no es lo que significa.
  if (monto > saldoActual + 0.001) {
    throw new AppError(422, 'ABONO_EXCEDE_DEUDA',
      `El abono ($${monto.toFixed(2)}) es mayor a lo que debe ($${saldoActual.toFixed(2)}).`);
  }

  return model.registrarAbono(id, { ...datos, monto }, usuarioId);
}

/** Corrección manual del saldo. Positivo lo sube, negativo lo baja. */
async function ajustarCredito(id, datos, usuarioId) {
  const cliente = await model.obtener(id);
  if (!cliente) throw new AppError(404, 'NO_ENCONTRADO', 'Cliente no encontrado');

  const monto = Math.round(Number(datos.monto) * 100) / 100;
  if (!Number.isFinite(monto) || monto === 0) {
    throw new AppError(422, 'MONTO_INVALIDO', 'El ajuste no puede ser cero');
  }
  if (!datos.notas || !String(datos.notas).trim()) {
    // Un ajuste sin explicación es un saldo que nadie va a poder aclarar.
    throw new AppError(422, 'FALTA_MOTIVO', 'Un ajuste de saldo necesita un motivo');
  }
  const saldoNuevo = Number(cliente.saldo) + monto;
  if (saldoNuevo < 0) {
    throw new AppError(422, 'SALDO_NEGATIVO',
      `Ese ajuste dejaría el saldo en $${saldoNuevo.toFixed(2)}. ` +
      'Un saldo negativo se leería como crédito a favor.');
  }

  await model.agregarMovimiento({
    cliente_id: id, tipo: 'ajuste', monto,
    notas: String(datos.notas).trim(), usuario_id: usuarioId,
  });
  return estadoDeCuenta(id);
}

module.exports = {
  registrar,
  iniciarSesion,
  perfil,
  listarClientes,
  expediente,
  buscarParaVenta,
  crearDesdeStaff,
  actualizarCliente,
  estadoDeCuenta,
  registrarAbono,
  ajustarCredito,
};
