'use strict';

const model = require('./model');
const variantesModel = require('../variantes/model');
const variantesService = require('../variantes/service');
const { paginado } = require('../../utils/query');
const { AppError, enOtraTienda } = require('../../middlewares/error');

// Las cantidades son DECIMAL(12,3): un gramo de resolución.
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

async function listarStock(filtros) {
  const { rows, total } = await model.listarStock(filtros);
  if (!filtros.conUltimoMovimiento) return paginado(rows, total, filtros.page, filtros.limit);

  // La pantalla de Inventario dice qué fue lo último que le pasó a cada
  // renglón ("Remesa REM-0412", "Venta POS-91B0") con la MISMA etiqueta que el
  // kardex. Es opcional: quien solo pide existencias no necesita el documento.
  const ultimos = await model.ultimosMovimientos(rows);
  const porFila = new Map(ultimos.map((m) => [`${m.variante_id}-${m.almacen_id}`, m]));
  const items = rows.map((r) => {
    const m = porFila.get(`${r.variante_id}-${r.almacen_id}`);
    return {
      ...r,
      ultimo_movimiento: m
        ? { creado_en: m.creado_en, cantidad: m.cantidad, ..._describir(m) }
        : null,
    };
  });
  return paginado(items, total, filtros.page, filtros.limit);
}

async function resumenPorAlmacen(almacenes = null) {
  return model.resumenPorAlmacen(almacenes);
}

