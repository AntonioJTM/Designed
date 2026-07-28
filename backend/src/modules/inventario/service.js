'use strict';

const model = require('./model');
const variantesModel = require('../variantes/model');
const variantesService = require('../variantes/service');
const { paginado } = require('../../utils/query');
const { AppError } = require('../../middlewares/error');

// Las cantidades son DECIMAL(12,3): un gramo de resolución.
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

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

/**
 * Lo que hace falta para bajar un bulto a mostrador, resuelto a partir del código
 * escaneado. Es una LECTURA: no mueve nada, sirve para que la pantalla muestre
 * qué va a pasar antes de confirmar.
 *
 * El bulto ya trae cuántos conos rinde (viene en la lista de empaque), así que no
 * hay que configurar nada: se responde el paquete, sus kilos reales, los conos y
 * en qué almacén está.
 */
async function previaDesarmeBulto(codigo) {
  const cod = String(codigo ?? '').trim();
  if (!cod) throw new AppError(422, 'CODIGO_REQUERIDO', 'Escanea o teclea el código del bulto');

  const bulto = await variantesModel.bultoPorCodigo(cod);
  if (!bulto) {
    throw new AppError(404, 'BULTO_DESCONOCIDO', `El bulto ${cod} no está registrado`);
  }
  if (bulto.estado && bulto.estado !== 'disponible') {
    const donde = bulto.consumido_folio ? ` en ${bulto.consumido_folio}` : '';
    throw new AppError(409, 'BULTO_NO_DISPONIBLE',
      `El bulto ${bulto.codigo} ya está ${bulto.estado}${donde}.`);
  }

  const paquete = await variantesModel.obtener(bulto.variante_id);
  if (!paquete) throw new AppError(422, 'VARIANTE_INVALIDA', 'La presentación del bulto no existe');
  if (paquete.tipo_presentacion === 'cono') {
    throw new AppError(422, 'ES_UN_CONO',
      `${paquete.sku} ya es un cono: no hay nada que desarmar.`);
  }

  // El cono puede no existir todavía: se creará al confirmar, con los conos que
  // dice el bulto. Aquí solo se informa.
  const cono = await model.conoDe(paquete.id);
  // Dónde hay existencias de ese paquete, para proponer el almacén de origen.
  const existencias = await model.existenciasDe(paquete.id);

  return {
    bulto: {
      codigo: bulto.codigo,
      peso_kg: bulto.peso_kg,
      lote: bulto.lote,
      conos: bulto.conos,
      remesa_folio: bulto.remesa_folio,
    },
    paquete: {
      variante_id: paquete.id,
      sku: paquete.sku,
      producto: paquete.producto,
      presentacion: paquete.presentacion,
      peso_kg: paquete.peso_kg,
      precio: paquete.precio,
    },
    cono: cono
      ? { variante_id: cono.id, sku: cono.sku, piezas_por_origen: cono.piezas_por_origen, precio: cono.precio }
      : null,
    // Cuántos conos se van a dar de alta: los del bulto, o los del cono ya
    // configurado si el bulto no lo dice.
    conos_a_generar: bulto.conos ?? cono?.piezas_por_origen ?? null,
    existencias,
  };
}

/**
 * Desarma. Se puede mandar `cono_variante_id` (como siempre) o solo el
 * `codigo_bulto`: en ese caso se resuelve el paquete del bulto, se toman sus
 * kilos y sus conos reales, y si el producto todavía no tiene presentación de
 * cono SE CREA con lo que dice el bulto. Así bajar mercancía a mostrador es
 * escanear y confirmar, sin configurar nada antes.
 */
