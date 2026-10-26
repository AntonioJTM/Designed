'use strict';

const { pool } = require('../../config/db');
const devoluciones = require('./devoluciones');

// QUÉ REGRESA, para quien autoriza una devolución (2026-10-22, usuario: "que
// muestre más detalle: qué cliente es, cuántos paquetes regresa, color y lote,
// pesos e importe").
//
// Sale de lo que se guardó al pedirla (las líneas con sus paquetes escaneados y
// lo suelto que se pesó) y de la vista previa de la devolución
// (`devoluciones.previa`), la misma que usa la ventana de Devolución. El importe
// se calcula IGUAL que al registrarla (`devoluciones.registrar`): por línea, los
// kilos de sus paquetes y los sueltos, cada uno redondeado, al precio con que se
// vendió (`(subtotal + impuesto) ÷ cantidad`). Solo mira: no aparta nada.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

/** El id de la venta de la ruta guardada ("/pedidos/123/devoluciones"). */
function ventaDeRuta(ruta) {
  return Number(String(ruta ?? '').match(/\/pedidos\/(\d+)\/devoluciones/)?.[1] ?? 0);
}

/** Los paquetes de una línea, por lote, en el orden en que se escaneó el primero de cada uno. */
function _porLote(bultos) {
  const lotes = new Map();
  for (const b of bultos) {
    const k = b.lote ?? '';
    if (!lotes.has(k)) lotes.set(k, { lote: b.lote ?? null, paquetes: 0, kg: 0, bultos: [] });
    const l = lotes.get(k);
    l.paquetes++;
    l.kg = round3(l.kg + b.peso_kg);
    l.bultos.push(b);
  }
  return [...lotes.values()];
}

/**
 * El detalle de una solicitud de devolución (`autorizaciones/operaciones.js →
 * devolucion.detalle`): el cliente, la venta, cada hilo con sus paquetes por
 * lote (código y peso) y lo suelto, el importe de cada uno y en total, y cómo se
 * reparte (lo que se descuenta de esta nota, de lo demás que debe y lo que le
 * queda a favor) con lo que debe y tiene hoy.
 */
