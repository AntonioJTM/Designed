'use strict';

const { pool } = require('../../config/db');
const analisisModel = require('../analisis/model');

/**
 * Las cinco pestañas de Clientes (rediseño 2026-10): frecuencia de compra,
 * cuánto debe, qué compra, cuándo compra y cuánto gasta.
 *
 * Todo sale de `pedidos`, `pedido_detalle`, `credito_movimientos` y
 * `clientes` al momento: no hay tablas de resumen. Lo cancelado y lo devuelto no
 * cuenta (preguntar "cuánto me compra" e incluir lo que devolvió sería mentir).
 * Los apartados SÍ cuentan: la venta se cuenta el día que se aparta.
 *
 * `dias` es el periodo de la pantalla (30, 90, 365 o "desde siempre").
 */

const MUERTOS = "('cancelado', 'devuelto')";
const r1 = (n) => Math.round(Number(n) * 10) / 10;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const r3 = (n) => Math.round(Number(n) * 1000) / 1000;

// --------------------------------------------------------------- frecuencia

/**
 * Cada quien contra SU PROPIO ritmo: 20 días sin venir es mucho para quien
 * viene cada semana y nada para quien viene cada mes. El ritmo se mide en DÍAS
 * con compra, no en pedidos: dos tickets el mismo día no son dos visitas.
 *
 * Además de CADA CUÁNTO viene, cuánto se LLEVA: kilos y dinero desde siempre
 * y por visita (lo pidió el usuario el 2026-10-03: la frecuencia "tiene que
 * ser igual por kg y por dinero"). El dinero es el total de sus ventas, como
 * en Cuánto gasta; los kilos, lo que se llevó de hilo.
 */
async function ritmos() {
  const [rows] = await pool.query(
    `SELECT c.id AS cliente_id, c.nombre, c.nombre_comercial, c.telefono,
            v.dias_con_compra, v.num_compras, v.dinero_total,
            COALESCE(k.kg_total, 0) AS kg_total,
            DATE_FORMAT(v.primera, '%Y-%m-%d') AS primera,
            DATE_FORMAT(v.ultima, '%Y-%m-%d') AS ultima,
            DATEDIFF(CURDATE(), DATE(v.ultima)) AS dias_sin_venir,
            CASE WHEN v.dias_con_compra > 1
                 THEN DATEDIFF(DATE(v.ultima), DATE(v.primera)) / (v.dias_con_compra - 1) END AS ritmo
       FROM clientes c
       JOIN (
         SELECT cliente_id, COUNT(*) AS num_compras,
                COUNT(DISTINCT DATE(creado_en)) AS dias_con_compra,
                MIN(creado_en) AS primera, MAX(creado_en) AS ultima,
                SUM(total) AS dinero_total
           FROM pedidos
          WHERE cliente_id IS NOT NULL AND estado NOT IN ${MUERTOS}
          GROUP BY cliente_id
       ) v ON v.cliente_id = c.id
       LEFT JOIN (
         SELECT p.cliente_id, SUM(d.cantidad) AS kg_total
           FROM pedido_detalle d
           JOIN pedidos p ON p.id = d.pedido_id
          WHERE p.cliente_id IS NOT NULL AND p.estado NOT IN ${MUERTOS}
          GROUP BY p.cliente_id
       ) k ON k.cliente_id = c.id
      WHERE c.activo = 1`
  );
  return rows.map((r) => {
    const ritmo = r.ritmo != null && Number(r.ritmo) > 0 ? Math.max(1, Math.round(Number(r.ritmo))) : null;
    const sin = Number(r.dias_sin_venir);
    const veces = ritmo ? r1(sin / ritmo) : null;
    let estado;
    if (sin >= 90) estado = 'perdido';
    else if (!ritmo) estado = 'una';
    else if (veces > 2) estado = 'frio';
    else if (veces >= 1) estado = 'toca';
    else estado = 'bien';
    const visitas = Number(r.dias_con_compra) || 1;
    return {
      ...r,
      num_compras: Number(r.num_compras),
      dias_con_compra: Number(r.dias_con_compra),
      kg_total: r3(r.kg_total),
      dinero_total: r2(r.dinero_total),
      // Lo que se lleva cada vez que viene (por DÍA con compra, como el ritmo).
      kg_por_visita: r3(Number(r.kg_total) / visitas),
      dinero_por_visita: r2(Number(r.dinero_total) / visitas),
      dias_sin_venir: sin,
      ritmo,
      veces,
      estado,
    };
  });
}

