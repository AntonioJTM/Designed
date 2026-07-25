'use strict';

const model = require('./model');
const variantesModel = require('../variantes/model');
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
    const codigo = (celdas.A ?? '').trim();
    const pesoTxt = (celdas.B ?? '').trim();

    if (!codigo && !pesoTxt) continue; // renglón en blanco al final
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

  // Los bultos que rinden distinto que la mayoría suelen venir incompletos:
  // conviene señalarlos sin bloquear la carga.
  const conteoConos = {};
  for (const b of bultos) if (b.conos) conteoConos[b.conos] = (conteoConos[b.conos] ?? 0) + 1;
  const conosNormal = Object.entries(conteoConos).sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const b of bultos) {
    if (b.conos && conosNormal && String(b.conos) !== conosNormal) {
      avisos.push({
        fila: b.fila,
        aviso: `El bulto ${b.codigo} rinde ${b.conos} conos y los demás ${conosNormal}: parece incompleto (${b.peso_kg} kg)`,
      });
    }
  }

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
 * Confirma la remesa: registra los bultos y da entrada al total en kilos.
 * Todo o nada; si un código ya existe, no se carga nada.
 */
async function confirmar(datos, usuarioId) {
  const variante = await variantesModel.obtener(datos.variante_id);
  if (!variante) throw new AppError(422, 'VARIANTE_INVALIDA', 'La presentación no existe');
  if (variante.tipo_presentacion !== 'paquete') {
    throw new AppError(422, 'NO_ES_PAQUETE',
      `"${variante.sku}" no es una presentación de tipo paquete; la remesa entra en kilos.`);
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
      variante_id: datos.variante_id,
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
