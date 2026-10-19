'use strict';

/**
 * DEVOLUCIONES con SALDO A FAVOR (2026-10-13, parte 2). "Un cliente te compra
 * hilo y regresa una parte o todo: no le quiero regresar dinero, lo que se le
 * tiene que agregar es como un saldo a favor de lo que regresó" (usuario).
 *
 * Se hace desde la NOTA del cliente (la venta), línea por línea:
 *   · los PAQUETES cerrados que regresan se escanean: vuelven como paquetes,
 *     con su código y su peso, al almacén de donde salieron (vuelven a estar
 *     disponibles para venderse);
 *   · lo SUELTO se pesa ("lo que marque la báscula", SIN restar tubos): de un
 *     paquete abierto regresan CONOS y entran a la presentación de cono de ese
 *     hilo (se crea si no la tiene, como al bajar conos); de una línea de conos o
 *     de un hilo por kilo, vuelve a la misma presentación.
 * Lo que regresa queda A FAVOR del cliente al precio con que se vendió (con su
 * IVA y su descuento, en proporción). No se devuelve dinero. Al registrarla se
 * elige si ese saldo se DESCUENTA de lo que debe o se queda a favor para sus
 * compras (`clientes/saldo-favor.js`).
 *
 * La venta sigue como estaba (pagada, a crédito o pendiente): la devolución es
 * otro documento (DEV-…) que dice qué regresó de ella.
 */

const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const saldoFavor = require('../clientes/saldo-favor');
const variantesService = require('../variantes/service');
const { anotarAlmacen } = require('../tiempo-real/contexto');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const INACTIVOS = ['cancelado', 'devuelto'];

/** El cono que sale de un paquete (o null si todavía no existe). */
async function _conoDe(ejecutor, paqueteId) {
  const [[c]] = await ejecutor.query(
    `SELECT id FROM producto_variantes
      WHERE origen_variante_id = :id AND tipo_presentacion = 'cono' AND activo = 1
      ORDER BY id LIMIT 1`,
    { id: paqueteId }
  );
  return c ? Number(c.id) : null;
}

/**
 * Lo que se puede devolver de una nota: cada línea con lo que se llevó, lo que
 * ya regresó, lo que todavía puede regresar, a cómo queda el kilo a favor y sus
 * paquetes (los que todavía puede regresar cerrados). Más el cliente, lo que
 * debe y su saldo a favor. Solo lee. `clienteId`: el que se elige cuando la
 * venta no tenía cliente (para decir cuánto debe ese).
 */