async function desarmar(datos, usuarioId) {
  if (datos.cono_variante_id) return model.desarmar(datos, usuarioId);

  if (!datos.codigo_bulto) {
    throw new AppError(422, 'FALTA_DESTINO',
      'Escanea el bulto o indica qué cono se va a producir');
  }
  const previa = await previaDesarmeBulto(datos.codigo_bulto);
  const conos = datos.conos ?? previa.conos_a_generar;
  if (!conos) {
    throw new AppError(422, 'CONOS_REQUERIDOS',
      `El bulto ${previa.bulto.codigo} no dice cuántos conos rinde. Captúralo.`);
  }

  // El cono nace la primera vez que se baja un paquete a mostrador.
  const cono =
    previa.cono ??
    (await variantesService.crear({
      producto_id: (await variantesModel.obtener(previa.paquete.variante_id)).producto_id,
      sku: `${previa.paquete.sku}-CONO`,
      presentacion: 'Cono',
      tipo_presentacion: 'cono',
      origen_variante_id: previa.paquete.variante_id,
      piezas_por_origen: conos,
      modo_precio: 'calculado',
    }));

  return model.desarmar(
    {
      ...datos,
      cono_variante_id: cono.variante_id ?? cono.id,
      paquetes: datos.paquetes ?? 1,
      kg: datos.kg ?? Number(previa.bulto.peso_kg),
      conos,
    },
    usuarioId
  );
}

async function listarConversiones(filtros) {
  const { rows, total } = await model.listarConversiones(filtros);
  return paginado(rows, total, filtros.page, filtros.limit);
}

/**
 * Traduce entre kilos y paquetes con los pesos REALES de la bodega, para que la
 * pantalla pueda decir "100 kg ≈ 5 paquetes (95.5 kg, te faltan 4.5)".
 *
 * Se usa el promedio de los bultos que de verdad hay, no el peso nominal: los
 * bultos varían tanto (10.75 a 19.80 kg) que el nominal nunca corresponde.
 */
async function equivalenciaPaquetes({ variante_id, almacen_id, kg }) {
  const v = await variantesModel.obtener(variante_id);
  if (!v) throw new AppError(422, 'VARIANTE_INVALIDA', 'La presentación no existe');

  const d = await model.disponibilidadEnPaquetes(variante_id, almacen_id);
  // Sin bultos ubicados se cae al peso nominal de la presentación, y se avisa.
  const promedio = d.peso_promedio || Number(v.peso_kg) || 0;
  const nominal = d.paquetes === 0;

  const resp = {
    sku: v.sku,
    producto: v.producto,
    peso_nominal: v.peso_kg,
    disponible: d,
    // Con qué peso se hizo la cuenta y de dónde salió.
    peso_referencia: round3(promedio),
    referencia_nominal: nominal,
    sugerencia: null,
  };
  if (!kg || !promedio) return resp;

  // Cuántos paquetes cubren esos kilos, por debajo y por arriba.
  const exacto = Number(kg) / promedio;
  const menos = Math.max(0, Math.floor(exacto));
  const mas = Math.ceil(exacto);
  const pesar = (n) => round3(n * promedio);

  resp.sugerencia = {
    kg_pedidos: round3(kg),
    paquetes_exactos: round3(exacto),
    opciones: [
      ...(menos > 0 && menos !== mas
        ? [{ paquetes: menos, kg_aprox: pesar(menos), diferencia: round3(pesar(menos) - kg) }]
        : []),
      { paquetes: mas, kg_aprox: pesar(mas), diferencia: round3(pesar(mas) - kg) },
    ],
  };
  return resp;
}

/**
 * El traspaso tiene tres pasos y cada uno tiene su función: solicitar (aparta),
 * enviar (sale del origen) y recibir (entra al destino, con acuse). Antes era uno
 * solo, inmediato.
 */
async function solicitarTraspaso(datos, usuarioId) {
  if (!datos.items?.length) {
    throw new AppError(422, 'SIN_LINEAS', 'Agrega al menos un producto a la solicitud');
  }
  return model.solicitarTraspaso(datos, usuarioId);
}

async function enviarTraspaso(id, usuarioId) {
  return model.enviarTraspaso(id, usuarioId);
}

async function recibirTraspaso(id, usuarioId, datos) {
  return model.recibirTraspaso(id, usuarioId, datos ?? {});
}

async function cancelarTraspaso(id, usuarioId, motivo) {
  return model.cancelarTraspaso(id, usuarioId, motivo);
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
  desarmar,
  previaDesarmeBulto,
  listarConversiones,
  solicitarTraspaso,
  enviarTraspaso,
  recibirTraspaso,
  cancelarTraspaso,
  equivalenciaPaquetes,
  listarTraspasos,
  obtenerTraspaso,
  configurar,
};
