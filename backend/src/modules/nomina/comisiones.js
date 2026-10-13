'use strict';

/**
 * COMISIONES AL LIQUIDAR (2026-10-07). "Si fue una venta a crédito no se pagan
 * comisiones hasta que se liquide… las comisiones se pagan por semana: esta
 * semana vendió a crédito, no se pagó y cerré mi nómina, entonces no se mete;
 * después de 2 semanas se paga, ahora sí se agrega la comisión porque ya fue
 * liquidado el crédito" (usuario). Al preguntarle: se paga COMPLETA al
 * liquidarse (no por abono), y los apartados y los pedidos igual.
 *
 * La regla: la comisión de una venta se paga, completa y UNA sola vez, en la
 * nómina de la semana en que la venta quedó PAGADA:
 *   · de contado, el día que se vende;
 *   · fiada, cuando los abonos de la cuenta la cubren (de lo más antiguo a lo
 *     más nuevo, el mismo reparto de `clientes/model.js → repartirAbonos`);
 *   · apartado o pedido, cuando lo que dejó (anticipo, abonos, lo cobrado al
 *     entregar) llega al total.
 * Cada venta pagada queda anotada en `nomina_comisiones` con el recibo que la
 * pagó. Una semana toma las ventas liquidadas hasta su sábado que NO estén ya en
 * otra nómina viva (no cancelada): lo que se liquidó en una semana que ya se
 * cerró entra en la siguiente que se calcule, y nada se paga dos veces.
 *
 * Solo para las ventas desde `DESDE`: las de antes ya se pagaron con la regla
 * anterior (la semana de la venta, liquidada o no) y no vuelven a entrar.
 */

const { pool } = require('../../config/db');
const { repartirAbonos } = require('../clientes/model');

/** Domingo desde el que rige la regla (la migración anotó lo que ya se había pagado). */
const DESDE = '2026-10-04';
const TOL = 0.005;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const NOMBRE_TIPO = { contado: 'Contado', credito: 'Fiada', apartado: 'Apartado', pedido: 'Pedido' };

function tipoDe(p, fiada) {
  if (fiada) return 'credito';
  if (Number(p.encargo)) return 'pedido';
  if (p.estado === 'apartado' || p.entregado_en) return 'apartado';
  return 'contado';
}

/**
 * Las ventas de esos vendedores desde `DESDE` que NO están en ninguna nómina
 * viva (salvo `periodoId`, que se está recalculando), con lo que llevan pagado
 * hasta `hasta` (exclusivo) y CUÁNDO quedaron liquidadas (`liquidada_en`, o null
 * si a esa fecha todavía deben).
 */