async function previa(pedidoId, clienteId = null) {
  const [[p]] = await pool.query(
    `SELECT p.id, p.numero_pedido, p.estado, p.canal, p.inventario_descontado, p.almacen_id,
            a.nombre AS almacen, p.cliente_id, c.nombre AS cliente, c.nombre_comercial
       FROM pedidos p
       LEFT JOIN almacenes a ON a.id = p.almacen_id
       LEFT JOIN clientes c  ON c.id = p.cliente_id
      WHERE p.id = :id`,
    { id: pedidoId }
  );
  if (!p) throw new AppError(404, 'NO_ENCONTRADO', 'Venta no encontrada');
  const [lineas] = await pool.query(
    `SELECT d.id AS detalle_id, d.variante_id, d.descripcion, d.cantidad, d.piezas, d.subtotal, d.impuesto,
            pv.tipo_presentacion, pr.nombre AS producto, pr.grosor_calibre AS calibre,
            COALESCE((SELECT SUM(dd.cantidad) FROM devolucion_detalle dd WHERE dd.detalle_id = d.id), 0) AS devuelto
       FROM pedido_detalle d
       JOIN producto_variantes pv ON pv.id = d.variante_id
       JOIN productos pr          ON pr.id = pv.producto_id
      WHERE d.pedido_id = :id
      ORDER BY d.id`,
    { id: pedidoId }
  );
  const [bultos] = lineas.length
    ? await pool.query(
        `SELECT b.detalle_id, b.codigo, b.peso_kg, b.lote, vc.estado,
                EXISTS (SELECT 1 FROM devolucion_bultos db WHERE db.variante_codigo_id = b.variante_codigo_id
                         AND b.variante_codigo_id IS NOT NULL) AS devuelto
           FROM pedido_detalle_bultos b
           LEFT JOIN variante_codigos vc ON vc.id = b.variante_codigo_id
          WHERE b.detalle_id IN (:ids)
          ORDER BY b.id`,
        { ids: lineas.map((l) => l.detalle_id) }
      )
    : [[]];
  const out = lineas.map((l) => {
    const cantidad = round3(l.cantidad);
    const devuelto = round3(l.devuelto);
    return {
      detalle_id: Number(l.detalle_id),
      hilo: `${l.producto}${l.calibre ? ' ' + l.calibre : ''}`,
      descripcion: l.descripcion,
      tipo_presentacion: l.tipo_presentacion,
      cantidad,
      piezas: l.piezas != null ? Number(l.piezas) : null,
      devuelto,
      disponible: round3(Math.max(0, cantidad - devuelto)),
      // A cómo queda el kilo a favor: lo que de verdad se cobró por kilo (con su
      // descuento y su IVA).
      precio_kg: cantidad > 0 ? round2((Number(l.subtotal) + Number(l.impuesto)) / cantidad) : 0,
      // Lo suelto que regresa de un paquete entra como CONOS.
      sueltos_como: l.tipo_presentacion === 'paquete' ? 'conos' : l.tipo_presentacion === 'cono' ? 'conos' : 'kilos',
      bultos: bultos
        .filter((b) => Number(b.detalle_id) === Number(l.detalle_id))
        .map((b) => ({
          codigo: b.codigo,
          peso_kg: round3(b.peso_kg),
          lote: b.lote,
          // Se puede regresar cerrado si sigue vendido y no se ha devuelto ya.
          devolvible: b.estado === 'vendido' && !Number(b.devuelto),
          devuelto: !!Number(b.devuelto),
          abierto: b.estado === 'desarmado',
        })),
    };
  });
  const quien = p.cliente_id ?? clienteId;
  const deuda = quien ? await saldoFavor.deudaTotal(quien) : { credito: 0, notas: 0, total: 0 };
  // Lo que todavía debe ESTA venta: ahí se descuenta primero lo que regrese.
  const esta = await saldoFavor.debeDeVenta(pool, pedidoId);
  return {
    pedido_id: Number(p.id),
    numero_pedido: p.numero_pedido,
    estado: p.estado,
    almacen_id: p.almacen_id,
    almacen: p.almacen,
    cliente_id: p.cliente_id,
    cliente: p.nombre_comercial || p.cliente || null,
    se_puede: !INACTIVOS.includes(p.estado) && !!Number(p.inventario_descontado),
    lineas: out,
    saldo_favor: quien ? await saldoFavor.saldoFavor(quien) : 0,
    deuda,
    debe_esta: esta.debe,
    debe_esta_tipo: esta.tipo,
  };
}

/**
 * Registra la devolución. `datos`:
 *   · lineas: [{ detalle_id, codigos?: [paquetes cerrados], kg_sueltos?: kilos
 *     pesados, conos?: cuántos conos eran }]
 *   · cliente_id: solo si la venta no tenía cliente (el saldo a favor es de alguien);
 *   · destino: 'favor' (se queda a favor) o 'deuda' (se descuenta de lo demás que
 *     debe). Si ESTA venta todavía se debe, primero se descuenta de ella, sin
 *     preguntar; el destino es para lo que sobre;
 *   · notas.
 */
