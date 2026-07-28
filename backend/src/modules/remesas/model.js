'use strict';

const crypto = require('crypto');
const { pool, withTransaction } = require('../../config/db');

// Remesas: la lista de empaque del proveedor convertida en bultos + entrada de
// inventario. Los bultos viven en `variante_codigos` (cada uno con su peso real
// y su lote); el inventario sigue siendo un saldo en kilos por almacén.

const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

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
  const { variante_id, almacen_id, bultos } = datos;
  const kgTotal = round3(bultos.reduce((s, b) => s + Number(b.peso_kg), 0));
  const lotes = [...new Set(bultos.map((b) => b.lote).filter(Boolean))];

  return withTransaction(async (conn) => {
    const folio = `REM-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const [r] = await conn.query(
      `INSERT INTO remesas
         (folio, variante_id, almacen_id, usuario_id, num_bultos, kg_total, lotes, archivo, notas)
       VALUES (:folio, :variante_id, :almacen_id, :usuario_id, :num_bultos, :kg_total,
               :lotes, :archivo, :notas)`,
      {
        folio,
        variante_id,
        almacen_id,
        usuario_id: usuarioId ?? null,
        num_bultos: bultos.length,
        kg_total: kgTotal,
        lotes: lotes.join(', ') || null,
        archivo: datos.archivo ?? null,
        notas: datos.notas ?? null,
      }
    );
    const remesaId = r.insertId;

    // Los bultos, uno por uno: el código es único en toda la base. Quedan
    // ubicados en el almacén que recibe la remesa; de ahí saldrán al traspasar.
    for (const b of bultos) {
      await conn.query(
        `INSERT INTO variante_codigos
           (variante_id, codigo, peso_kg, lote, conos, almacen_id, remesa_id)
         VALUES (:variante_id, :codigo, :peso_kg, :lote, :conos, :almacen_id, :remesa_id)`,
        { variante_id, ...b, almacen_id, remesa_id: remesaId }
      );
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

    return {
      id: remesaId,
      folio,
      num_bultos: bultos.length,
      kg_total: kgTotal,
      lotes,
      saldo_anterior: saldoAnterior,
      saldo_nuevo: saldoNuevo,
    };
  });
}

const SELECT_REMESA = `
  SELECT r.id, r.folio, r.num_bultos, r.kg_total, r.lotes, r.archivo, r.notas, r.creado_en,
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
`;

async function listar({ variante_id, limit, offset }) {
  const where = variante_id ? 'WHERE r.variante_id = :variante_id' : '';
  const params = { variante_id, limit, offset };
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

/** La remesa con sus bultos, para poder revisar qué entró. */
async function obtener(id) {
  const [rows] = await pool.query(`${SELECT_REMESA} WHERE r.id = :id LIMIT 1`, { id });
  const remesa = rows[0];
  if (!remesa) return null;
  const [bultos] = await pool.query(
    `SELECT codigo, peso_kg, lote, conos FROM variante_codigos
      WHERE remesa_id = :id ORDER BY id`,
    { id }
  );
  remesa.bultos = bultos;
  return remesa;
}

module.exports = { codigosExistentes, crearRemesa, listar, obtener };