async function detalleDeDevolucion(pedidoId, cuerpo) {
  if (!pedidoId) return null;
  const elegido = cuerpo.cliente_id ? Number(cuerpo.cliente_id) : null;
  const previa = await devoluciones.previa(pedidoId, elegido);

  const [[venta]] = await pool.query(
    `SELECT p.total, DATE_FORMAT(p.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en
       FROM pedidos p WHERE p.id = :id`,
    { id: pedidoId }
  );
  // El cliente: el de la venta, o el que eligió quien la pide (venta de mostrador).
  const clienteId = previa.cliente_id ?? elegido;
  const [[cli]] = clienteId
    ? await pool.query(
        'SELECT id, nombre, nombre_comercial, codigo, telefono FROM clientes WHERE id = :id',
        { id: clienteId }
      )
    : [[null]];

  const [detalles] = await pool.query(
    'SELECT id, cantidad, subtotal, impuesto FROM pedido_detalle WHERE pedido_id = :id',
    { id: pedidoId }
  );
  const porKgDe = new Map(detalles.map((d) => [
    Number(d.id),
    Number(d.cantidad) > 0 ? (Number(d.subtotal) + Number(d.impuesto)) / Number(d.cantidad) : 0,
  ]));

  const lineas = [];
  for (const l of cuerpo.lineas ?? []) {
    const p = previa.lineas.find((x) => x.detalle_id === Number(l.detalle_id));
    if (!p) continue;
    const porKg = porKgDe.get(p.detalle_id) ?? 0;
    // Cada paquete una vez: el mismo código dos veces no suma doble (al aceptarla sería BULTO_REPETIDO).
    const codigos = [...new Set((l.codigos ?? []).map((c) => String(c).trim()).filter(Boolean))];
    const bultos = codigos.map((codigo) => {
      const b = p.bultos.find((x) => x.codigo === codigo);
      return {
        codigo,
        peso_kg: b ? b.peso_kg : 0,
        lote: b?.lote ?? null,
        // Ya no se puede regresar cerrado (lo regresaron mientras, o lo abrieron): al aceptarla no pasaría.
        no_se_puede: !b || !b.devolvible,
      };
    });
    const kgPaquetes = round3(bultos.reduce((s, b) => s + b.peso_kg, 0));
    const kgSueltos = round3(l.kg_sueltos ?? 0);
    const importePaquetes = bultos.length ? round2(kgPaquetes * porKg) : 0;
    const importeSueltos = kgSueltos > 0 ? round2(kgSueltos * porKg) : 0;
    if (!bultos.length && !(kgSueltos > 0)) continue;
    lineas.push({
      detalle_id: p.detalle_id,
      hilo: p.hilo,
      tipo_presentacion: p.tipo_presentacion,
      // Lo que se llevó en la venta y lo que ya había regresado antes.
      vendido_kg: p.cantidad,
      ya_regreso_kg: p.devuelto,
      precio_kg: round2(porKg),
      paquetes: bultos.length,
      kg_paquetes: kgPaquetes,
      lotes: _porLote(bultos),
      kg_sueltos: kgSueltos,
      conos: Number(l.conos) > 0 ? Math.round(Number(l.conos)) : null,
      // Lo suelto de un paquete entra como conos; de unos conos o por kilo, igual.
      sueltos_como: p.sueltos_como,
      kg: round3(kgPaquetes + kgSueltos),
      importe: round2(importePaquetes + importeSueltos),
      no_se_puede: bultos.filter((b) => b.no_se_puede).length,
    });
  }

  const importe = round2(lineas.reduce((s, l) => s + l.importe, 0));
  // Cómo se reparte al aceptarla, con lo que debe hoy: primero lo que todavía se
  // debe de ESTA venta; lo que sobre, como se eligió.
  const debeEsta = round2(previa.debe_esta ?? 0);
  const deEsta = round2(Math.min(importe, debeEsta));
  const sobra = round2(importe - deEsta);
  const debeOtras = round2(Math.max(0, Number(previa.deuda?.total ?? 0) - debeEsta));
  const deOtras = cuerpo.destino === 'deuda' ? round2(Math.min(sobra, debeOtras)) : 0;
  const aFavor = round2(sobra - deOtras);
  const favorHoy = round2(previa.saldo_favor ?? 0);

  return {
    venta: {
      id: previa.pedido_id,
      folio: previa.numero_pedido,
      fecha: venta?.creado_en ?? null,
      total: round2(venta?.total ?? 0),
      almacen: previa.almacen,
    },
    cliente: cli
      ? {
          id: Number(cli.id),
          nombre: cli.nombre_comercial || cli.nombre,
          codigo: cli.codigo ?? null,
          telefono: cli.telefono ?? null,
          // La venta era de mostrador (sin cliente): lo eligió quien la pide.
          elegido: !previa.cliente_id,
        }
      : null,
    // Lo que haría que al aceptarla no pase: la venta se canceló o se devolvió
    // mientras esperaba, o no hay a quién ponerle el saldo a favor.
    venta_inactiva: !previa.se_puede,
    sin_cliente: !cli,
    destino: cuerpo.destino === 'deuda' ? 'deuda' : 'favor',
    notas: cuerpo.notas ? String(cuerpo.notas).trim() || null : null,
    lineas,
    paquetes: lineas.reduce((s, l) => s + l.paquetes, 0),
    lotes: new Set(lineas.flatMap((l) => l.lotes.map((x) => `${l.detalle_id}|${x.lote ?? ''}`))).size,
    kg: round3(lineas.reduce((s, l) => s + l.kg, 0)),
    importe,
    no_se_puede: lineas.reduce((s, l) => s + l.no_se_puede, 0),
    reparto: {
      debe_esta: debeEsta,
      debe_esta_tipo: previa.debe_esta_tipo ?? null,
      de_esta: deEsta,
      debe_otras: debeOtras,
      de_otras: deOtras,
      a_favor: aFavor,
      favor_hoy: favorHoy,
      favor_despues: round2(favorHoy + aFavor),
    },
  };
}

module.exports = { detalleDeDevolucion, ventaDeRuta };