async function registrar(pedidoId, datos, usuarioId) {
  const lineasIn = (datos.lineas ?? []).filter(
    (l) => (l.codigos?.length ?? 0) > 0 || Number(l.kg_sueltos ?? 0) > 0
  );
  if (!lineasIn.length) {
    throw new AppError(422, 'DEVOLUCION_VACIA', 'Di qué regresa: escanea los paquetes o pesa lo suelto.');
  }

  // Lo suelto de un paquete entra como CONO: si el hilo todavía no tiene la
  // presentación, se crea ANTES (como al bajar conos a mostrador).
  for (const l of lineasIn) {
    if (!(Number(l.kg_sueltos ?? 0) > 0)) continue;
    const [[d]] = await pool.query(
      `SELECT d.variante_id, pv.tipo_presentacion, pv.producto_id, pv.sku
         FROM pedido_detalle d JOIN producto_variantes pv ON pv.id = d.variante_id
        WHERE d.id = :d AND d.pedido_id = :p`,
      { d: l.detalle_id, p: pedidoId }
    );
    if (!d || d.tipo_presentacion !== 'paquete') continue;
    if (await _conoDe(pool, d.variante_id)) continue;
    const [[c]] = await pool.query(
      `SELECT vc.conos FROM pedido_detalle_bultos b JOIN variante_codigos vc ON vc.id = b.variante_codigo_id
        WHERE b.detalle_id = :d AND vc.conos > 0 LIMIT 1`,
      { d: l.detalle_id }
    );
    await variantesService.crear({
      producto_id: d.producto_id,
      sku: `${d.sku}-CONO`,
      presentacion: 'Cono',
      tipo_presentacion: 'cono',
      origen_variante_id: d.variante_id,
      piezas_por_origen: Number(c?.conos) || 12,
      modo_precio: 'calculado',
    });
  }

  return withTransaction(async (conn) => {
    const [[p]] = await conn.query(
      `SELECT id, numero_pedido, estado, inventario_descontado, almacen_id, cliente_id
         FROM pedidos WHERE id = :id FOR UPDATE`,
      { id: pedidoId }
    );
    if (!p) throw new AppError(404, 'NO_ENCONTRADO', 'Venta no encontrada');
    if (INACTIVOS.includes(p.estado)) {
      throw new AppError(409, 'VENTA_INACTIVA', `${p.numero_pedido} está ${p.estado}: no hay nada que devolver.`);
    }
    if (!Number(p.inventario_descontado)) {
      throw new AppError(409, 'NO_SE_HA_ENTREGADO',
        `${p.numero_pedido} todavía no se entrega: la mercancía sigue en la tienda. Se modifica o se cancela.`);
    }

    // El saldo a favor es de ALGUIEN: la venta sin cliente lo pide ahora.
    let clienteId = p.cliente_id ? Number(p.cliente_id) : null;
    if (!clienteId) {
      if (!datos.cliente_id) {
        throw new AppError(422, 'DEVOLUCION_SIN_CLIENTE',
          'La venta no tenía cliente: elige a quién se le pone el saldo a favor.');
      }
      clienteId = Number(datos.cliente_id);
    }
    const [[cli]] = await conn.query('SELECT id, nombre, activo FROM clientes WHERE id = :id', { id: clienteId });
    if (!cli) throw new AppError(422, 'CLIENTE_INVALIDO', 'Ese cliente no existe.');

    const almacenId = p.almacen_id;
    const filas = []; // { detalle_id, variante_id, cantidad, piezas, importe, bultos: [] }
    for (const l of lineasIn) {
      const [[d]] = await conn.query(
        `SELECT d.id, d.variante_id, d.descripcion, d.cantidad, d.subtotal, d.impuesto, pv.tipo_presentacion,
                COALESCE((SELECT SUM(dd.cantidad) FROM devolucion_detalle dd WHERE dd.detalle_id = d.id), 0) AS devuelto
           FROM pedido_detalle d JOIN producto_variantes pv ON pv.id = d.variante_id
          WHERE d.id = :d AND d.pedido_id = :p FOR UPDATE`,
        { d: l.detalle_id, p: pedidoId }
      );
      if (!d) throw new AppError(422, 'LINEA_INVALIDA', 'Esa línea no es de esta nota.');
      const porKg = Number(d.cantidad) > 0 ? (Number(d.subtotal) + Number(d.impuesto)) / Number(d.cantidad) : 0;

      // Los paquetes cerrados que regresan: los de ESTA línea, todavía vendidos.
      const bultos = [];
      const vistos = new Set();
      for (const codigo of l.codigos ?? []) {
        const c = String(codigo).trim();
        if (!c) continue;
        if (vistos.has(c)) throw new AppError(422, 'BULTO_REPETIDO', `El paquete ${c} se escaneó dos veces.`);
        vistos.add(c);
        const [[b]] = await conn.query(
          `SELECT b.codigo, b.peso_kg, b.variante_codigo_id, vc.estado
             FROM pedido_detalle_bultos b
             LEFT JOIN variante_codigos vc ON vc.id = b.variante_codigo_id
            WHERE b.detalle_id = :d AND b.codigo = :c
            LIMIT 1`,
          { d: d.id, c }
        );
        if (!b) {
          throw new AppError(422, 'BULTO_NO_ES_DE_LA_NOTA',
            `El paquete ${c} no salió en «${d.descripcion}» de ${p.numero_pedido}.`);
        }
        if (b.variante_codigo_id) {
          const [[ya]] = await conn.query(
            'SELECT 1 AS si FROM devolucion_bultos WHERE variante_codigo_id = :id LIMIT 1',
            { id: b.variante_codigo_id }
          );
          if (ya) throw new AppError(409, 'BULTO_YA_DEVUELTO', `El paquete ${c} ya se había devuelto.`);
          const [[vc]] = await conn.query(
            'SELECT estado FROM variante_codigos WHERE id = :id FOR UPDATE',
            { id: b.variante_codigo_id }
          );
          if (vc?.estado !== 'vendido') {
            throw new AppError(409, 'BULTO_NO_DEVOLVIBLE',
              `El paquete ${c} está ${vc?.estado ?? 'borrado'}: no regresa cerrado. Si lo abrieron, pesa los conos que regresan.`);
          }
        }
        bultos.push({ codigo: b.codigo, peso_kg: round3(b.peso_kg), variante_codigo_id: b.variante_codigo_id });
      }
      const kgBultos = round3(bultos.reduce((s, b) => s + b.peso_kg, 0));
      const kgSueltos = round3(l.kg_sueltos ?? 0);
      const total = round3(kgBultos + kgSueltos);
      const disponible = round3(Number(d.cantidad) - Number(d.devuelto));
      if (total > disponible + 0.0005) {
        throw new AppError(422, 'DEVOLUCION_EXCEDE',
          `De «${d.descripcion}» se llevó ${round3(d.cantidad)} kg` +
          (Number(d.devuelto) > 0 ? ` y ya regresó ${round3(d.devuelto)} kg` : '') +
          `: no pueden regresar ${total} kg (a lo más ${disponible}).`);
      }
      if (kgBultos > 0) {
        filas.push({
          detalle_id: d.id, variante_id: d.variante_id, cantidad: kgBultos, piezas: null,
          importe: round2(kgBultos * porKg), bultos,
        });
      }
      if (kgSueltos > 0) {
        let variante = Number(d.variante_id);
        if (d.tipo_presentacion === 'paquete') {
          variante = await _conoDe(conn, d.variante_id);
          if (!variante) throw new AppError(500, 'SIN_CONO', 'No se pudo dar de alta el cono de ese hilo.');
        }
        filas.push({
          detalle_id: d.id, variante_id: variante, cantidad: kgSueltos,
          piezas: Number(l.conos) > 0 ? Math.round(Number(l.conos)) : null,
          importe: round2(kgSueltos * porKg), bultos: [],
        });
      }
    }

    const total = round2(filas.reduce((s, f) => s + f.importe, 0));
    if (total <= 0) throw new AppError(422, 'DEVOLUCION_SIN_IMPORTE', 'Lo que regresa no tiene importe.');
    const folio = `DEV-${Date.now()}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
    const [dr] = await conn.query(
      `INSERT INTO devoluciones (folio, pedido_id, cliente_id, almacen_id, usuario_id, total, notas)
       VALUES (:folio, :pedido, :cliente, :almacen, :usuario, :total, :notas)`,
      {
        folio, pedido: pedidoId, cliente: clienteId, almacen: almacenId, usuario: usuarioId ?? null, total,
        notas: datos.notas ? String(datos.notas).trim().slice(0, 255) || null : null,
      }
    );
    const devolucionId = dr.insertId;

    for (const f of filas) {
      const [fr] = await conn.query(
        `INSERT INTO devolucion_detalle (devolucion_id, detalle_id, variante_id, cantidad, piezas, importe)
         VALUES (:dev, :det, :v, :cant, :piezas, :importe)`,
        { dev: devolucionId, det: f.detalle_id, v: f.variante_id, cant: f.cantidad, piezas: f.piezas, importe: f.importe }
      );
      for (const b of f.bultos) {
        await conn.query(
          `INSERT INTO devolucion_bultos (devolucion_detalle_id, variante_codigo_id, codigo, peso_kg)
           VALUES (:f, :vc, :c, :peso)`,
          { f: fr.insertId, vc: b.variante_codigo_id, c: b.codigo, peso: b.peso_kg }
        );
        // Vuelve a estar en la tienda, cerrado y libre para venderse.
        if (b.variante_codigo_id) {
          await conn.query(
            `UPDATE variante_codigos
                SET estado = 'disponible', consumido_en = NULL, consumido_tipo = NULL, consumido_id = NULL,
                    almacen_id = :almacen
              WHERE id = :id`,
            { id: b.variante_codigo_id, almacen: almacenId }
          );
        }
      }
      // La mercancía regresa al almacén de donde salió, con su movimiento.
      await conn.query(
        `INSERT INTO inventario (variante_id, almacen_id, cantidad)
           VALUES (:v, :a, :cant)
         ON DUPLICATE KEY UPDATE cantidad = cantidad + :cant`,
        { v: f.variante_id, a: almacenId, cant: f.cantidad }
      );
      anotarAlmacen(almacenId);
      await conn.query(
        `INSERT INTO movimientos_inventario
           (variante_id, almacen_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id, motivo)
         VALUES (:v, :a, 'devolucion', :cant, 'pedido', :pedido, :usuario, :motivo)`,
        {
          v: f.variante_id, a: almacenId, cant: f.cantidad, pedido: pedidoId, usuario: usuarioId ?? null,
          motivo: `Devolución ${folio} de ${p.numero_pedido}${f.bultos.length ? ' (paquetes cerrados)' : f.piezas ? ` (${f.piezas} conos)` : ''}`,
        }
      );
    }

    // Lo que regresó queda A FAVOR; y si así lo eligió, se descuenta de lo que debe.
    await saldoFavor.agregar(conn, {
      clienteId, tipo: 'devolucion', monto: total, pedidoId, devolucionId, usuarioId,
      notas: `Regresó mercancía de ${p.numero_pedido} (${folio})`,
    });
    // 1. Si ESTA venta todavía se debe (fiada o nota pendiente de pago), lo que
    //    regresa se descuenta de ella, solo y primero (2026-10-14).
    const deEsta = await saldoFavor.descontarDeVenta(conn, {
      clienteId, pedidoId, monto: total, usuarioId, origen: folio,
    });
    // 2. Lo que sobre, como se eligió: a favor, o a lo demás que debe.
    const sobra = round2(total - deEsta.aplicado);
    const deOtras = datos.destino === 'deuda' && sobra > 0.004
      ? await saldoFavor.aplicarADeuda(conn, { clienteId, monto: sobra, usuarioId, origen: folio })
      : { aplicado: 0, detalle: [] };
    const aplicado = {
      aplicado: round2(deEsta.aplicado + deOtras.aplicado),
      detalle: [...deEsta.detalle, ...deOtras.detalle],
    };
    if (aplicado.aplicado > 0) {
      await conn.query('UPDATE devoluciones SET aplicado_a_deuda = :a WHERE id = :id', { a: aplicado.aplicado, id: devolucionId });
    }

    return {
      devolucion_id: devolucionId,
      folio,
      pedido_id: Number(pedidoId),
      numero_pedido: p.numero_pedido,
      cliente_id: clienteId,
      cliente: cli.nombre,
      total,
      kg: round3(filas.reduce((s, f) => s + f.cantidad, 0)),
      aplicado_a_deuda: aplicado.aplicado,
      // De eso, lo que se descontó de ESTA venta (la fiada o la nota que se debía).
      descontado_de_esta: deEsta.aplicado,
      aplicaciones: aplicado.detalle,
      saldo_favor: await saldoFavor.saldoFavor(clienteId, conn),
    };
  });
}

/** Las devoluciones de una venta, con lo que regresó en cada una (para su detalle). */
async function deVenta(ejecutor, pedidoId) {
  const [devs] = await ejecutor.query(
    `SELECT d.id, d.folio, d.total, d.aplicado_a_deuda, d.notas, d.creado_en, d.cliente_id,
            c.nombre AS cliente, c.nombre_comercial, u.nombre AS usuario
       FROM devoluciones d
       LEFT JOIN clientes c ON c.id = d.cliente_id
       LEFT JOIN usuarios u ON u.id = d.usuario_id
      WHERE d.pedido_id = :id
      ORDER BY d.id`,
    { id: pedidoId }
  );
  if (!devs.length) return [];
  const [lineas] = await ejecutor.query(
    `SELECT dd.id, dd.devolucion_id, dd.detalle_id, dd.cantidad, dd.piezas, dd.importe,
            pv.tipo_presentacion, pr.nombre AS producto, pr.grosor_calibre AS calibre,
            (SELECT GROUP_CONCAT(db.codigo ORDER BY db.id SEPARATOR ', ') FROM devolucion_bultos db
              WHERE db.devolucion_detalle_id = dd.id) AS codigos
       FROM devolucion_detalle dd
       JOIN producto_variantes pv ON pv.id = dd.variante_id
       JOIN productos pr          ON pr.id = pv.producto_id
      WHERE dd.devolucion_id IN (:ids)
      ORDER BY dd.id`,
    { ids: devs.map((d) => d.id) }
  );
  // Lo que cada cliente tiene a favor HOY: lo dice el ticket de la devolución
  // (2026-10-15: "que salga como devolución y cuánto tiene a favor").
  const saldoHoy = new Map();
  for (const clienteId of new Set(devs.map((d) => Number(d.cliente_id)))) {
    saldoHoy.set(clienteId, await saldoFavor.saldoFavor(clienteId, ejecutor));
  }
  return devs.map((d) => ({
    ...d,
    total: round2(d.total),
    aplicado_a_deuda: round2(d.aplicado_a_deuda),
    saldo_favor_hoy: saldoHoy.get(Number(d.cliente_id)) ?? null,
    lineas: lineas
      .filter((l) => l.devolucion_id === d.id)
      .map((l) => ({
        detalle_id: Number(l.detalle_id),
        hilo: `${l.producto}${l.calibre ? ' ' + l.calibre : ''}`,
        como: l.tipo_presentacion,
        kg: round3(l.cantidad),
        piezas: l.piezas != null ? Number(l.piezas) : null,
        importe: round2(l.importe),
        codigos: l.codigos ? String(l.codigos).split(', ') : [],
      })),
  }));
}

module.exports = { previa, registrar, deVenta };