async function alertas(almacenes = null) {
  return model.alertas(almacenes);
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
    // Lo que REGRESA al cancelar (o al marcar "devuelto") una venta no es una
    // venta (2026-10-20, auditoría: salía "Venta mostrador" con +kg).
    const regresoPorCancelar = !salida && m.tipo !== 'devolucion';
    return {
      // El cliente regresó mercancía y le quedó a favor (2026-10-13): el folio
      // DEV-… va en el motivo.
      concepto: m.tipo === 'devolucion'
        ? 'Devolución del cliente'
        : regresoPorCancelar
          ? (/^devoluci/i.test(m.motivo ?? '') ? 'Regresó: se devolvió la venta' : 'Regresó: se canceló la venta')
          : `Venta ${canal}`,
      folio: m.numero_pedido,
      detalle_tipo: 'pedido',
      detalle_id: m.referencia_id,
    };
  }
  if (m.referencia_tipo === 'traspaso') {
    // Tres casos más que el envío y la recepción (2026-10-17): el FALTANTE que
    // se da de baja en quien recibe (llegó menos de lo enviado) y la mercancía
    // que REGRESA al origen al cancelar un envío en camino. Antes los dos salían
    // "Traspaso a…" / "Traspaso desde…" como si fueran un envío más.
    const regreso = !salida && m.traspaso_origen_id != null && Number(m.almacen_id) === Number(m.traspaso_origen_id);
    return {
      concepto: m.tipo === 'merma'
        ? `Faltante del traspaso desde ${m.traspaso_origen}: llegó menos`
        : regreso
          ? `Regresó: se canceló el traspaso a ${m.traspaso_destino}`
          : salida
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
      // El bulto que se abrió: es el rastro del desarme ("¿cuál se bajó?").
      codigo_bulto: m.conversion_bulto ?? null,
      detalle_tipo: 'conversion',
      detalle_id: m.referencia_id,
    };
  }

  if (m.referencia_tipo === 'remesa') {
    return {
      concepto: 'Carga del proveedor',
      folio: m.remesa_folio,
      detalle_tipo: 'remesa',
      detalle_id: m.referencia_id,
    };
  }

  // Un bulto capturado a mano en Presentaciones: entran sus kilos. Al quitar un
  // bulto que metió kilos (a mano o de una carga), salen. El código va también
  // en el motivo (el bulto puede ya no existir).
  if (m.referencia_tipo === 'bulto') {
    return {
      // 'transferencia': al surtir se escaneó un paquete que el sistema tenía
      // en otro almacén y se confirmó que sí estaba ahí (2026-10-07).
      concepto: m.tipo === 'transferencia'
        ? 'Paquete encontrado en otro almacén'
        : salida ? 'Se quitó un bulto' : 'Bulto capturado a mano',
      folio: null,
      codigo_bulto: m.bulto_codigo ?? null,
      detalle_tipo: null,
      detalle_id: null,
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
async function previaDesarmeBulto(codigo, almacenes = null) {
  const cod = String(codigo ?? '').trim();
  if (!cod) throw new AppError(422, 'CODIGO_REQUERIDO', 'Escanea o teclea el código del bulto');

  const bulto = await variantesModel.bultoPorCodigo(cod);
  if (!bulto) {
    throw new AppError(404, 'BULTO_DESCONOCIDO', `El bulto ${cod} no está registrado`);
  }
  if (bulto.estado && bulto.estado !== 'disponible') {
    const donde = bulto.consumido_folio ? ` en ${bulto.consumido_folio}` : '';
    throw enOtraTienda(new AppError(409, 'BULTO_NO_DISPONIBLE', bulto.estado === 'faltante'
      ? `El bulto ${bulto.codigo} se dio por faltante al recibir un envío${donde} (no llegó).`
      : `El bulto ${bulto.codigo} ya está ${bulto.estado}${donde}.`),
    [bulto.almacen_id], `El bulto ${bulto.codigo} no está disponible en esta tienda.`);
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
  const existencias = await model.existenciasDe(paquete.id, almacenes);
  // Dónde está ESTE paquete: tiene que estar en la tienda donde se abre.
  const u = await model.ubicacionBulto(null, bulto.id);

  return {
    bulto: {
      codigo: bulto.codigo,
      peso_kg: bulto.peso_kg,
      lote: bulto.lote,
      conos: bulto.conos,
      remesa_folio: bulto.remesa_folio,
      almacen_id: u?.almacen_id ?? null,
      // De otra tienda no se dice cuál (2026-10-15): solo que no está aquí.
      almacen: u?.almacen_id != null && Array.isArray(almacenes) && !almacenes.includes(Number(u.almacen_id))
        ? 'otra tienda'
        : u?.almacen ?? null,
      en_tienda: u?.almacen_id != null ? !!Number(u.es_punto_venta) : null,
      en_camino_folio: u?.en_camino_folio ?? null,
    },
    paquete: {
      variante_id: paquete.id,
      sku: paquete.sku,
      producto: paquete.producto,
      calibre: paquete.calibre ?? null,
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
 * Desarma UN paquete, SIEMPRE por su código (`codigo_bulto`): se resuelve el
 * paquete del bulto, se toman sus kilos y sus conos reales, y si el producto
 * todavía no tiene presentación de cono SE CREA con lo que dice el bulto. Así
 * bajar mercancía a mostrador es escanear (o escribir el código) y confirmar.
 *
 * Ya NO se acepta desarmar "a mano" con `cono_variante_id` + `paquetes` + `kg`
 * (2026-10-18, a petición del usuario): sacaba kilos del paquete sin marcar
 * ninguno como abierto, y ese paquete se seguía pudiendo vender o mandar. Los
 * kilos son SIEMPRE los del paquete escaneado; el cono, el de SU hilo.
 */
async function desarmar(datos, usuarioId, almacenes = null) {
  if (!datos.codigo_bulto) {
    throw new AppError(422, 'FALTA_CODIGO',
      'Escanea o escribe el código del paquete que vas a abrir');
  }
  const previa = await previaDesarmeBulto(datos.codigo_bulto, almacenes);
  const pesoBulto = Number(previa.bulto.peso_kg);
  if (!(pesoBulto > 0)) {
    throw new AppError(422, 'BULTO_SIN_PESO',
      `El paquete ${previa.bulto.codigo} no tiene peso registrado, así que no se sabe cuántos kilos sacar. ` +
        'En Presentaciones de su hilo quítalo (✕ en sus bultos) y vuelve a capturarlo con «Agregar bulto a mano», con su peso.');
  }
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
      paquetes: 1,
      kg: pesoBulto,
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
  // Es el MISMO peso con que se aparta una solicitud en paquetes.
  const { peso: promedio, nominal } = await model.pesoPorPaquete(null, v, almacen_id);

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
async function solicitarTraspaso(datos, usuarioId, opciones = {}) {
  if (!datos.items?.length) {
    throw new AppError(422, 'SIN_LINEAS', 'Agrega al menos un producto a la solicitud');
  }
  return model.solicitarTraspaso(datos, usuarioId, opciones);
}

async function enviarTraspaso(id, usuarioId, datos) {
  return model.enviarTraspaso(id, usuarioId, datos ?? {});
}

/** Guarda lo escaneado a medio surtir: esos paquetes quedan apartados para el envío. */
async function guardarEscaneos(id, usuarioId, datos) {
  return model.guardarEscaneos(id, usuarioId, datos?.codigos ?? [], datos?.encontrados ?? []);
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

/** Mínimo para varios hilos de un almacén (ver `model.minimosEnPaquetes`). */
async function minimos(datos) {
  return model.minimosEnPaquetes({
    almacen_id: datos.almacen_id,
    paquetes: datos.paquetes,
    solo_sin_minimo: datos.solo_sin_minimo !== false,
    guardar: datos.guardar === true,
  });
}

module.exports = {
  minimos,
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
  guardarEscaneos,
  recibirTraspaso,
  cancelarTraspaso,
  equivalenciaPaquetes,
  listarTraspasos,
  obtenerTraspaso,
  configurar,
};