async function ventasSinPagarComision(conn, { usuarioIds, hasta, periodoId = 0 }) {
  if (!usuarioIds.length) return [];
  const [ventas] = await conn.query(
    `SELECT p.id, p.numero_pedido, p.usuario_id, p.cliente_id, p.estado, p.encargo, p.entregado_en,
            p.total, (p.subtotal - p.descuento) AS venta_neta,
            DATE_FORMAT(p.creado_en, '%Y-%m-%d %H:%i:%s') AS vendida_en,
            COALESCE(c.nombre_comercial, c.nombre) AS cliente
       FROM pedidos p
       LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.usuario_id IN (:ids) AND p.creado_en >= :desde AND p.creado_en < :hasta
        AND p.estado NOT IN ('cancelado', 'devuelto')
        AND NOT EXISTS (
              SELECT 1 FROM nomina_comisiones nc
                JOIN nomina_recibos r   ON r.id = nc.recibo_id
                JOIN nomina_periodos np ON np.id = r.periodo_id
               WHERE nc.pedido_id = p.id AND np.estado <> 'cancelado' AND np.id <> :periodo)
      ORDER BY p.creado_en, p.id`,
    { ids: usuarioIds, desde: `${DESDE} 00:00:00`, hasta, periodo: periodoId ?? 0 }
  );
  if (!ventas.length) return [];
  const ids = ventas.map((v) => v.id);

  // Lo cobrado de cada venta (contado, anticipos, abonos, lo cobrado al entregar).
  const [pagos] = await conn.query(
    `SELECT pedido_id, monto, DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS en
       FROM pagos
      WHERE pedido_id IN (:ids) AND estado = 'completado' AND creado_en < :hasta
      ORDER BY creado_en, id`,
    { ids, hasta }
  );
  const pagosDe = new Map();
  for (const p of pagos) {
    if (!pagosDe.has(Number(p.pedido_id))) pagosDe.set(Number(p.pedido_id), []);
    pagosDe.get(Number(p.pedido_id)).push({ en: p.en, monto: Number(p.monto) });
  }

  // Las fiadas: lo que se pagó de su cargo, abono por abono, en su cuenta.
  const [cargos] = await conn.query(
    `SELECT DISTINCT pedido_id FROM credito_movimientos WHERE pedido_id IN (:ids) AND tipo = 'cargo'`,
    { ids }
  );
  const fiadas = new Set(cargos.map((c) => Number(c.pedido_id)));
  const clientes = [...new Set(ventas.filter((v) => fiadas.has(Number(v.id))).map((v) => Number(v.cliente_id)))];
  /** cliente → [{ en, pagadoPor: Map(pedido → pagado) }] después de cada movimiento. */
  const cuentas = new Map();
  if (clientes.length) {
    const [movs] = await conn.query(
      `SELECT cliente_id, tipo, monto, pedido_id, DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS en
         FROM credito_movimientos
        WHERE cliente_id IN (:cl) AND creado_en < :hasta
        ORDER BY creado_en, id`,
      { cl: clientes, hasta }
    );
    for (const cl of clientes) {
      const suyos = movs.filter((m) => Number(m.cliente_id) === cl);
      const pasos = [];
      for (let i = 0; i < suyos.length; i++) {
        // Varios movimientos en el mismo segundo cuentan juntos.
        if (i + 1 < suyos.length && suyos[i + 1].en === suyos[i].en) continue;
        const reparto = repartirAbonos(suyos.slice(0, i + 1));
        pasos.push({
          en: suyos[i].en,
          pagadoPor: new Map(reparto.filter((d) => d.pedidoId != null).map((d) => [Number(d.pedidoId), d.pagado])),
        });
      }
      cuentas.set(cl, pasos);
    }
  }

  return ventas.map((v) => {
    const id = Number(v.id);
    const total = round2(v.total);
    const suyos = pagosDe.get(id) ?? [];
    const pasos = fiadas.has(id) ? cuentas.get(Number(v.cliente_id)) ?? [] : [];
    const pagadoEn = (t) => {
      let cobrado = 0;
      for (const p of suyos) if (p.en <= t) cobrado += p.monto;
      let delCredito = 0;
      for (const paso of pasos) if (paso.en <= t) delCredito = paso.pagadoPor.get(id) ?? 0;
      return round2(cobrado + delCredito);
    };
    // Se revisa en cada momento en que algo cambió; queda la última vez que
    // pasó a estar cubierta (si después volvió a deber, cuenta desde que la cubrieron otra vez).
    const momentos = [...new Set([v.vendida_en, ...suyos.map((p) => p.en), ...pasos.map((p) => p.en)])].sort();
    let liquidada = null;
    let pagado = 0;
    for (const t of momentos) {
      pagado = pagadoEn(t);
      const cubierta = total <= TOL || pagado + TOL >= total;
      if (cubierta && !liquidada) liquidada = t < v.vendida_en ? v.vendida_en : t;
      if (!cubierta) liquidada = null;
    }
    return {
      pedido_id: id,
      numero_pedido: v.numero_pedido,
      usuario_id: Number(v.usuario_id),
      cliente: v.cliente ?? null,
      tipo: tipoDe(v, fiadas.has(id)),
      vendida_en: v.vendida_en,
      liquidada_en: liquidada,
      total,
      venta_neta: round2(v.venta_neta),
      pagado: Math.min(pagado, total),
      falta: round2(Math.max(0, total - pagado)),
    };
  });
}

