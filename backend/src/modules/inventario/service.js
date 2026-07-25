'use strict';

const model = require('./model');
const { paginado } = require('../../utils/query');
const { AppError } = require('../../middlewares/error');

async function listarStock(filtros) {
  const { rows, total } = await model.listarStock(filtros);
  return paginado(rows, total, filtros.page, filtros.limit);
}

async function resumenPorAlmacen() {
  return model.resumenPorAlmacen();
}

async function alertas() {
  return model.alertas();
}

/**
 * Traduce un movimiento a lenguaje de tienda: en vez de "transferencia −700"
 * dice "Traspaso a Tienda Moroleón". Deja también `detalle_tipo` y
 * `detalle_id` para que la pantalla pueda abrir el documento que lo originó.
 */
function _describir(m) {
  const salida = Number(m.cantidad) < 0;

  if (m.referencia_tipo === 'pedido') {
    const canal = m.pedido_canal === 'punto_venta' ? 'mostrador' : 'en línea';
    return {
      concepto: `Venta ${canal}`,
      folio: m.numero_pedido,
      detalle_tipo: 'pedido',
      detalle_id: m.referencia_id,
    };
  }
  if (m.referencia_tipo === 'traspaso') {
    return {
      concepto: salida
        ? `Traspaso a ${m.traspaso_destino}`
        : `Traspaso desde ${m.traspaso_origen}`,
      folio: m.traspaso_folio,
      detalle_tipo: 'traspaso',
      detalle_id: m.referencia_id,
    };
  }
  if (m.referencia_tipo === 'conversion') {
    return {
      concepto: salida
        ? `Desarme de paquetes ${m.conversion_paquete}`
        : `Conos producidos ${m.conversion_cono}`,
      folio: null,
      detalle_tipo: 'conversion',
      detalle_id: m.referencia_id,
    };
  }

  // Movimientos capturados a mano desde Inventario.
  const nombres = {
    entrada: 'Entrada de mercancía',
    salida: 'Salida manual',
    ajuste: 'Ajuste de inventario',
    devolucion: 'Devolución',
    merma: 'Merma',
    transferencia: salida ? 'Transferencia enviada' : 'Transferencia recibida',
  };
  return {
    concepto: nombres[m.tipo] ?? m.tipo,
    folio: null,
    detalle_tipo: null,
    detalle_id: null,
  };
}

async function listarMovimientos(filtros) {
  const { rows, total } = await model.listarMovimientos(filtros);
  const items = rows.map((m) => ({ ...m, ..._describir(m) }));
  return paginado(items, total, filtros.page, filtros.limit);
}

async function registrarMovimiento(datos, usuarioId) {
  return model.registrarMovimiento(datos, usuarioId);
}

async function transferir(datos, usuarioId) {
  return model.transferir(datos, usuarioId);
}

async function desarmar(datos, usuarioId) {
  return model.desarmar(datos, usuarioId);
}

async function listarConversiones(filtros) {
  const { rows, total } = await model.listarConversiones(filtros);
  return paginado(rows, total, filtros.page, filtros.limit);
}

async function crearTraspaso(datos, usuarioId) {
  if (!datos.items?.length) {
    throw new AppError(422, 'SIN_LINEAS', 'Agrega al menos un producto al traspaso');
  }
  return model.crearTraspaso(datos, usuarioId);
}

async function listarTraspasos(filtros) {
  const { rows, total } = await model.listarTraspasos(filtros);
  return paginado(rows, total, filtros.page, filtros.limit);
}

async function obtenerTraspaso(id) {
  const t = await model.obtenerTraspaso(id);
  if (!t) throw new AppError(404, 'NO_ENCONTRADO', 'Traspaso no encontrado');
  return t;
}

async function configurar(datos) {
  return model.configurar({
    variante_id: datos.variante_id,
    almacen_id: datos.almacen_id,
    stock_minimo: datos.stock_minimo ?? 0,
    stock_maximo: datos.stock_maximo ?? null,
    ubicacion_fisica: datos.ubicacion_fisica ?? null,
  });
}

module.exports = {
  listarStock,
  resumenPorAlmacen,
  alertas,
  listarMovimientos,
  registrarMovimiento,
  transferir,
  desarmar,
  listarConversiones,
  crearTraspaso,
  listarTraspasos,
  obtenerTraspaso,
  configurar,
};
