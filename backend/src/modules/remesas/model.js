'use strict';

const crypto = require('crypto');
const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');

// Remesas: la lista de empaque del proveedor convertida en bultos + entrada de
// inventario. Los bultos viven en `variante_codigos` (cada uno con su peso real
// y su lote); el inventario sigue siendo un saldo en kilos por almacén.

const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

/** Cuántos bultos van en cada INSERT. */
const TANDA_BULTOS = 100;

/** Códigos que ya están registrados, con la variante a la que pertenecen. */
async function codigosExistentes(codigos) {
  if (!codigos.length) return [];
  const [rows] = await pool.query(
    `SELECT vc.codigo, pv.sku, prod.nombre AS producto
       FROM variante_codigos vc
       JOIN producto_variantes pv ON pv.id = vc.variante_id
       JOIN productos prod        ON prod.id = pv.producto_id
      WHERE vc.codigo IN (:codigos)
     UNION
     SELECT pv.codigo_barras AS codigo, pv.sku, prod.nombre AS producto
       FROM producto_variantes pv
       JOIN productos prod ON prod.id = pv.producto_id
      WHERE pv.codigo_barras IN (:codigos)`,
    { codigos }
  );
  return rows;
}

/**
 * Registra la remesa completa en una sola transacción: el documento, sus
 * bultos y la entrada al inventario con su movimiento de kardex.
 */
async function crearRemesa(datos, usuarioId) {
  return withTransaction((conn) => _crearRemesaEn(conn, datos, usuarioId));
}

/**
 * Lo mismo, dentro de una transacción que ya está abierta. La lista completa
 * del proveedor (varios hilos) hace una de estas por hilo, todas juntas: o
 * entra la lista entera o no entra nada.
 */