/**
 * Las ventas que se pagan en la nómina de la semana que acaba en `hastaExcl`:
 * las liquidadas hasta su sábado que no estén en otra nómina viva. Va dentro de
 * la transacción del cálculo. Devuelve usuario → ventas.
 */
async function liquidadasEnSemana(conn, { periodoId, hastaExcl, usuarioIds }) {
  const ventas = await ventasSinPagarComision(conn, { usuarioIds, hasta: hastaExcl, periodoId });
  const porUsuario = new Map();
  for (const v of ventas.filter((x) => x.liquidada_en)) {
    if (!porUsuario.has(v.usuario_id)) porUsuario.set(v.usuario_id, []);
    porUsuario.get(v.usuario_id).push(v);
  }
  return porUsuario;
}

/** Anota en el recibo las ventas cuya comisión paga (reemplaza las que tuviera). */
async function anotar(conn, reciboId, ventas, porcentaje) {
  await conn.query('DELETE FROM nomina_comisiones WHERE recibo_id = :id', { id: reciboId });
  for (const v of ventas) {
    await conn.query(
      `INSERT INTO nomina_comisiones
         (recibo_id, pedido_id, numero_pedido, cliente, tipo, vendida_en, liquidada_en,
          total, venta_neta, porcentaje, comision)
       VALUES (:recibo, :pedido, :numero, :cliente, :tipo, :vendida, :liquidada,
               :total, :neta, :pct, :comision)`,
      {
        recibo: reciboId, pedido: v.pedido_id, numero: v.numero_pedido, cliente: v.cliente,
        tipo: v.tipo, vendida: v.vendida_en, liquidada: v.liquidada_en,
        total: v.total, neta: v.venta_neta, pct: porcentaje,
        comision: comisionDe(v.venta_neta, porcentaje),
      }
    );
  }
}

function comisionDe(ventaNeta, porcentaje) {
  return round2((Number(ventaNeta) * Number(porcentaje)) / 100);
}

/**
 * El REPORTE de comisiones de una semana ("qué se está pagando de cada venta",
 * usuario 2026-10-07): por vendedor, las ventas cuya comisión paga esta nómina
 * —tal como quedaron anotadas, aunque la semana ya se haya pagado— y, al día de
 * hoy, lo que todavía no paga comisión: lo que se debe (fiado, apartado,
 * pedido) y lo ya liquidado que entra en la próxima nómina que se calcule.
 *
 * Una semana anterior a `DESDE` se pagó con la regla vieja: se listan sus
 * ventas por la fecha de venta y sin pendientes.
 */
