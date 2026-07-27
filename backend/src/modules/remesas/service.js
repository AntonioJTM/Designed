'use strict';

const model = require('./model');
const variantesModel = require('../variantes/model');
const variantesService = require('../variantes/service');
const productosModel = require('../productos/model');
const almacenesModel = require('../almacenes/model');
const { leerHoja } = require('../../utils/xlsx');
const { AppError } = require('../../middlewares/error');
const { paginado } = require('../../utils/query');

// Importación de la lista de empaque del proveedor.
//
// El formato del archivo es fijo (así lo confirmó la tienda), una hoja con el
// encabezado en el primer renglón y una columna por dato:
//
//   A  Código presentación*   código de barras del bulto      (obligatorio)
//   B  Cantidad *             peso real del bulto en kilos    (obligatorio)
//   C  Lote                   lote de la remesa
//   D  Fecha produccion       (viene vacía)
//   E  Fecha caducidad        (viene vacía)
//   F  CONO                   conos que rinde ese bulto
//   G  PAQUETE                siempre 1; es el bulto en sí
//
// Cada bulto es un ejemplar de la MISMA presentación del catálogo, no una
// presentación nueva: el precio y la unidad viven en la variante.

const COLUMNAS = {
  A: 'Código presentación',
  B: 'Cantidad',
  C: 'Lote',
  F: 'CONO',
};

const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

/**
 * Convierte el archivo en una lista de bultos, con los problemas detectados.
 * No toca la base: sirve para mostrar la vista previa antes de confirmar.
 */
function analizar(buffer, nombreArchivo) {
  let hoja;
  let filas;
  try {
    ({ hoja, filas } = leerHoja(buffer));
  } catch (err) {
    throw new AppError(422, 'ARCHIVO_ILEGIBLE',
      `No se pudo leer el archivo: ${err.message}`);
  }
  if (filas.length < 2) {
    throw new AppError(422, 'ARCHIVO_VACIO', 'El archivo no tiene renglones de datos');
  }

  // El primer renglón con datos es el encabezado; se valida para avisar pronto
  // si alguien mandó otro formato.
  const encabezado = filas[0].celdas;
  const faltantes = Object.entries(COLUMNAS)
    .filter(([col, etiqueta]) => !(encabezado[col] ?? '').toLowerCase().includes(etiqueta.toLowerCase().slice(0, 6)))
    .map(([col, etiqueta]) => `${col} (${etiqueta})`);
  if (faltantes.length) {
    throw new AppError(422, 'FORMATO_INESPERADO',
      `El encabezado no coincide con el formato esperado. Revisa las columnas: ${faltantes.join(', ')}`);
  }

  const bultos = [];
  const avisos = [];
  const vistos = new Set();

  for (const { fila, celdas } of filas.slice(1)) {
    // Solo se leen A, B, C y F. Las columnas de fecha (D y E) vienen vacías en
    // este formato y no se usan para nada: si algún día traen algo, se ignora.
    const codigo = (celdas.A ?? '').trim();
    const pesoTxt = (celdas.B ?? '').trim();

    // Renglón vacío: no cuenta y no se avisa. Pasa al final del archivo y en los
    // huecos que deja el proveedor entre lotes.
    const vacio = !Object.values(celdas).some((v) => String(v ?? '').trim() !== '');
    if (vacio || (!codigo && !pesoTxt)) continue;

    if (!codigo) {
      avisos.push({ fila, aviso: 'Sin código de bulto; se omite el renglón' });
      continue;
    }
    const peso = Number(pesoTxt.replace(',', '.'));
    if (!Number.isFinite(peso) || peso <= 0) {
      avisos.push({ fila, aviso: `Peso inválido ("${pesoTxt}") en el bulto ${codigo}; se omite` });
      continue;
    }
    if (vistos.has(codigo)) {
      avisos.push({ fila, aviso: `El código ${codigo} viene repetido en el archivo; se omite` });
      continue;
    }
    vistos.add(codigo);

    const conos = celdas.F ? Number(celdas.F) : null;
    bultos.push({
      fila,
      codigo,
      peso_kg: round3(peso),
      lote: (celdas.C ?? '').trim() || null,
      conos: Number.isFinite(conos) && conos > 0 ? conos : null,
    });
  }

  if (bultos.length === 0) {
    throw new AppError(422, 'SIN_BULTOS', 'El archivo no trae bultos utilizables');
  }

  // Que un bulto rinda menos conos que los demás NO es un problema: así viene de
  // fábrica. Se carga tal cual y su rendimiento real queda guardado en el bulto,
  // que es lo que el desarme necesita. No se avisa nada: sería ruido.

  const porLote = {};
  for (const b of bultos) {
    const l = b.lote ?? '(sin lote)';
    porLote[l] = porLote[l] ?? { lote: l, bultos: 0, kg: 0 };
    porLote[l].bultos += 1;
    porLote[l].kg = round3(porLote[l].kg + b.peso_kg);
  }

  const pesos = bultos.map((b) => b.peso_kg);
  return {
    archivo: nombreArchivo ?? null,
    hoja,
    bultos,
    avisos,
    resumen: {
      num_bultos: bultos.length,
      kg_total: round3(pesos.reduce((s, p) => s + p, 0)),
      peso_min: Math.min(...pesos),
      peso_max: Math.max(...pesos),
      conos_totales: bultos.reduce((s, b) => s + (b.conos ?? 0), 0),
      lotes: Object.values(porLote).sort((a, b) => a.lote.localeCompare(b.lote)),
    },
  };
}