/** La mediana de una lista de números (la del centro); null si está vacía. */
function medianaDe(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

async function frecuencia({ dias }) {
  // Lo del periodo: cuántas compras, cuánto dinero y cuántos kilos.
  const [periodo] = await pool.query(
    `SELECT p.cliente_id, COUNT(*) AS n, SUM(p.total) AS dinero,
            COALESCE(SUM((SELECT SUM(d.cantidad) FROM pedido_detalle d WHERE d.pedido_id = p.id)), 0) AS kg
       FROM pedidos p
      WHERE p.cliente_id IS NOT NULL AND p.estado NOT IN ${MUERTOS}
        AND p.creado_en >= NOW() - INTERVAL :dias DAY
      GROUP BY p.cliente_id`,
    { dias }
  );
  const enPeriodo = new Map(periodo.map((p) => [p.cliente_id, p]));
  const todos = await ritmos();
  for (const c of todos) {
    const p = enPeriodo.get(c.cliente_id);
    c.compras_periodo = p ? Number(p.n) : 0;
    c.dinero_periodo = p ? r2(p.dinero) : 0;
    c.kg_periodo = p ? r3(p.kg) : 0;
  }

  // Cómo se reparten: los que siguen viniendo según su costumbre, y aparte los
  // que se están yendo. Cada cliente cae en UN tramo.
  const tramo = (c) => {
    if (c.estado === 'perdido') return 'perdido';
    if (c.estado === 'frio') return 'frio';
    if (c.estado === 'una') return 'una';
    if (c.ritmo <= 8) return 'semana';
    if (c.ritmo <= 31) return 'mes';
    return 'mas';
  };
  const cuenta = { semana: 0, mes: 0, mas: 0, una: 0, frio: 0, perdido: 0 };
  for (const c of todos) cuenta[tramo(c)] += 1;

  const conRitmo = todos.filter((c) => c.ritmo).map((c) => c.ritmo).sort((a, b) => a - b);
  const mediana = conRitmo.length ? conRitmo[Math.floor(conRitmo.length / 2)] : null;
  const orden = { frio: 0, toca: 1, perdido: 2, bien: 3, una: 4 };

  return {
    dias,
    total_clientes: todos.length,
    mediana_ritmo: mediana,
    // La visita típica: cuánto se lleva un cliente cada vez que viene.
    mediana_kg_visita: medianaDe(todos.map((c) => c.kg_por_visita)),
    mediana_dinero_visita: medianaDe(todos.map((c) => c.dinero_por_visita)),
    al_corriente: todos.filter((c) => c.estado === 'bien').length,
    les_toca: todos.filter((c) => c.estado === 'toca').length,
    enfriandose: todos.filter((c) => c.estado === 'frio').length,
    perdidos: cuenta.perdido,
    tramos: cuenta,
    // Primero a quien más se le pasó su costumbre: es a quien conviene llamar.
    clientes: todos.sort((a, b) =>
      (orden[a.estado] - orden[b.estado]) || ((b.veces ?? 0) - (a.veces ?? 0)) || (a.dias_sin_venir - b.dias_sin_venir)),
  };
}

// -------------------------------------------------------------------- deuda

async function deuda() {
  const cartera = await analisisModel.cartera({ diasAviso: 30 });
  const [[credito]] = await pool.query(
    `SELECT COALESCE(SUM(GREATEST(s.saldo, 0)), 0) AS usado, COALESCE(SUM(c.limite_credito), 0) AS autorizado
       FROM v_clientes_saldo s JOIN clientes c ON c.id = s.cliente_id
      WHERE c.limite_credito > 0 AND c.activo = 1`
  );
  const [[cobrado]] = await pool.query(
    `SELECT COUNT(*) AS abonos, COALESCE(SUM(monto), 0) AS monto
       FROM credito_movimientos
      WHERE tipo = 'abono' AND creado_en >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`
  );
  return {
    ...cartera,
    credito_usado: r2(credito.usado),
    credito_autorizado: r2(credito.autorizado),
    cobrado_mes: { monto: r2(cobrado.monto), abonos: Number(cobrado.abonos) },
  };
}

// --------------------------------------------------------------- qué compra

async function queCompra({ dias }) {
  const params = { dias };
  const filtro = `p.cliente_id IS NOT NULL AND p.estado NOT IN ${MUERTOS}
                  AND p.creado_en >= NOW() - INTERVAL :dias DAY`;

  // Por HILO, es decir por producto_id: el mismo color en dos calibres son dos
  // productos y agruparlos por nombre los sumaría en un renglón que no existe.
  const [hilos] = await pool.query(
    `SELECT pr.id AS producto_id, pr.nombre AS color, pr.grosor_calibre AS calibre,
            cat.nombre AS material, l.nombre AS linea,
            SUM(d.cantidad) AS kg, COUNT(DISTINCT p.cliente_id) AS clientes
       FROM pedido_detalle d
       JOIN pedidos p             ON p.id = d.pedido_id
       JOIN producto_variantes pv ON pv.id = d.variante_id
       JOIN productos pr          ON pr.id = pv.producto_id
       LEFT JOIN categorias cat   ON cat.id = pr.categoria_id
       LEFT JOIN lineas l         ON l.id = pr.linea_id
      WHERE ${filtro}
      GROUP BY pr.id, pr.nombre, pr.grosor_calibre, cat.nombre, l.nombre
      ORDER BY kg DESC`,
    params
  );
  const [presentaciones] = await pool.query(
    `SELECT pv.tipo_presentacion AS tipo, SUM(d.cantidad) AS kg
       FROM pedido_detalle d
       JOIN pedidos p ON p.id = d.pedido_id
       JOIN producto_variantes pv ON pv.id = d.variante_id
      WHERE ${filtro}
      GROUP BY pv.tipo_presentacion`,
    params
  );
  const [porCliente] = await pool.query(
    `SELECT p.cliente_id, c.nombre, c.nombre_comercial,
            pr.id AS producto_id, pr.nombre AS color, pr.grosor_calibre AS calibre,
            SUM(d.cantidad) AS kg,
            SUM(CASE WHEN pv.tipo_presentacion = 'cono' THEN d.cantidad ELSE 0 END) AS kg_cono
       FROM pedido_detalle d
       JOIN pedidos p             ON p.id = d.pedido_id
       JOIN clientes c            ON c.id = p.cliente_id
       JOIN producto_variantes pv ON pv.id = d.variante_id
       JOIN productos pr          ON pr.id = pv.producto_id
      WHERE ${filtro}
      GROUP BY p.cliente_id, c.nombre, c.nombre_comercial, pr.id, pr.nombre, pr.grosor_calibre`,
    params
  );

  const totalKg = hilos.reduce((s, h) => s + Number(h.kg), 0);
  const material = new Map();
  for (const h of hilos) {
    const k = `${h.material ?? 'Sin material'}|${h.calibre ?? ''}`;
    material.set(k, (material.get(k) ?? 0) + Number(h.kg));
  }
  const kgPres = Object.fromEntries(presentaciones.map((p) => [p.tipo, Number(p.kg)]));
  const kgCono = kgPres.cono ?? 0;

  const clientes = new Map();
  for (const r of porCliente) {
    if (!clientes.has(r.cliente_id)) {
      clientes.set(r.cliente_id, { cliente_id: r.cliente_id, nombre: r.nombre, nombre_comercial: r.nombre_comercial, kg: 0, kg_cono: 0, hilos: [] });
    }
    const c = clientes.get(r.cliente_id);
    c.kg += Number(r.kg);
    c.kg_cono += Number(r.kg_cono);
    c.hilos.push({ producto_id: r.producto_id, hilo: [r.color, r.calibre].filter(Boolean).join(' '), kg: r3(r.kg) });
  }
  const lista = [...clientes.values()].map((c) => {
    c.hilos.sort((a, b) => b.kg - a.kg);
    return {
      cliente_id: c.cliente_id, nombre: c.nombre, nombre_comercial: c.nombre_comercial,
      kg: r3(c.kg),
      pct_paquete: c.kg > 0 ? Math.round(100 * (1 - c.kg_cono / c.kg)) : 100,
      favorito: c.hilos[0] ?? null,
      otros: c.hilos.slice(1, 4).map((h) => h.hilo),
    };
  }).sort((a, b) => b.kg - a.kg);

  return {
    dias,
    total_kg: r3(totalKg),
    hilos_distintos: hilos.length,
    top: hilos.slice(0, 10).map((h) => ({ ...h, kg: r3(h.kg), clientes: Number(h.clientes) })),
    por_material: [...material.entries()]
      .map(([k, kg]) => {
        const [mat, cal] = k.split('|');
        return { material: mat, calibre: cal || null, kg: r3(kg), pct: totalKg > 0 ? Math.round((100 * kg) / totalKg) : 0 };
      })
      .sort((a, b) => b.kg - a.kg),
    pct_cono: totalKg > 0 ? Math.round((100 * kgCono) / totalKg) : 0,
    clientes: lista,
  };
}

// ------------------------------------------------------------ cuándo compra

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

async function cuando({ dias }) {
  const filtro = `p.cliente_id IS NOT NULL AND p.estado NOT IN ${MUERTOS}`;
  const [mapa] = await pool.query(
    `SELECT DAYOFWEEK(p.creado_en) AS dow, HOUR(p.creado_en) AS hora, COUNT(*) AS n
       FROM pedidos p WHERE ${filtro} AND p.creado_en >= NOW() - INTERVAL :dias DAY
      GROUP BY dow, hora`,
    { dias }
  );
  // Las últimas 12 semanas, de lunes a domingo, aunque alguna no tenga compras.
  const [semanas] = await pool.query(
    `SELECT DATE_FORMAT(DATE_SUB(DATE(p.creado_en), INTERVAL WEEKDAY(p.creado_en) DAY), '%Y-%m-%d') AS lunes,
            COUNT(*) AS n
       FROM pedidos p
      WHERE ${filtro}
        AND p.creado_en >= DATE_SUB(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 11 WEEK)
      GROUP BY lunes ORDER BY lunes`
  );
  const [modas] = await pool.query(
    `SELECT p.cliente_id, DAYOFWEEK(p.creado_en) AS dow, HOUR(p.creado_en) AS hora, COUNT(*) AS n
       FROM pedidos p WHERE ${filtro} AND p.creado_en >= NOW() - INTERVAL :dias DAY
      GROUP BY p.cliente_id, dow, hora`,
    { dias }
  );
  const [[hoy]] = await pool.query(
    `SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), '%Y-%m-%d') AS lunes,
            DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy`
  );

  // El mapa: lunes a sábado (la tienda cierra el domingo) y de 9 a 19 h; si
  // hubo compras fuera de eso, se agrega la hora o el día.
  const total = mapa.reduce((s, m) => s + Number(m.n), 0);
  const horas = [...new Set([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, ...mapa.map((m) => Number(m.hora))])].sort((a, b) => a - b);
  const diasMapa = [2, 3, 4, 5, 6, 7, ...(mapa.some((m) => Number(m.dow) === 1) ? [1] : [])];
  const celda = (dow, h) => Number(mapa.find((m) => Number(m.dow) === dow && Number(m.hora) === h)?.n ?? 0);
  const porDia = diasMapa.map((dow) => ({ dow, n: horas.reduce((s, h) => s + celda(dow, h), 0) }));
  const fuerte = porDia.reduce((a, b) => (b.n > a.n ? b : a), { dow: 7, n: 0 });
  // La hora pico es la ventana de DOS horas con más compras.
  let pico = { desde: horas[0], n: 0 };
  for (const h of horas) {
    const n = diasMapa.reduce((s, d) => s + celda(d, h) + celda(d, h + 1), 0);
    if (n > pico.n) pico = { desde: h, n };
  }

  // Doce semanas, incluidas las vacías.
  const lunesSemanas = [];
  const base = new Date(hoy.lunes + 'T12:00:00Z');
  for (let i = 11; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 7 * 864e5);
    lunesSemanas.push(d.toISOString().slice(0, 10));
  }
  const porSemana = lunesSemanas.map((l) => ({ lunes: l, n: Number(semanas.find((s) => s.lunes === l)?.n ?? 0) }));

  // Día y hora de costumbre de cada cliente, y cuándo debería volver.
  const costumbre = new Map();
  for (const m of modas) {
    const c = costumbre.get(m.cliente_id) ?? { dias: {}, horas: {} };
    c.dias[m.dow] = (c.dias[m.dow] ?? 0) + Number(m.n);
    c.horas[m.hora] = (c.horas[m.hora] ?? 0) + Number(m.n);
    costumbre.set(m.cliente_id, c);
  }
  const masVeces = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0];
  const todos = await ritmos();
  const hoyMs = new Date(hoy.hoy + 'T12:00:00Z').getTime();
  const clientes = todos
    .filter((c) => costumbre.has(c.cliente_id))
    .map((c) => {
      const k = costumbre.get(c.cliente_id);
      const dow = Number(masVeces(k.dias));
      const hora = Number(masVeces(k.horas));
      let proxima = null;
      let en_dias = null;
      if (c.ritmo) {
        const ms = new Date(c.ultima + 'T12:00:00Z').getTime() + c.ritmo * 864e5;
        proxima = new Date(ms).toISOString().slice(0, 10);
        en_dias = Math.round((ms - hoyMs) / 864e5);
      }
      return {
        cliente_id: c.cliente_id, nombre: c.nombre, nombre_comercial: c.nombre_comercial, telefono: c.telefono,
        dia: DIAS[dow - 1], hora, ultima: c.ultima, ritmo: c.ritmo, proxima, en_dias,
      };
    })
    // Primero los que ya se pasaron (en_dias negativo), luego los que vienen.
    .sort((a, b) => (a.en_dias ?? 9999) - (b.en_dias ?? 9999));

  const estaSemana = porSemana.at(-1)?.n ?? 0;
  const pasada = porSemana.at(-2)?.n ?? 0;

  return {
    dias,
    total_compras: total,
    horas,
    mapa: diasMapa.map((dow) => ({ dow, dia: DIAS[dow - 1], celdas: horas.map((h) => celda(dow, h)) })),
    dia_fuerte: { dia: DIAS[fuerte.dow - 1], pct: total ? Math.round((100 * fuerte.n) / total) : 0 },
    hora_pico: { desde: pico.desde, hasta: pico.desde + 2, pct: total ? Math.round((100 * pico.n) / total) : 0 },
    semanas: porSemana,
    esta_semana: estaSemana,
    semana_pasada: pasada,
    les_toca_7_dias: clientes.filter((c) => c.en_dias != null && c.en_dias >= 0 && c.en_dias <= 7).length,
    clientes,
  };
}