async function reporte(periodo, { usuarioId = null } = {}) {
  const [recibos] = await pool.query(
    `SELECT r.id, r.usuario_id, u.nombre AS usuario, rol.nombre AS rol,
            r.porcentaje_comision, r.ventas_netas, r.comision, r.num_pedidos
       FROM nomina_recibos r
       JOIN usuarios u ON u.id = r.usuario_id
       JOIN roles rol  ON rol.id = u.rol_id
      WHERE r.periodo_id = :id ${usuarioId ? 'AND r.usuario_id = :u' : ''}
      ORDER BY u.nombre`,
    { id: periodo.id, u: usuarioId ?? 0 }
  );
  const reglaAnterior = periodo.fecha_inicio < DESDE;
  const ids = recibos.map((r) => Number(r.usuario_id));

  let anotadas = [];
  if (!recibos.length) {
    anotadas = [];
  } else if (reglaAnterior) {
    const [rows] = await pool.query(
      `SELECT p.id AS pedido_id, p.numero_pedido, p.usuario_id, COALESCE(c.nombre_comercial, c.nombre) AS cliente,
              p.estado, p.encargo, p.entregado_en,
              EXISTS (SELECT 1 FROM credito_movimientos cm WHERE cm.pedido_id = p.id AND cm.tipo = 'cargo') AS fiada,
              DATE_FORMAT(p.creado_en, '%Y-%m-%d %H:%i:%s') AS vendida_en, p.total, (p.subtotal - p.descuento) AS venta_neta
         FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
        WHERE p.usuario_id IN (:ids) AND p.creado_en >= :desde AND p.creado_en < :hasta
          AND p.estado NOT IN ('cancelado', 'devuelto')
        ORDER BY p.creado_en, p.id`,
      { ids, desde: `${periodo.fecha_inicio} 00:00:00`, hasta: `${siguienteDia(periodo.fecha_fin)} 00:00:00` }
    );
    anotadas = rows.map((v) => ({ ...v, tipo: tipoDe(v, Number(v.fiada)), liquidada_en: null }));
  } else {
    const [rows] = await pool.query(
      `SELECT nc.recibo_id, nc.pedido_id, nc.numero_pedido, nc.cliente, nc.tipo,
              DATE_FORMAT(nc.vendida_en, '%Y-%m-%d %H:%i:%s') AS vendida_en,
              DATE_FORMAT(nc.liquidada_en, '%Y-%m-%d %H:%i:%s') AS liquidada_en,
              nc.total, nc.venta_neta, nc.porcentaje, nc.comision, r.usuario_id
         FROM nomina_comisiones nc
         JOIN nomina_recibos r ON r.id = nc.recibo_id
        WHERE r.periodo_id = :id ${usuarioId ? 'AND r.usuario_id = :u' : ''}
        ORDER BY nc.liquidada_en IS NULL, nc.liquidada_en, nc.vendida_en, nc.id`,
      { id: periodo.id, u: usuarioId ?? 0 }
    );
    anotadas = rows;
  }

  const pendientes = reglaAnterior || !ids.length
    ? []
    : await ventasSinPagarComision(pool, { usuarioIds: ids, hasta: '9999-12-31 00:00:00' });

  return {
    regla: reglaAnterior ? 'anterior' : 'al_liquidar',
    desde: DESDE,
    vendedores: recibos.map((r) => {
      const uid = Number(r.usuario_id);
      const pct = Number(r.porcentaje_comision);
      const ventas = anotadas
        .filter((v) => Number(v.usuario_id) === uid)
        .map((v) => ({
          pedido_id: v.pedido_id != null ? Number(v.pedido_id) : null,
          numero_pedido: v.numero_pedido,
          cliente: v.cliente ?? null,
          tipo: v.tipo,
          vendida_en: v.vendida_en,
          liquidada_en: v.liquidada_en ?? null,
          total: round2(v.total),
          venta_neta: round2(v.venta_neta),
          comision: v.comision != null ? round2(v.comision) : comisionDe(v.venta_neta, pct),
        }));
      const suyas = pendientes.filter((v) => v.usuario_id === uid);
      const conComision = (v) => ({ ...v, comision: comisionDe(v.venta_neta, pct) });
      const porLiquidar = suyas.filter((v) => !v.liquidada_en).map(conComision);
      const proxima = suyas.filter((v) => v.liquidada_en).map(conComision);
      const suma = (lista, k) => round2(lista.reduce((s, x) => s + Number(x[k]), 0));
      return {
        recibo_id: Number(r.id),
        usuario_id: uid,
        usuario: r.usuario,
        rol: r.rol,
        porcentaje: pct,
        ventas_netas: round2(r.ventas_netas),
        comision: round2(r.comision),
        ventas,
        por_liquidar: porLiquidar,
        por_liquidar_comision: suma(porLiquidar, 'comision'),
        por_liquidar_debe: suma(porLiquidar, 'falta'),
        proxima_nomina: { ventas: proxima.length, venta_neta: suma(proxima, 'venta_neta'), comision: suma(proxima, 'comision') },
      };
    }),
  };
}

function siguienteDia(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

module.exports = { DESDE, NOMBRE_TIPO, ventasSinPagarComision, liquidadasEnSemana, anotar, comisionDe, reporte };
