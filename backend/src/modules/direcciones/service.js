'use strict';

const model = require('./model');
const { AppError } = require('../../middlewares/error');

// Campos que se guardan tal cual, con sus opcionales en null explícito para
// que un UPDATE parcial no deje basura del registro anterior.
function _normalizar(datos, actual = {}) {
  const tomar = (campo, respaldo = null) =>
    datos[campo] !== undefined ? datos[campo] : (actual[campo] ?? respaldo);
  return {
    tipo: tomar('tipo', 'envio'),
    nombre_receptor: tomar('nombre_receptor'),
    calle: tomar('calle'),
    numero_ext: tomar('numero_ext'),
    numero_int: tomar('numero_int'),
    colonia: tomar('colonia'),
    ciudad: tomar('ciudad'),
    estado: tomar('estado'),
    codigo_postal: tomar('codigo_postal'),
    pais: tomar('pais', 'México'),
    telefono: tomar('telefono'),
    referencias: tomar('referencias'),
    es_predeterminada: tomar('es_predeterminada', false),
  };
}

async function listar(clienteId) {
  return model.listar(clienteId);
}

async function obtener(id, clienteId) {
  const d = await model.obtener(id, clienteId);
  // 404 y no 403 a propósito: la dirección de otro cliente no debe ni
  // confirmarse que existe.
  if (!d) throw new AppError(404, 'NO_ENCONTRADA', 'Dirección no encontrada');
  return d;
}

async function crear(clienteId, datos) {
  return model.crear(clienteId, _normalizar(datos));
}

async function actualizar(id, clienteId, datos) {
  const actual = await obtener(id, clienteId);
  return model.actualizar(id, clienteId, _normalizar(datos, actual));
}

async function eliminar(id, clienteId) {
  await obtener(id, clienteId);
  const enPedidos = await model.pedidosQueLaUsan(id);
  if (enPedidos > 0) {
    throw new AppError(409, 'DIRECCION_EN_USO',
      `No se puede borrar: ${enPedidos} pedido(s) se enviaron a esta dirección. ` +
      'Edítala o captura una nueva.');
  }
  await model.eliminar(id, clienteId);
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