// ------------------------------------------------------------- cuánto gasta

async function gasto({ dias }) {
  const params = { dias, dias2: dias * 2 };
  // TODOS los clientes activos, compren o no: la tabla de esta pestaña es
  // también el directorio desde donde se abre cualquier expediente.
  const [rows] = await pool.query(
    `SELECT c.id AS cliente_id, c.nombre, c.nombre_comercial, c.telefono,
            tc.nombre AS lista,
            COALESCE(SUM(CASE WHEN p.creado_en >= NOW() - INTERVAL :dias DAY THEN p.total END), 0) AS total,
            COUNT(CASE WHEN p.creado_en >= NOW() - INTERVAL :dias DAY THEN 1 END) AS compras,
            COALESCE(SUM(CASE WHEN p.creado_en < NOW() - INTERVAL :dias DAY THEN p.total END), 0) AS antes
       FROM clientes c
       LEFT JOIN tipos_cliente tc ON tc.id = c.tipo_cliente_id
       LEFT JOIN pedidos p ON p.cliente_id = c.id AND p.estado NOT IN ${MUERTOS}
                          AND p.creado_en >= NOW() - INTERVAL :dias2 DAY
      WHERE c.activo = 1
      GROUP BY c.id, c.nombre, c.nombre_comercial, c.telefono, tc.nombre
      ORDER BY total DESC, c.nombre`,
    params
  );
  const [[ventas]] = await pool.query(
    `SELECT COALESCE(SUM(total), 0) AS total FROM pedidos
      WHERE estado NOT IN ${MUERTOS} AND creado_en >= NOW() - INTERVAL :dias DAY`,
    params
  );
  const [listas] = await pool.query(
    `SELECT COALESCE(tc.nombre, 'Sin lista') AS lista, SUM(p.total) AS total
       FROM pedidos p LEFT JOIN tipos_cliente tc ON tc.id = p.tipo_cliente_id
      WHERE p.cliente_id IS NOT NULL AND p.estado NOT IN ${MUERTOS}
        AND p.creado_en >= NOW() - INTERVAL :dias DAY
      GROUP BY lista ORDER BY total DESC`,
    params
  );

  const totalClientes = rows.reduce((s, r) => s + Number(r.total), 0);
  const compras = rows.reduce((s, r) => s + Number(r.compras), 0);
  const conCompras = rows.filter((r) => Number(r.compras) > 0);
  const top10 = conCompras.slice(0, 10).reduce((s, r) => s + Number(r.total), 0);
  let acumulado = 0;
  const clientes = rows.map((r, i) => {
    const total = Number(r.total);
    const antes = Number(r.antes);
    acumulado += total;
    return {
      pos: i + 1,
      cliente_id: r.cliente_id, nombre: r.nombre, nombre_comercial: r.nombre_comercial, telefono: r.telefono,
      lista: r.lista,
      total: r2(total),
      compras: Number(r.compras),
      ticket: Number(r.compras) ? r2(total / Number(r.compras)) : null,
      antes: r2(antes),
      // null = no compró en el periodo anterior: no hay contra qué comparar.
      cambio_pct: antes > 0 ? Math.round((100 * (total - antes)) / antes) : null,
      acumulado_pct: totalClientes > 0 && total > 0 ? Math.round((100 * acumulado) / totalClientes) : null,
    };
  });

  return {
    dias,
    total_clientes: r2(totalClientes),
    total_ventas: r2(ventas.total),
    pct_de_ventas: Number(ventas.total) > 0 ? Math.round((100 * totalClientes) / Number(ventas.total)) : null,
    compras,
    ticket: compras ? r2(totalClientes / compras) : null,
    // Lo que gasta al mes, en promedio, cada cliente que compró en el periodo.
    gasto_mes: conCompras.length ? r2(totalClientes / conCompras.length / Math.max(1, dias / 30)) : null,
    pct_top10: totalClientes > 0 ? Math.round((100 * top10) / totalClientes) : null,
    compran_mas: rows.filter((r) => Number(r.antes) > 0 && Number(r.total) > Number(r.antes)).length,
    compran_menos: rows.filter((r) => Number(r.antes) > 0 && Number(r.total) < Number(r.antes)).length,
    nuevos: rows.filter((r) => Number(r.antes) === 0 && Number(r.total) > 0).length,
    por_lista: listas.map((l) => ({
      lista: l.lista, total: r2(l.total),
      pct: totalClientes > 0 ? Math.round((100 * Number(l.total)) / totalClientes) : 0,
    })),
    clientes,
  };
}

// --------------------------------------------------------- dejaron de venir

/**
 * Los que compraban y dejaron de venir: 2 compras o más y `sinVenir` días o
 * más sin aparecer (por omisión, los mismos 60 del aviso de la campana).
 * Es la MISMA consulta que usa la campana, para que el número del aviso y esta
 * lista nunca se contradigan. A diferencia de Frecuencia de compra —que mide a
 * cada quien contra SU ritmo—, aquí el corte es parejo para todos: "quiénes no
 * han vuelto en dos meses".
 */
async function dejaron({ sinVenir }) {
  return analisisModel.clientesEnfriados({ dias: sinVenir, minCompras: 2, limite: 500 });
}

module.exports = { frecuencia, deuda, queCompra, cuando, gasto, dejaron, ritmos };