async function _crearRemesaEn(conn, datos, usuarioId, alAvanzar = null) {
  const { variante_id, almacen_id, bultos } = datos;
  const kgTotal = round3(bultos.reduce((s, b) => s + Number(b.peso_kg), 0));
  const lotes = [...new Set(bultos.map((b) => b.lote).filter(Boolean))];

  const folio = `REM-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const [r] = await conn.query(
    `INSERT INTO remesas
       (folio, variante_id, almacen_id, proveedor_id, usuario_id, num_bultos, kg_total, costo_kg,
        factura, pedimento, contenedor, fecha_ingreso, lista, lotes, archivo, notas)
     VALUES (:folio, :variante_id, :almacen_id, :proveedor_id, :usuario_id, :num_bultos, :kg_total,
             :costo_kg, :factura, :pedimento, :contenedor, COALESCE(:fecha_ingreso, CURDATE()),
             :lista, :lotes, :archivo, :notas)`,
    {
      folio,
      variante_id,
      almacen_id,
      // De quién llegó y con qué papeles (2026-10-06). La fecha de ingreso es
      // el día que llegó; sin ella, hoy.
      proveedor_id: datos.proveedor_id ?? null,
      factura: datos.factura ?? null,
      pedimento: datos.pedimento ?? null,
      contenedor: datos.contenedor ?? null,
      fecha_ingreso: datos.fecha_ingreso ?? null,
      lista: datos.lista ?? null,
      usuario_id: usuarioId ?? null,
      num_bultos: bultos.length,
      kg_total: kgTotal,
      // A cómo salió el kilo en esta compra. Opcional: si no se captura, el
      // costo del hilo se queda como estaba y el margen de lo que se venda
      // de aquí en adelante lo dirá.
      costo_kg: datos.costo_kg ?? null,
      lotes: lotes.join(', ') || null,
      archivo: datos.archivo ?? null,
      notas: datos.notas ?? null,
    }
  );
  const remesaId = r.insertId;

  // Los bultos, de cien en cien (el código es único en toda la base). Uno por
  // uno eran cientos de viajes a la base: la lista real de 718 bultos tardó un
  // minuto. Quedan ubicados en el almacén que recibe la remesa; de ahí saldrán
  // al traspasar. `alAvanzar` dice cuántos van, para la barra de la pantalla.
  for (let i = 0; i < bultos.length; i += TANDA_BULTOS) {
    const tanda = bultos.slice(i, i + TANDA_BULTOS);
    await conn.query(
      `INSERT INTO variante_codigos
         (variante_id, codigo, peso_kg, lote, conos, almacen_id, remesa_id)
       VALUES ?`,
      [tanda.map((b) => [variante_id, b.codigo, b.peso_kg, b.lote ?? null, b.conos ?? null, almacen_id, remesaId])]
    );
    if (alAvanzar) alAvanzar(i + tanda.length);
  }

  // Entrada al inventario por el total de la remesa.
  const [inv] = await conn.query(
    'SELECT cantidad FROM inventario WHERE variante_id = :v AND almacen_id = :a FOR UPDATE',
    { v: variante_id, a: almacen_id }
  );
  const saldoAnterior = inv[0] ? Number(inv[0].cantidad) : 0;
  const saldoNuevo = round3(saldoAnterior + kgTotal);
  await conn.query(
    `INSERT INTO inventario (variante_id, almacen_id, cantidad)
     VALUES (:v, :a, :nuevo)
     ON DUPLICATE KEY UPDATE cantidad = :nuevo`,
    { v: variante_id, a: almacen_id, nuevo: saldoNuevo }
  );
  await conn.query(
    `INSERT INTO movimientos_inventario
       (variante_id, almacen_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id, motivo)
     VALUES (:v, :a, 'entrada', :cant, 'remesa', :remesa, :usuario, :motivo)`,
    {
      v: variante_id,
      a: almacen_id,
      cant: kgTotal,
      remesa: remesaId,
      usuario: usuarioId ?? null,
      motivo:
        datos.notas ??
        `Remesa ${folio}: ${bultos.length} bultos${lotes.length ? `, lote(s) ${lotes.join(', ')}` : ''}`,
    }
  );

  // El COSTO del hilo, por promedio ponderado móvil. Se mezcla lo que ya
  // había con lo que entra:
  //
  //   costo_nuevo = (kg_previos × costo_previo + kg_remesa × costo_remesa)
  //                 ÷ (kg_previos + kg_remesa)
  //
  // Los "kg previos" son los de TODOS los almacenes, no solo el que recibe:
  // el costo es del hilo, no del sitio donde está guardado.
  let costoNuevo = null;
  if (datos.costo_kg != null) {
    const [crows] = await conn.query(
      `SELECT pv.costo,
              COALESCE((SELECT SUM(i.cantidad) FROM inventario i
                         WHERE i.variante_id = pv.id), 0) AS kg_totales
         FROM producto_variantes pv WHERE pv.id = :v FOR UPDATE`,
      { v: variante_id }
    );
    const costoPrevio = crows[0]?.costo != null ? Number(crows[0].costo) : null;
    // Los kilos de antes: el saldo ya incluye esta remesa, así que se resta.
    const kgPrevios = Math.max(0, round3(Number(crows[0]?.kg_totales ?? 0) - kgTotal));
    const costoRemesa = Number(datos.costo_kg);

    costoNuevo =
      costoPrevio == null || kgPrevios <= 0
        // Primera compra con costo, o no quedaba nada: el costo es el de esta.
        ? costoRemesa
        : Math.round(
            ((kgPrevios * costoPrevio + kgTotal * costoRemesa) / (kgPrevios + kgTotal)) * 100
          ) / 100;

    await conn.query(
      `UPDATE producto_variantes
          SET costo = :costo, costo_actualizado_en = NOW()
        WHERE id = :v`,
      { costo: costoNuevo, v: variante_id }
    );
  }

  return {
    id: remesaId,
    folio,
    num_bultos: bultos.length,
    kg_total: kgTotal,
    lotes,
    saldo_anterior: saldoAnterior,
    saldo_nuevo: saldoNuevo,
    costo_kg: datos.costo_kg ?? null,
    // Cuál quedó como costo del hilo después de mezclar. La pantalla lo
    // muestra para que se vea el efecto de la compra.
    costo_promedio: costoNuevo,
  };
}

/** Un SKU libre a partir del hilo ("MARINO 2/30" → MARINO-2-30), mirando lo que ya creó esta misma transacción. */
async function _skuLibre(conn, texto) {
  const base =
    String(texto ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 45) || 'PRESENTACION';
  for (let i = 0; i < 50; i++) {
    const sku = i === 0 ? base : `${base}-${i + 1}`;
    const [[ocupado]] = await conn.query(
      `SELECT (EXISTS (SELECT 1 FROM producto_variantes WHERE sku = :s OR codigo_barras = :s)
            OR EXISTS (SELECT 1 FROM variante_codigos WHERE codigo = :s)) AS si`,
      { s: sku }
    );
    if (!Number(ocupado.si)) return sku;
  }
  throw new AppError(409, 'SKU_OCUPADO', `No se pudo generar un SKU libre para "${texto}"`);
}

/**
 * La lista completa del proveedor, en UNA transacción. Por cada hilo (color +
 * calibre): si no existe se crea —SIN precio, con el material y la línea que se
 * eligieron en la pantalla—, se le crea su presentación de paquete si no la
 * tiene (peso = promedio real de sus bultos), y entra su carga.
 *
 * Un hilo sin precio queda con la presentación en $0: NO se puede vender (la
 * venta lo rechaza con SIN_PRECIO) y la campana avisa hasta que se le ponga.
 *
 * `catalogo` y `empatar` vienen de lista.js: así el empate es el mismo que vio
 * la vista previa, pero leído con la conexión de esta transacción. `avisar`
 * recibe lo que se va haciendo (hilo por hilo y los bultos que van), para que
 * la pantalla lo diga mientras carga.
 */
async function crearLista(datos, usuarioId, { catalogo, empatar, avisar = () => {} }) {
  // Las cargas de un mismo archivo comparten esta marca: así sus datos
  // (factura, pedimento…) se corrigen de una vez.
  const marcaLista = `LST-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  return withTransaction(async (conn) => {
    const cat = await catalogo(conn);
    const [[kg]] = await conn.query(`SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1`);
    if (!kg) throw new AppError(422, 'SIN_UNIDAD_KG', 'No existe la unidad kilogramo en el catálogo');

    let material = null;
    const cargas = [];
    const totalBultos = datos.hilos.reduce((s, h) => s + h.bultos.length, 0);
    let bultosAntes = 0;
    for (const [i, h] of datos.hilos.entries()) {
      const hilo = `${h.nombre} ${h.calibre}`;
      const { producto, ambiguos } = empatar(cat, h.nombre, h.calibre);
      avisar({ tipo: 'hilo', i, n: datos.hilos.length, hilo, nuevo: !producto && !ambiguos.length });
      if (ambiguos.length) {
        throw new AppError(409, 'HILO_AMBIGUO',
          `Hay ${ambiguos.length} hilos «${hilo}» en el catálogo; deja uno solo para saber a cuál cargar.`);
      }
      const pesos = h.bultos.map((b) => Number(b.peso_kg));
      const promedio = round3(pesos.reduce((s, x) => s + x, 0) / pesos.length);

      let productoId = producto?.id ?? null;
      let multipresentacion = producto ? !!producto.multipresentacion : true;
      let precio = producto?.precio_kg != null ? Number(producto.precio_kg) : 0;

      if (!producto) {
        // Hilo nuevo: necesita material (y su calibre tiene que ser de ese material).
        if (!material) {
          if (!datos.categoria_id) {
            throw new AppError(422, 'FALTA_MATERIAL', 'Elige el material de los hilos nuevos.');
          }
          const [[c]] = await conn.query(
            'SELECT id, nombre, calibres, activo FROM categorias WHERE id = :id', { id: datos.categoria_id });
          if (!c) throw new AppError(422, 'MATERIAL_INVALIDO', 'El material no existe.');
          material = c;
          if (datos.linea_id) {
            const [[l]] = await conn.query('SELECT id FROM lineas WHERE id = :id', { id: datos.linea_id });
            if (!l) throw new AppError(422, 'LINEA_INVALIDA', 'La línea no existe.');
          }
        }
        const calibres = String(material.calibres ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        if (calibres.length && !calibres.includes(h.calibre)) {
          throw new AppError(422, 'CALIBRE_NO_DEL_MATERIAL',
            `${material.nombre} no tiene el calibre ${h.calibre} (tiene ${calibres.join(', ')}). ` +
            'Agrégalo en Materiales o corrige el archivo.');
        }
        const [ins] = await conn.query(
          `INSERT INTO productos
             (categoria_id, linea_id, unidad_medida_id, impuesto_id, nombre, descripcion, grosor_calibre,
              precio_kg, multipresentacion, por_lotes, destacado, activo)
           VALUES (:categoria, :linea, :unidad, NULL, :nombre, NULL, :calibre, NULL, 1, 0, 0, 1)`,
          { categoria: material.id, linea: datos.linea_id ?? null, unidad: kg.id, nombre: h.nombre, calibre: h.calibre }
        );
        productoId = ins.insertId;
        multipresentacion = true;
        precio = 0;
      }

      // Su presentación en kilos: la que ya tiene o una nueva de paquete.
      let varianteId = producto?.variante_id ?? null;
      if (varianteId) {
        // La presentación se crea al dar de alta el producto, sin peso: la
        // primera carga lo completa con el promedio real.
        if (!producto.peso_kg || Number(producto.peso_kg) <= 0) {
          await conn.query('UPDATE producto_variantes SET peso_kg = :peso WHERE id = :id', { peso: promedio, id: varianteId });
        }
        precio = Number(producto.precio ?? 0);
      } else {
        const sku = await _skuLibre(conn, hilo);
        const [vins] = await conn.query(
          `INSERT INTO producto_variantes
             (producto_id, sku, codigo_barras, presentacion, tipo_presentacion, peso_kg, modo_precio, precio, activo)
           VALUES (:producto, :sku, :sku, :presentacion, :tipo, :peso, 'manual', :precio, 1)`,
          {
            producto: productoId,
            sku,
            presentacion: multipresentacion ? 'Paquete' : null,
            tipo: multipresentacion ? 'paquete' : 'simple',
            peso: promedio,
            precio,
          }
        );
        varianteId = vins.insertId;
      }

      const r = await _crearRemesaEn(
        conn,
        {
          variante_id: varianteId,
          almacen_id: datos.almacen_id,
          archivo: datos.archivo,
          notas: datos.notas,
          costo_kg: h.costo_kg,
          proveedor_id: datos.proveedor_id,
          factura: datos.factura,
          pedimento: datos.pedimento,
          contenedor: datos.contenedor,
          fecha_ingreso: datos.fecha_ingreso,
          lista: marcaLista,
          bultos: h.bultos,
        },
        usuarioId,
        (hechos) => avisar({ tipo: 'bultos', hilo, hechos: bultosAntes + hechos, total: totalBultos })
      );
      bultosAntes += h.bultos.length;
      avisar({ tipo: 'hilo_listo', i, hilo, folio: r.folio });
      cargas.push({
        ...r,
        producto_id: productoId,
        hilo,
        nuevo: !producto,
        // Lo que cobra la caja: en $0 no se puede vender.
        sin_precio: !(precio > 0),
      });
    }

    avisar({ tipo: 'paso', texto: 'Guardando todo junto' });
    return {
      cargas,
      ids: cargas.map((c) => c.id),
      num_hilos: cargas.length,
      nuevos: cargas.filter((c) => c.nuevo).length,
      num_bultos: cargas.reduce((s, c) => s + c.num_bultos, 0),
      kg_total: round3(cargas.reduce((s, c) => s + c.kg_total, 0)),
      sin_precio: cargas.filter((c) => c.sin_precio).map((c) => ({ producto_id: c.producto_id, hilo: c.hilo })),
    };
  });
}

const SELECT_REMESA = `
  SELECT r.id, r.folio, r.num_bultos, r.kg_total, r.costo_kg, r.lotes, r.archivo, r.notas, r.creado_en,
         r.proveedor_id, prv.nombre AS proveedor, r.factura, r.pedimento, r.contenedor,
         DATE_FORMAT(r.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso, r.lista,
         (SELECT COUNT(*) FROM remesas r2 WHERE r2.lista = r.lista) AS cargas_en_lista,
         r.variante_id, pv.sku, prod.nombre AS producto,
         -- El calibre viaja para poder cotejarlo con el nombre del archivo: el
         -- del proveedor se llama "COLOR CALIBRE.xlsx" y así el historial marca
         -- las que entraron al hilo equivocado.
         prod.grosor_calibre AS calibre,
         r.almacen_id, a.nombre AS almacen, u.nombre AS usuario
    FROM remesas r
    JOIN producto_variantes pv ON pv.id = r.variante_id
    JOIN productos prod        ON prod.id = pv.producto_id
    JOIN almacenes a           ON a.id = r.almacen_id
    LEFT JOIN usuarios u       ON u.id = r.usuario_id
    LEFT JOIN proveedores prv  ON prv.id = r.proveedor_id
`;

async function listar({ variante_id, producto_id, proveedor_id, limit, offset }) {
  const cond = [];
  if (variante_id) cond.push('r.variante_id = :variante_id');
  if (proveedor_id) cond.push('r.proveedor_id = :proveedor_id');
  // Por hilo: todas sus presentaciones. El conteo necesita el mismo JOIN.
  if (producto_id) cond.push('r.variante_id IN (SELECT id FROM producto_variantes WHERE producto_id = :producto_id)');
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const params = { variante_id, producto_id, proveedor_id, limit, offset };
  const [rows] = await pool.query(
    `${SELECT_REMESA} ${where} ORDER BY r.creado_en DESC, r.id DESC LIMIT :limit OFFSET :offset`,
    params
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM remesas r ${where}`,
    params
  );
  return { rows, total };
}

async function obtener(id) {
  const [rows] = await pool.query(`${SELECT_REMESA} WHERE r.id = :id`, { id });
  return rows[0] || null;
}

/**
 * Guarda los datos corregidos de una carga. Con `todaLaLista`, proveedor,
 * factura, pedimento, contenedor y fecha van también a las demás cargas del
 * mismo archivo (el costo NO: es de cada hilo). Si cambió el costo, se rehace
 * el costo promedio del hilo.
 */
async function editarDatos(id, cambios, { todaLaLista = false } = {}) {
  return withTransaction(async (conn) => {
    const [[r]] = await conn.query('SELECT id, variante_id, lista, costo_kg FROM remesas WHERE id = :id FOR UPDATE', { id });
    if (!r) throw new AppError(404, 'NO_ENCONTRADO', 'Esa carga no existe');

    const compartidos = ['proveedor_id', 'factura', 'pedimento', 'contenedor', 'fecha_ingreso']
      .filter((k) => cambios[k] !== undefined);
    if (compartidos.length) {
      const set = compartidos.map((k) => `${k} = :${k}`).join(', ');
      const donde = todaLaLista && r.lista ? 'lista = :lista' : 'id = :id';
      // Una fecha borrada vuelve al día de la captura: la carga siempre tiene una.
      const valores = { ...cambios, id, lista: r.lista };
      await conn.query(
        `UPDATE remesas SET ${set.replace('fecha_ingreso = :fecha_ingreso', 'fecha_ingreso = COALESCE(:fecha_ingreso, DATE(creado_en))')}
          WHERE ${donde}`,
        valores
      );
    }
    if (cambios.costo_kg !== undefined) {
      const antes = r.costo_kg != null ? Number(r.costo_kg) : null;
      const despues = cambios.costo_kg != null ? Number(cambios.costo_kg) : null;
      if (antes !== despues) {
        await conn.query('UPDATE remesas SET costo_kg = :c WHERE id = :id', { c: despues, id });
        await recalcularCosto(conn, r.variante_id);
      }
    }
  });
}

/**
 * Rehace el COSTO del hilo como si cada costo se hubiera capturado a tiempo:
 * recorre sus cargas en orden y aplica el promedio ponderado móvil con los
 * kilos que había JUSTO ANTES de cada una (la suma de su kardex hasta ese
 * movimiento, en todos los almacenes). Hace falta porque el costo se puede
 * poner o corregir después de cargar (contabilidad lo pone cuando llega la
 * factura) y el promedio depende del orden. Una carga sin costo no lo mueve.
 */
async function recalcularCosto(conn, varianteId) {
  const [cargas] = await conn.query(
    `SELECT r.id, r.kg_total, r.costo_kg,
            (SELECT MIN(m.id) FROM movimientos_inventario m
              WHERE m.referencia_tipo = 'remesa' AND m.referencia_id = r.id) AS mov_id
       FROM remesas r WHERE r.variante_id = :v ORDER BY r.id`,
    { v: varianteId }
  );
  let costo = null;
  for (const c of cargas) {
    if (c.costo_kg == null || c.mov_id == null) continue;
    const [[{ previos }]] = await conn.query(
      `SELECT COALESCE(SUM(cantidad), 0) AS previos FROM movimientos_inventario
        WHERE variante_id = :v AND id < :mov`,
      { v: varianteId, mov: c.mov_id }
    );
    const kgPrevios = Math.max(0, round3(previos));
    const kg = Number(c.kg_total);
    const nuevo = Number(c.costo_kg);
    costo = costo == null || kgPrevios <= 0
      ? nuevo
      : Math.round(((kgPrevios * costo + kg * nuevo) / (kgPrevios + kg)) * 100) / 100;
  }
  await conn.query(
    `UPDATE producto_variantes SET costo = :costo, costo_actualizado_en = NOW() WHERE id = :v`,
    { costo, v: varianteId }
  );
  return costo;
}

module.exports = { codigosExistentes, crearRemesa, crearLista, listar, obtener, editarDatos, recalcularCosto };