/** Vista previa: analiza y además avisa qué códigos ya existen en la base. */
async function previa(buffer, nombreArchivo) {
  const r = analizar(buffer, nombreArchivo);
  const duplicados = await model.codigosExistentes(r.bultos.map((b) => b.codigo));
  if (duplicados.length) {
    const set = new Set(duplicados.map((d) => d.codigo));
    for (const b of r.bultos) {
      if (set.has(b.codigo)) {
        const d = duplicados.find((x) => x.codigo === b.codigo);
        r.avisos.push({
          fila: b.fila,
          aviso: `El código ${b.codigo} ya está registrado en "${d.producto} · ${d.sku}"`,
          bloqueante: true,
        });
      }
    }
  }
  r.duplicados = duplicados.map((d) => d.codigo);
  r.se_puede_cargar = duplicados.length === 0;
  return r;
}

/**
 * Resuelve en qué presentación entra la remesa.
 *
 * Se puede mandar `variante_id` (la presentación exacta) o `producto_id`, que es
 * como se usa desde la pantalla del producto: se busca su presentación en kilos
 * y, si el producto todavía no tiene ninguna, SE CREA con los datos del propio
 * archivo. Así el alta es: guardar el producto → subir el Excel.
 */
async function _resolverPresentacion(datos, bultos) {
  if (datos.variante_id) {
    const v = await variantesModel.obtener(datos.variante_id);
    if (!v) throw new AppError(422, 'VARIANTE_INVALIDA', 'La presentación no existe');
    return v;
  }

  const producto = await productosModel.obtener(datos.producto_id);
  if (!producto) throw new AppError(422, 'PRODUCTO_INVALIDO', 'El producto no existe');

  // Las que se inventarían en kilos: primero el paquete, luego la simple. Un
  // cono no sirve, se lleva en piezas.
  const { rows } = await variantesModel.listar({
    producto_id: datos.producto_id,
    limit: 200,
    offset: 0,
  });
  const enKilos = rows.filter((v) => v.tipo_presentacion !== 'cono');
  const existente =
    enKilos.find((v) => v.tipo_presentacion === 'paquete') ?? enKilos[0] ?? null;

  if (existente) {
    // La presentación se crea al dar de alta el producto, sin peso: no había
    // mercancía. La primera remesa lo completa con el PROMEDIO real de sus
    // bultos, que es el dato bueno para el desarme y el precio del cono.
    if (!existente.peso_kg || Number(existente.peso_kg) <= 0) {
      const pesos = bultos.map((b) => Number(b.peso_kg));
      const promedio = round3(pesos.reduce((s, x) => s + x, 0) / pesos.length);
      await variantesService.actualizar(existente.id, { peso_kg: promedio });
      return { ...existente, peso_kg: promedio };
    }
    return existente;
  }

  // No tiene ninguna: se crea con lo que dice el archivo. El peso del paquete es
  // el PROMEDIO de los bultos (varían entre sí) y el precio lo hereda del
  // producto. Ambos se pueden corregir después.
  const pesos = bultos.map((b) => Number(b.peso_kg));
  const promedio = round3(pesos.reduce((s, p) => s + p, 0) / pesos.length);

  return variantesService.crear({
    producto_id: datos.producto_id,
    sku: await variantesService.skuDesdeNombre(producto.nombre),
    presentacion: producto.multipresentacion ? 'Paquete' : null,
    tipo_presentacion: producto.multipresentacion ? 'paquete' : 'simple',
    peso_kg: promedio,
  });
}

/**
 * Confirma la remesa: registra los bultos y da entrada al total en kilos.
 * Todo o nada; si un código ya existe, no se carga nada.
 */
async function confirmar(datos, usuarioId) {
  if (!datos.variante_id && !datos.producto_id) {
    throw new AppError(422, 'FALTA_DESTINO',
      'Indica el producto o la presentación a la que entra la remesa');
  }

  const variante = await _resolverPresentacion(datos, datos.bultos);
  if (variante.tipo_presentacion === 'cono') {
    throw new AppError(422, 'NO_ES_PAQUETE',
      `"${variante.sku}" es un cono y se lleva en piezas; la remesa entra en kilos.`);
  }
  const almacen = await almacenesModel.obtener(datos.almacen_id);
  if (!almacen) throw new AppError(422, 'ALMACEN_INVALIDO', 'El almacén no existe');

  const duplicados = await model.codigosExistentes(datos.bultos.map((b) => b.codigo));
  if (duplicados.length) {
    throw new AppError(409, 'CODIGOS_DUPLICADOS',
      `${duplicados.length} código(s) ya están registrados: ${duplicados
        .slice(0, 5)
        .map((d) => d.codigo)
        .join(', ')}${duplicados.length > 5 ? '…' : ''}`);
  }

  return model.crearRemesa(
    {
      variante_id: variante.id,
      almacen_id: datos.almacen_id,
      archivo: datos.archivo ?? null,
      notas: datos.notas ?? null,
      bultos: datos.bultos.map((b) => ({
        codigo: String(b.codigo).trim(),
        peso_kg: round3(b.peso_kg),
        lote: b.lote ?? null,
        conos: b.conos ?? null,
      })),
    },
    usuarioId
  );
}

async function listar(filtros) {
  const { rows, total } = await model.listar(filtros);
  return paginado(rows, total, filtros.page, filtros.limit);
}

async function obtener(id) {
  const r = await model.obtener(id);
  if (!r) throw new AppError(404, 'NO_ENCONTRADO', 'Remesa no encontrada');
  return r;
}

module.exports = { analizar, previa, confirmar, listar, obtener };
