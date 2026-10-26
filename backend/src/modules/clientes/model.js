'use strict';

const { filtroAlmacen } = require('../permisos/service');
const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const { hoyLocal } = require('../../utils/fechas');
const { anotarCompartido } = require('../tiempo-real/contexto');
const transferencias = require('../transferencias/model');

// Acceso a datos de la tabla `clientes`.
//
// La tabla tiene DOS vidas y hay que tenerlo presente al tocarla:
//   · CUENTA de la tienda en línea: correo + contrasena_hash, se registra
//     el cliente solo y entra a ver sus pedidos.
//   · EXPEDIENTE de mostrador: lo captura el personal, no tiene cuenta —
//     `correo` y `contrasena_hash` quedan en NULL— y sirve para saber qué
//     le vendes a quién, cuánto te debe y qué colores se lleva.
// Es la misma fila: un cliente de años puede abrirse cuenta después y no
// hay que duplicarlo.

const CAMPOS_PUBLICOS = `
  id, nombre, correo, telefono, acepta_marketing, activo, creado_en, actualizado_en
`;

// El expediente completo, como lo ve el personal.
const CAMPOS_EXPEDIENTE = `
  c.id, c.codigo, c.nombre, c.nombre_comercial, c.rfc, c.tipo_cliente_id,
  c.correo, c.telefono, c.telefono_alt, c.direccion, c.ciudad, c.estado,
  c.lugar_entrega_id,
  (SELECT le.nombre FROM lugares_entrega le WHERE le.id = c.lugar_entrega_id) AS lugar_entrega,
  (SELECT le.estado FROM lugares_entrega le WHERE le.id = c.lugar_entrega_id) AS lugar_entrega_estado,
  c.como_llego, DATE_FORMAT(c.fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento,
  DATE_FORMAT(c.cliente_desde, '%Y-%m-%d') AS cliente_desde,
  c.limite_credito, c.notas, c.activo, c.creado_en, c.actualizado_en,
  (c.contrasena_hash IS NOT NULL) AS tiene_cuenta
`;

// Los pedidos que NO cuentan para el historial ni para los totales.
const ESTADOS_MUERTOS = "('cancelado', 'devuelto')";

/** Busca un cliente por correo incluyendo el hash (solo para login). */
async function buscarPorCorreoConHash(correo) {
  const [rows] = await pool.query(
    `SELECT id, nombre, correo, telefono, contrasena_hash, acepta_marketing,
            activo, creado_en, actualizado_en
       FROM clientes
      WHERE correo = :correo
      LIMIT 1`,
    { correo }
  );
  return rows[0] || null;
}

/** Devuelve un cliente por id sin datos sensibles. */
async function buscarPorId(id) {
  const [rows] = await pool.query(
    `SELECT ${CAMPOS_PUBLICOS} FROM clientes WHERE id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

/** Inserta un cliente y devuelve el registro público recién creado. */
async function crear({ nombre, correo, telefono, contrasena_hash, acepta_marketing }) {
  const [result] = await pool.query(
    `INSERT INTO clientes (nombre, correo, telefono, contrasena_hash, acepta_marketing,
                           cliente_desde)
     VALUES (:nombre, :correo, :telefono, :contrasena_hash, :acepta_marketing, CURDATE())`,
    {
      nombre,
      correo,
      telefono: telefono ?? null,
      contrasena_hash,
      acepta_marketing: acepta_marketing ? 1 : 0,
    }
  );
  await asignarCodigo(pool, result.insertId);
  return buscarPorId(result.insertId);
}

/**
 * EL NÚMERO DE CLIENTE LO DA EL SISTEMA (2026-10-14: "el número de cliente
 * quiero que tú me lo des y que no se pueda modificar"): C-0001, C-0002…, sacado
 * del id, así dos altas al mismo tiempo nunca toman el mismo. Del 10,000 en
 * adelante va sin ceros (C-10000): LPAD cortaría el número.
 */
async function asignarCodigo(ejecutor, id) {
  await ejecutor.query(
    `UPDATE clientes SET codigo = CONCAT('C-', IF(id < 10000, LPAD(id, 4, '0'), id))
      WHERE id = :id AND codigo IS NULL`,
    { id }
  );
}

// ---------------------------------------------------------------------------
//  El expediente: lo que usa el personal
// ---------------------------------------------------------------------------

/**
 * Listado con búsqueda. Trae el saldo de cada uno porque el listado tiene que
 * poder ordenarse por quién debe: es la pregunta que se hace todos los días.
 *
 * `q` busca en nombre, apodo, código y los dos teléfonos. Un cliente se busca
 * por como le dicen o por su número, casi nunca por su nombre completo.
 */
async function listar({ q, con_saldo, activo, lugar_entrega_id, sin_lugar, orden, limit, offset, almacenes = null } = {}) {
  const where = [];
  // Cuánto ha comprado y cuándo vino: en SUS tiendas (2026-10-15).
  const fv = filtroAlmacen('almacen_id', almacenes);
  const params = { limit, offset, ...fv.params };

  if (q) {
    where.push(`(c.nombre LIKE :q OR c.nombre_comercial LIKE :q OR c.codigo LIKE :q
                 OR c.telefono LIKE :q OR c.telefono_alt LIKE :q OR c.correo LIKE :q)`);
    params.q = `%${q}%`;
  }
  if (activo !== undefined) {
    where.push('c.activo = :activo');
    params.activo = activo ? 1 : 0;
  }
  // Los de un lugar de entrega, o los que no tienen ninguno (Clientes → Dónde entrego).
  if (lugar_entrega_id) {
    where.push('c.lugar_entrega_id = :lugar');
    params.lugar = lugar_entrega_id;
  } else if (sin_lugar) {
    where.push('c.lugar_entrega_id IS NULL');
  }
  // Solo los que deben. Va en el WHERE y NO en un HAVING: `s.saldo` viene del
  // LEFT JOIN a la vista, así que ya es un valor —no un agregado de ESTA
  // consulta— y un HAVING no lo alcanza si no está en el SELECT.
  if (con_saldo) where.push('COALESCE(s.saldo, 0) > 0');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const ORDENES = {
    nombre: 'c.nombre',
    saldo: 'saldo DESC',
    // Quién compra más. Lo que la tienda quiere ver para atender mejor.
    compras: 'total_comprado DESC',
    // Quién no ha vuelto. NULL primero sería ruido: van al final.
    reciente: 'ultima_compra IS NULL, ultima_compra DESC',
    nuevo: 'c.id DESC',
    // Por número de cliente (C-0001, C-0002…): es el orden en que se dieron de alta.
    numero: 'c.id',
  };
  // El id desempata: sin él, dos que deben lo mismo podían salir en las dos
  // páginas o en ninguna al pedir "Ver más".
  const orderBy = `${ORDENES[orden] || ORDENES.nombre}, c.id`;

  const sql = `
    SELECT ${CAMPOS_EXPEDIENTE},
           tc.nombre AS tipo_cliente,
           COALESCE(s.saldo, 0) AS saldo,
           COALESCE(s.disponible, c.limite_credito) AS credito_disponible,
           COALESCE(v.num_pedidos, 0) AS num_pedidos,
           COALESCE(v.total_comprado, 0) AS total_comprado,
           v.ultima_compra
      FROM clientes c
      LEFT JOIN tipos_cliente tc ON tc.id = c.tipo_cliente_id
      LEFT JOIN v_clientes_saldo s ON s.cliente_id = c.id
      LEFT JOIN (
        SELECT cliente_id,
               COUNT(*) AS num_pedidos,
               SUM(total) AS total_comprado,
               MAX(creado_en) AS ultima_compra
          FROM pedidos
         WHERE cliente_id IS NOT NULL AND estado NOT IN ${ESTADOS_MUERTOS}${fv.sql}
         GROUP BY cliente_id
      ) v ON v.cliente_id = c.id
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT :limit OFFSET :offset`;

  const [rows] = await pool.query(sql, params);

  // El total se cuenta aparte, con el MISMO where. El join a la vista se
  // mantiene siempre: si `con_saldo` filtra por `s.saldo`, sin el join la
  // columna no existiría.
  const { limit: _l, offset: _o, ...paramsConteo } = params;
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM clientes c
       LEFT JOIN v_clientes_saldo s ON s.cliente_id = c.id
       ${whereSql}`,
    paramsConteo
  );

  return { rows, total: Number(total) };
}

/** El expediente de un cliente, sin historial (eso va aparte). */
async function obtener(id) {
  const [rows] = await pool.query(
    `SELECT ${CAMPOS_EXPEDIENTE},
            tc.nombre AS tipo_cliente,
            COALESCE(s.saldo, 0) AS saldo,
            COALESCE(s.cargos, 0) AS cargos,
            COALESCE(s.abonos, 0) AS abonos,
            COALESCE(s.disponible, c.limite_credito) AS credito_disponible,
            s.ultimo_abono
       FROM clientes c
       LEFT JOIN tipos_cliente tc ON tc.id = c.tipo_cliente_id
       LEFT JOIN v_clientes_saldo s ON s.cliente_id = c.id
      WHERE c.id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

/**
 * Búsqueda rápida para el mostrador. Devuelve pocos campos y pocos resultados:
 * es para teclear tres letras y elegir, no para analizar.
 *
 * Trae el saldo y el crédito disponible porque el cajero necesita saber, EN EL
 * MOMENTO de elegirlo, si a esta persona se le puede fiar.
 */
/**
 * LA NOTA MÁS VIEJA QUE SIGUE SIN PAGARSE (2026-10-20, auditoría; el usuario
 * eligió "por la nota más vieja"): con sus movimientos de crédito en orden
 * ({ tipo, monto, pedido_id, dia }), reparte lo pagado como se cobra —de lo más
 * viejo a lo más nuevo, y el abono a una nota a ESA nota (`repartirAbonos`)— y
 * devuelve la primera deuda que todavía debe algo: `{ dia, porPagar, pedidoId }`,
 * o null si no debe. Pura: se prueba sola.
 *
 * Antes el reloj volvía a empezar con CUALQUIER abono: quien abonaba $50 cada
 * dos semanas nunca salía atrasado aunque debiera una nota de hace tres meses.
 */
function deudaMasVieja(movs) {
  const d = repartirAbonos(movs).find((x) => x.porPagar > 0.004);
  return d ? { dia: d.dia, porPagar: d.porPagar, pedidoId: d.pedidoId } : null;
}

/** Los días que lleva sin pagarse su nota más vieja, a partir de sus movimientos (null si no debe). */
function diasDeLaMasVieja(movs, hoy = hoyLocal()) {
  const d = deudaMasVieja(movs);
  if (!d?.dia) return null;
  // Las dos fechas como medianoche UTC: la resta da días enteros, igual que
  // DATEDIFF(CURDATE(), dia) con la hora de la tienda.
  return { dias: Math.max(0, Math.round((Date.parse(hoy) - Date.parse(d.dia)) / 86400000)), porPagar: d.porPagar };
}

/**
 * CUENTA ATRASADA de quien debe (la caja, el expediente y el candado de fiar):
 * cuántos días lleva sin pagarse su NOTA MÁS VIEJA (`deudaMasVieja`) y cuánto
 * le falta de ella: `{ dias, porPagar }`, o null si no debe. El campo sigue
 * llamándose `dias_sin_abonar` en las respuestas (2026-10-20).
 */
async function atrasoDe(clienteId, ejecutor = pool) {
  const [movs] = await ejecutor.query(
    `SELECT m.tipo, m.monto, m.pedido_id, DATE_FORMAT(m.creado_en, '%Y-%m-%d') AS dia, p.dias_credito
       FROM credito_movimientos m LEFT JOIN pedidos p ON p.id = m.pedido_id
      WHERE m.cliente_id = :id ORDER BY m.creado_en, m.id`,
    { id: clienteId }
  );
  const a = vencimientoDe(movs);
  if (a) await _conFolios(ejecutor, [a]);
  return a;
}

/** El plazo de una nota que no dijo sus días (las de antes): el de siempre, 15. */
function plazoPorOmision() {
  return require('../notificaciones/model').DIAS_SIN_ABONAR;
}

/** 'YYYY-MM-DD' + n días. */
function sumarDias(dia, n) {
  const d = new Date(Date.parse(dia));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Días de `a` a `b` ('YYYY-MM-DD'): b − a. */
function diasEntre(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/**
 * EL VENCIMIENTO DE SUS NOTAS (2026-10-20, usuario: "que diga a cuántos días es la
 * nota; después de los días, si no paga, una notificación"). Cada nota que todavía
 * se debe vence el día en que se fió más sus días de crédito (`pedidos.dias_credito`;
 * sin decirlo, 15). Con sus movimientos en orden (con `dia` y `dias_credito`):
 *   · `dias`, `porPagar`: los de su nota MÁS VIEJA (como antes);
 *   · `vencida`: la MÁS vencida ({ pedidoId, dia, plazo, venceEl, diasVencida,
 *     porPagar }), o null si ninguna pasó su fecha: eso es "cuenta atrasada";
 *   · `vencidas`: todas las que ya pasaron su fecha (la campana las lista);
 *   · `proxima`: la que vence primero de las que todavía no.
 * null si no debe. Pura (salvo el plazo por omisión): se prueba sola.
 * Con 15 días da lo mismo que la regla de antes ("más de 15 días sin pagarse").
 */
function vencimientoDe(movs, hoy = hoyLocal(), plazoSinDecir = plazoPorOmision()) {
  const notas = repartirAbonos(movs)
    .filter((d) => d.porPagar > 0.004 && d.dia)
    .map((d) => {
      const plazo = d.plazo ?? plazoSinDecir;
      const venceEl = sumarDias(d.dia, plazo);
      return { pedidoId: d.pedidoId, dia: d.dia, plazo, venceEl, diasVencida: diasEntre(venceEl, hoy), porPagar: d.porPagar };
    });
  if (!notas.length) return null;
  const vencidas = notas.filter((n) => n.diasVencida > 0).sort((a, b) => b.diasVencida - a.diasVencida);
  const proxima = notas.filter((n) => n.diasVencida <= 0).sort((a, b) => a.venceEl.localeCompare(b.venceEl))[0] ?? null;
  const vieja = notas[0];
  return {
    dias: Math.max(0, diasEntre(vieja.dia, hoy)),
    porPagar: vieja.porPagar,
    vencida: vencidas[0] ?? null,
    vencidas,
    proxima,
    // Todas las que se deben, con su vencimiento (para `porCobrarHasta`).
    notas,
  };
}

/**
 * Lo que hay que cobrarle A MÁS TARDAR ese día ('YYYY-MM-DD'): lo que falta de
 * sus notas ya vencidas y de las que vencen hasta ese día (2026-10-22, "Crédito
 * por cobrar este mes" en Cuánto debe; el usuario eligió "vencidas + las que
 * vencen este mes"). `atraso`: lo de `vencimientoDe`.
 */
function porCobrarHasta(atraso, dia) {
  const total = (atraso?.notas ?? []).filter((n) => n.venceEl <= dia).reduce((s, n) => s + n.porPagar, 0);
  return Math.round(total * 100) / 100;
}

/** El último día del mes de `hoy` ('YYYY-MM-DD'). */
function finDeMes(hoy = hoyLocal()) {
  const [a, m] = String(hoy).split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** Les pone su folio a las notas de `vencida`, `vencidas` y `proxima` (una consulta). */
async function _conFolios(ejecutor, atrasos) {
  const notas = atrasos.flatMap((a) => [a.vencida, a.proxima, ...(a.vencidas ?? [])]).filter((n) => n?.pedidoId);
  if (!notas.length) return;
  const [rows] = await ejecutor.query(
    'SELECT id, numero_pedido FROM pedidos WHERE id IN (:ids)', { ids: [...new Set(notas.map((n) => n.pedidoId))] }
  );
  const folio = new Map(rows.map((r) => [Number(r.id), r.numero_pedido]));
  for (const n of notas) n.folio = folio.get(n.pedidoId) ?? null;
}

/**
 * La nota vencida (o la próxima) como la manda la API. Sin su folio salvo que se
 * pida (`conFolio`, solo a quien ve todas): la nota puede ser de otra tienda.
 */
function notaVencimiento(n, { conFolio = false } = {}) {
  return n ? {
    ...(conFolio ? { pedido_id: n.pedidoId, folio: n.folio ?? null } : {}),
    dias_credito: n.plazo, vence_el: n.venceEl, dias_vencida: n.diasVencida, por_pagar: n.porPagar,
  } : null;
}

/** Solo los días de `atrasoDe` (null si no debe). */
async function diasSinAbonar(clienteId, ejecutor = pool) {
  return (await atrasoDe(clienteId, ejecutor))?.dias ?? null;
}

/**
 * El atraso de TODOS los que deben, con la MISMA cuenta que la caja
 * (`deudaMasVieja`): Map cliente_id → { dias, porPagar }. Una consulta para todos
 * (2026-10-17): la campana, Cuánto debe y Cómo va el negocio salen de aquí, así
 * nunca contradicen a la caja.
 */
async function diasSinAbonarDeTodos(ejecutor = pool) {
  const [movs] = await ejecutor.query(
    `SELECT m.cliente_id, m.tipo, m.monto, m.pedido_id, DATE_FORMAT(m.creado_en, '%Y-%m-%d') AS dia, p.dias_credito
       FROM credito_movimientos m
       LEFT JOIN pedidos p ON p.id = m.pedido_id
      WHERE m.cliente_id IN (SELECT s.cliente_id FROM v_clientes_saldo s WHERE s.saldo > 0)
      ORDER BY m.cliente_id, m.creado_en, m.id`
  );
  const porCliente = new Map();
  for (const m of movs) {
    const id = Number(m.cliente_id);
    if (!porCliente.has(id)) porCliente.set(id, []);
    porCliente.get(id).push(m);
  }
  const hoy = hoyLocal();
  const plazo = plazoPorOmision();
  const atrasos = new Map();
  for (const [id, lista] of porCliente) {
    const a = vencimientoDe(lista, hoy, plazo);
    if (a) atrasos.set(id, a);
  }
  await _conFolios(ejecutor, [...atrasos.values()]);
  return atrasos;
}

async function buscarParaVenta(q, limite = 10) {
  const [rows] = await pool.query(
    `SELECT c.id, c.codigo, c.nombre, c.nombre_comercial, c.telefono, c.direccion,
            c.tipo_cliente_id, tc.nombre AS tipo_cliente,
            c.limite_credito,
            COALESCE(s.saldo, 0) AS saldo,
            COALESCE(s.disponible, c.limite_credito) AS credito_disponible,
            -- Lo que le quedó a favor por devoluciones (2026-10-13): la caja
            -- ofrece usarlo al cobrar.
            (SELECT COALESCE(SUM(CASE WHEN f.tipo IN ('uso', 'aplicado') THEN -f.monto ELSE f.monto END), 0)
               FROM saldo_favor_movimientos f WHERE f.cliente_id = c.id) AS saldo_favor
       FROM clientes c
       LEFT JOIN tipos_cliente tc ON tc.id = c.tipo_cliente_id
       LEFT JOIN v_clientes_saldo s ON s.cliente_id = c.id
      WHERE c.activo = 1
        AND (c.nombre LIKE :q OR c.nombre_comercial LIKE :q OR c.codigo LIKE :q
             OR c.telefono LIKE :q OR c.telefono_alt LIKE :q)
      ORDER BY c.nombre
      LIMIT :limite`,
    { q: `%${q}%`, limite }
  );
  // Si debe, cuántos días lleva sin pagarse su nota más vieja y cuánto le falta
  // de ella: la caja avisa antes de fiarle a ciegas.
  for (const r of rows) {
    const a = Number(r.saldo) > 0 ? await atrasoDe(r.id) : null;
    r.dias_sin_abonar = a?.dias ?? null;
    r.nota_vieja_por_pagar = a?.porPagar ?? null;
    // Atrasada = alguna nota ya pasó su fecha (sus días de crédito, 2026-10-20).
    r.nota_vencida = notaVencimiento(a?.vencida);
    r.atrasado = !!a?.vencida;
  }
  return rows;
}

/** Alta desde el panel o el mostrador: sin cuenta, sin contraseña. El número lo da el sistema. */
async function crearDesdeStaff(datos) {
  const id = await withTransaction(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO clientes
         (nombre, nombre_comercial, rfc, tipo_cliente_id, correo, telefono,
          telefono_alt, direccion, ciudad, estado, lugar_entrega_id, como_llego, fecha_nacimiento,
          cliente_desde, limite_credito, notas, activo)
       VALUES
         (:nombre, :nombre_comercial, :rfc, :tipo_cliente_id, :correo, :telefono,
          :telefono_alt, :direccion, :ciudad, :estado, :lugar_entrega_id, :como_llego, :fecha_nacimiento,
          :cliente_desde, :limite_credito, :notas, :activo)`,
      datos
    );
    await asignarCodigo(conn, r.insertId);
    return r.insertId;
  });
  return obtener(id);
}

async function actualizar(id, datos) {
  await pool.query(
    // El número de cliente (`codigo`) NO se toca: lo dio el sistema y no se modifica.
    `UPDATE clientes SET
        nombre = :nombre, nombre_comercial = :nombre_comercial,
        rfc = :rfc, tipo_cliente_id = :tipo_cliente_id, correo = :correo,
        telefono = :telefono, telefono_alt = :telefono_alt, direccion = :direccion,
        ciudad = :ciudad, estado = :estado, lugar_entrega_id = :lugar_entrega_id,
        como_llego = :como_llego,
        fecha_nacimiento = :fecha_nacimiento, cliente_desde = :cliente_desde,
        limite_credito = :limite_credito, notas = :notas, activo = :activo
      WHERE id = :id`,
    { ...datos, id }
  );
  return obtener(id);
}

/** Solo el límite de crédito (2026-10-19: lo que se autoriza aparte de la ficha). */
async function fijarLimiteCredito(id, limite) {
  await pool.query('UPDATE clientes SET limite_credito = :limite WHERE id = :id', { id, limite });
}

/** ¿Ya está usado ese correo por OTRO cliente? (El número lo da el sistema: no se repite.) */
async function duplicado({ correo, exceptoId }) {
  if (!correo) return null;
  const [rows] = await pool.query(
    `SELECT id, correo FROM clientes WHERE id <> :excepto AND correo = :correo LIMIT 1`,
    { correo, excepto: exceptoId ?? 0 }
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
//  Lo que el cliente ha comprado
// ---------------------------------------------------------------------------

/**
 * Resumen de compras. Los cancelados y devueltos NO cuentan: preguntarle al
 * sistema "cuánto me ha comprado" y que incluya lo que devolvió sería mentir.
 */
async function estadisticas(id, almacenes = null) {
  const f = filtroAlmacen('almacen_id', almacenes);
  const fp = filtroAlmacen('p.almacen_id', almacenes);
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS num_pedidos,
            COALESCE(SUM(total), 0) AS total_comprado,
            -- Sin ROUND, AVG devuelve 6 decimales y la pantalla mostraría
            -- "$1,234.567890" como ticket promedio.
            ROUND(COALESCE(AVG(total), 0), 2) AS ticket_promedio,
            MIN(creado_en) AS primera_compra,
            MAX(creado_en) AS ultima_compra,
            -- COALESCE porque SUM sobre cero filas es NULL, y "null pedidos
            -- de mostrador" se lee como un dato faltante en vez de un cero.
            COALESCE(SUM(canal = 'punto_venta'), 0) AS pedidos_mostrador,
            COALESCE(SUM(canal = 'tienda_linea'), 0) AS pedidos_linea
       FROM pedidos
      WHERE cliente_id = :id AND estado NOT IN ${ESTADOS_MUERTOS}${f.sql}`,
    { id, ...f.params }
  );

  // Los kilos van aparte: viven en el detalle, no en el pedido.
  const [[k]] = await pool.query(
    `SELECT COALESCE(SUM(d.cantidad), 0) AS kilos
       FROM pedido_detalle d
       JOIN pedidos p ON p.id = d.pedido_id
      WHERE p.cliente_id = :id AND p.estado NOT IN ${ESTADOS_MUERTOS}${fp.sql}`,
    { id, ...fp.params }
  );

  // Y lo que canceló o devolvió, que también dice algo del cliente.
  const [[dev]] = await pool.query(
    `SELECT COUNT(*) AS num_devueltos, COALESCE(SUM(total), 0) AS total_devuelto
       FROM pedidos
      WHERE cliente_id = :id AND estado IN ${ESTADOS_MUERTOS}${f.sql}`,
    { id, ...f.params }
  );

  return { ...r, kilos: k.kilos, ...dev };
}

/**
 * Qué colores compra más. Se agrupa por `producto_id` y NO por nombre: el mismo
 * color en dos calibres son dos productos distintos y agruparlos por nombre los
 * sumaría en un renglón que no existe.
 */
async function coloresMasComprados(id, limite = 10, almacenes = null) {
  const f = filtroAlmacen('ped.almacen_id', almacenes);
  const [rows] = await pool.query(
    `SELECT p.id AS producto_id, p.nombre AS color, p.grosor_calibre AS calibre,
            cat.nombre AS material, l.nombre AS linea,
            SUM(d.cantidad) AS kilos,
            SUM(d.subtotal) AS importe,
            COUNT(DISTINCT ped.id) AS veces,
            MAX(ped.creado_en) AS ultima_vez
       FROM pedido_detalle d
       JOIN pedidos ped            ON ped.id = d.pedido_id
       JOIN producto_variantes pv  ON pv.id = d.variante_id
       JOIN productos p            ON p.id = pv.producto_id
       LEFT JOIN categorias cat    ON cat.id = p.categoria_id
       LEFT JOIN lineas l          ON l.id = p.linea_id
      WHERE ped.cliente_id = :id AND ped.estado NOT IN ${ESTADOS_MUERTOS}${f.sql}
      GROUP BY p.id, p.nombre, p.grosor_calibre, cat.nombre, l.nombre
      ORDER BY kilos DESC
      LIMIT :limite`,
    { id, limite, ...f.params }
  );
  return rows;
}

/**
 * Sus pedidos, lo más reciente primero.
 *
 * Cada pedido trae además QUÉ se llevó (los hilos, nombrados con su calibre),
 * cuántos kilos y CÓMO pagó (los métodos y la parte que quedó a deber): es lo
 * que la tabla "Sus compras" del expediente necesita para contestar una duda
 * sin abrir el pedido. Van en consultas aparte sobre los ids de la página —y no
 * con GROUP_CONCAT en la principal— para no depender del tope de 1,024
 * caracteres ni de subconsultas correlacionadas que MariaDB no acepta.
 */
async function pedidos(id, { limit = 20, offset = 0, almacenes = null } = {}) {
  // Solo las compras de SUS tiendas (2026-10-15).
  const f = filtroAlmacen('almacen_id', almacenes);
  const fp = filtroAlmacen('p.almacen_id', almacenes);
  const [rows] = await pool.query(
    `SELECT p.id, p.numero_pedido, p.canal, p.metodo_entrega, p.estado,
            p.subtotal, p.descuento, p.impuestos, p.costo_envio, p.total,
            p.creado_en, u.nombre AS atendio,  -- quien la vendió (2026-10-23)
            (SELECT COUNT(*) FROM pedido_detalle d WHERE d.pedido_id = p.id) AS num_lineas,
            (SELECT COALESCE(SUM(d.cantidad), 0) FROM pedido_detalle d WHERE d.pedido_id = p.id) AS kilos
       FROM pedidos p
       LEFT JOIN usuarios u ON u.id = COALESCE(p.vendedor_id, p.usuario_id)
      WHERE p.cliente_id = :id${fp.sql}
      ORDER BY p.creado_en DESC, p.id DESC
      LIMIT :limit OFFSET :offset`,
    { id, limit, offset, ...fp.params }
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM pedidos WHERE cliente_id = :id${f.sql}`,
    { id, ...f.params }
  );

  const ids = rows.map((r) => r.id);
  if (ids.length) {
    // Por HILO (producto_id), no por nombre: el mismo color en dos calibres
    // son dos productos.
    const [hilos] = await pool.query(
      `SELECT d.pedido_id, pr.id AS producto_id, pr.nombre AS color,
              pr.grosor_calibre AS calibre, SUM(d.cantidad) AS kg
         FROM pedido_detalle d
         JOIN producto_variantes pv ON pv.id = d.variante_id
         JOIN productos pr          ON pr.id = pv.producto_id
        WHERE d.pedido_id IN (:ids)
        GROUP BY d.pedido_id, pr.id, pr.nombre, pr.grosor_calibre
        ORDER BY kg DESC`,
      { ids }
    );
    // Los pagos reembolsados también cuentan aquí: dicen con qué pagó un
    // pedido que después se canceló.
    const [pagos] = await pool.query(
      `SELECT pg.pedido_id, mp.nombre AS metodo, SUM(pg.monto) AS monto
         FROM pagos pg
         JOIN metodos_pago mp ON mp.id = pg.metodo_pago_id
        WHERE pg.pedido_id IN (:ids) AND pg.estado IN ('completado', 'pendiente', 'reembolsado')
        GROUP BY pg.pedido_id, mp.nombre
        ORDER BY monto DESC`,
      { ids }
    );
    // Lo que se llevó a crédito es el CARGO original: aunque después se
    // cancele, el cargo se queda en el libro (se corrige con un ajuste).
    const [fiado] = await pool.query(
      `SELECT pedido_id, SUM(monto) AS monto FROM credito_movimientos
        WHERE tipo = 'cargo' AND pedido_id IN (:ids)
        GROUP BY pedido_id`,
      { ids }
    );
    for (const r of rows) {
      r.hilos = hilos
        .filter((h) => h.pedido_id === r.id)
        .map((h) => ({
          producto_id: h.producto_id,
          hilo: [h.color, h.calibre].filter(Boolean).join(' '),
          kg: h.kg,
        }));
      r.pagado_con = pagos
        .filter((p) => p.pedido_id === r.id)
        .map((p) => ({ metodo: p.metodo, monto: p.monto }));
      const f = fiado.find((x) => x.pedido_id === r.id);
      r.a_credito = f ? f.monto : '0.00';
    }
  }
  return { rows, total: Number(total) };
}

// ---------------------------------------------------------------------------
//  Crédito
// ---------------------------------------------------------------------------

/** El signo con que cada movimiento afecta la deuda. */
const SIGNO_CREDITO = { cargo: 1, abono: -1, ajuste: 1 };

/**
 * Saldo del cliente, bloqueando sus movimientos si se pide.
 *
 * `bloquear` es para la venta a crédito: sin el FOR UPDATE, dos cajas podrían
 * comprobar el límite a la vez y las dos pasarían, dejando al cliente por
 * encima de lo que se le fía.
 */
async function saldo(clienteId, ejecutor = pool, bloquear = false) {
  const [rows] = await ejecutor.query(
    `SELECT tipo, monto FROM credito_movimientos
      WHERE cliente_id = :id ${bloquear ? 'FOR UPDATE' : ''}`,
    { id: clienteId }
  );
  const total = rows.reduce((s, m) => s + SIGNO_CREDITO[m.tipo] * Number(m.monto), 0);
  return Math.round(total * 100) / 100;
}

/**
 * Un movimiento de su cuenta hecho en OTRA tienda (2026-10-15): se ve el monto
 * —el cliente es compartido y lo que debe es uno— pero no la venta, la nota ni
 * quién lo registró. `otra_tienda` lo marca para la pantalla.
 */
function _deOtraTienda(m, almacenes) {
  // Un abono A UNA NOTA (2026-10-19) tiene dos tiendas: la de la nota y la de la
  // caja que lo cobró. Se ve completo en cualquiera de las dos: la cajera de
  // Moroleón que cobró una nota de Principal no lo ve "en otra tienda".
  const { almacen_id: almacenId, almacen_caja: almacenCaja, ...resto } = m;
  const suyas = [almacenId, almacenCaja].filter((a) => a != null).map(Number);
  if (!Array.isArray(almacenes) || !suyas.length || suyas.some((a) => almacenes.includes(a))) return resto;
  return {
    ...resto, pedido_id: null, numero_pedido: null, referencia: null, notas: null, registro: null,
    sesion_caja_id: null, otra_tienda: true,
  };
}

/** Los movimientos de crédito de un cliente, con el saldo corriente. */
async function movimientosCredito(clienteId, { limit = 50, offset = 0, almacenes = null } = {}) {
  const [rows] = await pool.query(
    `SELECT m.id, m.tipo, m.monto, m.referencia, m.notas, m.creado_en,
            m.pedido_id, p.numero_pedido,
            m.metodo_pago_id, mp.nombre AS metodo_pago,
            m.sesion_caja_id, u.nombre AS registro,
            COALESCE(p.almacen_id, cj.almacen_id) AS almacen_id, cj.almacen_id AS almacen_caja
       FROM credito_movimientos m
       LEFT JOIN pedidos p       ON p.id = m.pedido_id
       LEFT JOIN sesiones_caja sc ON sc.id = m.sesion_caja_id
       LEFT JOIN cajas cj        ON cj.id = sc.caja_id
       LEFT JOIN metodos_pago mp ON mp.id = m.metodo_pago_id
       LEFT JOIN usuarios u      ON u.id = m.usuario_id
      WHERE m.cliente_id = :id
      ORDER BY m.creado_en DESC, m.id DESC
      LIMIT :limit OFFSET :offset`,
    { id: clienteId, limit, offset }
  );
  const [[{ total }]] = await pool.query(
    'SELECT COUNT(*) AS total FROM credito_movimientos WHERE cliente_id = :id',
    { id: clienteId }
  );
  return { rows: rows.map((m) => _deOtraTienda(m, almacenes)), total: Number(total) };
}

/**
 * Inserta un movimiento de crédito. Acepta un `ejecutor` para poder registrar
 * el cargo DENTRO de la transacción de la venta: si la venta se revierte, la
 * deuda no queda.
 */
async function agregarMovimiento(datos, ejecutor = pool) {
  anotarCompartido('clientes');
  const [r] = await ejecutor.query(
    `INSERT INTO credito_movimientos
       (cliente_id, tipo, monto, pedido_id, metodo_pago_id, sesion_caja_id,
        referencia, notas, usuario_id, creado_en)
     VALUES
       (:cliente_id, :tipo, :monto, :pedido_id, :metodo_pago_id, :sesion_caja_id,
        :referencia, :notas, :usuario_id, COALESCE(:creado_en, CURRENT_TIMESTAMP))`,
    {
      pedido_id: null,
      metodo_pago_id: null,
      sesion_caja_id: null,
      referencia: null,
      notas: null,
      usuario_id: null,
      // Las partes de un abono a varias notas llevan la MISMA hora: así su
      // ticket las junta (como las del anticipo).
      creado_en: null,
      ...datos,
    }
  );
  return r.insertId;
}

/**
 * Registra un abono del cliente, en UNA transacción.
 *
 * Si el abono es en EFECTIVO tiene que entrar también a la caja: si no, el
 * corte no cuadraría —hay dinero en el cajón que ninguna venta explica— y el
 * cajero aparecería con un sobrante que nadie sabe de dónde salió. Entra como
 * `'ingreso'` y no como `'venta'` para que no lo cuenten los reportes de
 * ventas: cobrar una deuda vieja no es vender hoy.
 *
 * Los demás métodos (transferencia, tarjeta) no pasan por el cajón, así que
 * solo bajan el saldo.
 */
async function registrarAbono(clienteId, datos, usuarioId, { almacenes = null } = {}) {
  return withTransaction(async (conn) => {
    // Se revalida el saldo con las filas bloqueadas: entre que la pantalla lo
    // leyó y el cajero confirmó, pudo entrar otro abono o una venta a crédito.
    const saldoActual = await saldo(clienteId, conn, true);
    // A NOTAS (2026-10-19): cada una con lo que paga, hasta lo que debe ESA nota
    // (con lo que ya le tocó de los abonos a la cuenta). Solo las que esta
    // persona puede escoger (`notasPorPagar`).
    const aNotas = await _partesANotas(conn, clienteId, datos.a_notas, almacenes);
    if (aNotas) datos = { ...datos, monto: Math.round(aNotas.reduce((s, x) => s + x.monto, 0) * 100) / 100 };
    if (saldoActual <= 0) {
      throw new AppError(409, 'SIN_DEUDA', 'Ese cliente ya no tiene saldo pendiente.');
    }
    if (Number(datos.monto) > saldoActual + 0.001) {
      throw new AppError(422, 'ABONO_EXCEDE_DEUDA',
        `El abono ($${Number(datos.monto).toFixed(2)}) es mayor a lo que debe ` +
        `ahora ($${saldoActual.toFixed(2)}).`);
    }

    // ¿Entra al cajón? Lo decide el nombre del método, como en la venta.
    let esEfectivo = false;
    if (datos.metodo_pago_id) {
      const [mrows] = await conn.query(
        'SELECT nombre, activo, interno FROM metodos_pago WHERE id = :id LIMIT 1',
        { id: datos.metodo_pago_id }
      );
      // "Saldo a favor" es interno: se aplica con su propio botón (saldo-favor.js).
      if (!mrows[0] || !mrows[0].activo || Number(mrows[0].interno)) {
        throw new AppError(422, 'METODO_PAGO_INVALIDO',
          'Ese método de pago no existe o está inactivo');
      }
      esEfectivo = mrows[0].nombre.toLowerCase().includes('efectivo');
    }

    let sesionId = datos.sesion_caja_id ?? null;
    if (esEfectivo) {
      // Con el turno cerrado el dinero quedaría fuera del corte: se rechaza
      // ANTES de tocar el saldo, para que un 409 no deje la deuda movida.
      if (sesionId) {
        const [srows] = await conn.query(
          'SELECT id, estado FROM sesiones_caja WHERE id = :id FOR UPDATE',
          { id: sesionId }
        );
        if (!srows[0]) throw new AppError(404, 'SESION_NO_ENCONTRADA', 'Sesión de caja no encontrada');
        if (srows[0].estado !== 'abierta') {
          throw new AppError(409, 'CAJA_CERRADA', 'La sesión de caja está cerrada');
        }
      } else {
        throw new AppError(409, 'FALTA_SESION_CAJA',
          'Un abono en efectivo tiene que entrar en un turno de caja abierto, ' +
          'o el corte no va a cuadrar. Abre el turno o registra el abono con otro método.');
      }
    } else {
      // Sin efectivo no hay nada que meter al cajón.
      sesionId = null;
    }

    // A la cuenta, un movimiento sin nota; a notas, uno por nota (ligado a ella),
    // todos con la misma hora.
    const [[{ ahora }]] = await conn.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS ahora");
    const partes = aNotas ?? [{ pedidoId: null, numero: null, monto: Number(datos.monto) }];
    const [[cli]] = await conn.query('SELECT nombre FROM clientes WHERE id = :id', { id: clienteId });
    const movimientos = [];
    for (const parte of partes) {
      const movId = await agregarMovimiento({
        cliente_id: clienteId,
        tipo: 'abono',
        monto: parte.monto,
        pedido_id: parte.pedidoId,
        metodo_pago_id: datos.metodo_pago_id ?? null,
        sesion_caja_id: sesionId,
        referencia: datos.referencia ?? null,
        notas: datos.notas ?? null,
        usuario_id: usuarioId ?? null,
        creado_en: ahora,
      }, conn);
      movimientos.push(movId);
    }
    // Por transferencia: a qué cuenta llegó (Transferencias, 2026-10-20). El
    // abono a varias notas es UN depósito: su llave es el primer renglón.
    await transferencias.anotar(conn, {
      fuente: 'abono', fuenteId: movimientos[0], metodoPagoId: datos.metodo_pago_id,
      cuentaId: datos.cuenta_bancaria_id, usuarioId,
    });

    // Al cajón entra UN movimiento por el abono, aunque vaya a varias notas
    // (2026-10-20, auditoría: un abono a 3 notas salía como "3 abonos" en Caja).
    if (esEfectivo) {
      const notas = partes.filter((x) => x.numero).map((x) => x.numero);
      const aQue = notas.length === 1 ? ` a la nota ${notas[0]}`
        : notas.length > 1 ? ` a ${notas.length} notas (${notas.join(', ')})` : '';
      await conn.query(
        `INSERT INTO movimientos_caja (sesion_caja_id, tipo, monto, referencia_id, motivo)
         VALUES (:sesion, 'ingreso', :monto, :ref, :motivo)`,
        {
          sesion: sesionId,
          monto: Math.round(partes.reduce((t, x) => t + Number(x.monto), 0) * 100) / 100,
          // `referencia_id` apunta al (primer) movimiento de crédito, no al
          // cliente: así desde el corte se puede llegar al abono exacto.
          ref: movimientos[0],
          motivo: `Abono de ${cli ? cli.nombre : 'cliente'}${aQue}`.slice(0, 255),
        }
      );
    }

    // Las ventas fiadas que este abono termina de pagar pasan a 'pagado'. Se
    // dicen las que esta persona puede ver; las de otra tienda, solo cuántas.
    const pagadas = await liquidarVentasACredito(conn, clienteId, { ids: true });
    const { folios: liquidadas, otras } = await foliosVisibles(conn, clienteId, almacenes, pagadas);

    return {
      movimiento_id: movimientos[0], movimientos, saldo_nuevo: await saldo(clienteId, conn),
      liquidadas, liquidadas_otra_tienda: otras,
    };
  });
}

/**
 * Reparte lo que el cliente ha pagado entre lo que debe, de lo MÁS ANTIGUO a lo
 * más nuevo (FIFO), que es como se cobra. Las deudas son lo que debe cada venta
 * (su cargo con sus ajustes; una cancelada queda en 0) y los ajustes a la
 * cuenta que la suben; se pagan con los abonos y los ajustes que la bajan
 * (condonar). Devuelve cada deuda con cuánto se ha pagado y cuánto falta.
 *
 * La usan la liquidación (abajo) y el detalle del pedido, para que "pagada" y
 * "debe tanto" salgan de la misma cuenta.
 */
async function aplicarAbonos(ejecutor, clienteId) {
  const [movs] = await ejecutor.query(
    `SELECT m.id, m.tipo, m.monto, m.pedido_id, m.creado_en, p.dias_credito
       FROM credito_movimientos m LEFT JOIN pedidos p ON p.id = m.pedido_id
      WHERE m.cliente_id = :id
      ORDER BY m.creado_en, m.id`,
    { id: clienteId }
  );
  return repartirAbonos(movs);
}

/**
 * El reparto de `aplicarAbonos`, sin base: recibe los movimientos de la cuenta
 * en orden (`tipo`, `monto`, `pedido_id`). La nómina lo corre sobre los
 * movimientos hasta cierta fecha para saber CUÁNDO quedó pagada una venta fiada
 * (la comisión se paga la semana en que se liquida).
 */
function repartirAbonos(movs) {
  const r2 = (n) => Math.round(n * 100) / 100;
  // Lo que debe cada venta, en el orden de su primer movimiento.
  const porPedido = new Map();
  const deudas = [];
  // El día de su primer movimiento (el cargo): de ahí cuenta la nota más vieja.
  const diaDe = (m) => (m.dia ?? (m.creado_en ? String(m.creado_en).slice(0, 10) : null));
  const deLaVenta = (pedidoId, m) => {
    let d = porPedido.get(pedidoId);
    if (!d) {
      d = { pedidoId: Number(pedidoId), monto: 0, directo: 0, dia: diaDe(m) };
      porPedido.set(pedidoId, d);
      deudas.push(d);
    }
    // Sus días de crédito (2026-10-20), si los movimientos los traen.
    if (d.plazo == null && m.dias_credito != null) d.plazo = Number(m.dias_credito);
    return d;
  };
  let pago = 0;
  for (const m of movs) {
    const firmado = SIGNO_CREDITO[m.tipo] * Number(m.monto);
    if (m.pedido_id != null && m.tipo === 'abono') {
      // ABONO A ESA NOTA (2026-10-19): es lo pagado de ella, no baja lo que debía.
      deLaVenta(m.pedido_id, m).directo += Number(m.monto);
    } else if (m.pedido_id != null) {
      deLaVenta(m.pedido_id, m).monto += firmado;
    } else if (firmado > 0) {
      deudas.push({ pedidoId: null, monto: firmado, directo: 0, dia: diaDe(m) });
    } else {
      pago += -firmado;
    }
  }

  // Lo abonado a una nota que ya no lo debe (se canceló) pasa a la cuenta: paga
  // lo más antiguo, o le queda a favor. Nunca se pierde.
  for (const d of deudas) {
    d.monto = Math.max(0, r2(d.monto));
    const directo = r2(d.directo);
    d.directo = Math.min(d.monto, directo);
    pago += directo - d.directo;
  }
  for (const d of deudas) {
    const aplica = Math.min(r2(d.monto - d.directo), Math.max(0, r2(pago)));
    d.pagado = r2(d.directo + aplica);
    d.porPagar = r2(d.monto - d.pagado);
    pago -= aplica;
  }
  // El día y el plazo solo cuando se saben (los movimientos los traen).
  return deudas.map(({ directo, dia, plazo, ...d }) => ({
    ...d, ...(dia == null ? {} : { dia }), ...(plazo == null ? {} : { plazo }),
  }));
}

/** Lo que PAGA un movimiento de la cuenta: dinero (efectivo o banco), su saldo a favor o un ajuste a mano. */
function origenDe(m) {
  if (m.origen) return m.origen;
  if (m.tipo === 'ajuste') return 'ajuste';
  if (Number(m.interno)) return 'saldo';
  return /efectivo/i.test(String(m.metodo ?? '')) ? 'efectivo' : 'transferencia';
}

/**
 * DE DÓNDE SALIÓ LO PAGADO (2026-10-26, auditoría: "lo que ya abonó" contaba
 * una condonación como dinero y al cancelar se podía regresar en efectivo). El
 * mismo reparto que `repartirAbonos` —lo abonado a una nota la paga a ella y lo
 * demás va de lo más viejo a lo más nuevo— pero sabiendo de dónde salió cada
 * peso: EFECTIVO o TRANSFERENCIA (dinero que entró), su SALDO A FAVOR
 * («Descontar de lo que debe») o un AJUSTE a mano («Corregir deuda»: una
 * condonación). Devuelve cada deuda con lo pagado por origen y lo que SOBRA (lo
 * pagado que ya no paga nada), que es lo último que llegó.
 *
 * Cada movimiento trae `tipo`, `monto`, `pedido_id` y, para saber su origen,
 * `interno` y `metodo` (el nombre del método), o su `origen` ya resuelto.
 */
function rastrearPagos(movs) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const vacio = () => ({ efectivo: 0, transferencia: 0, saldo: 0, ajuste: 0 });
  const porPedido = new Map();
  const deudas = [];
  // Primera vuelta: lo que debe cada venta y cada ajuste que subió la cuenta.
  for (const m of movs) {
    const firmado = SIGNO_CREDITO[m.tipo] * Number(m.monto);
    if (m.pedido_id != null) {
      let d = porPedido.get(Number(m.pedido_id));
      if (!d) {
        d = { pedidoId: Number(m.pedido_id), monto: 0 };
        porPedido.set(Number(m.pedido_id), d);
        deudas.push(d);
      }
      if (m.tipo !== 'abono') d.monto += firmado;
    } else if (firmado > 0) {
      deudas.push({ pedidoId: null, monto: firmado });
    }
  }
  for (const d of deudas) {
    d.monto = Math.max(0, r2(d.monto));
    d.libre = d.monto;
    d.porOrigen = vacio();
  }
  // Segunda vuelta, en orden: el abono a una nota la paga a ella (lo que le sobre
  // va al fondo); el abono a la cuenta y la condonación van al fondo.
  const fondo = [];
  for (const m of movs) {
    const firmado = SIGNO_CREDITO[m.tipo] * Number(m.monto);
    const origen = origenDe(m);
    if (m.pedido_id != null && m.tipo === 'abono') {
      const d = porPedido.get(Number(m.pedido_id));
      const aplica = Math.min(d.libre, Number(m.monto));
      d.libre = r2(d.libre - aplica);
      d.porOrigen[origen] = r2(d.porOrigen[origen] + aplica);
      const sobra = r2(Number(m.monto) - aplica);
      if (sobra > 0) fondo.push({ monto: sobra, origen });
    } else if (m.pedido_id == null && firmado < 0) {
      fondo.push({ monto: r2(-firmado), origen });
    }
  }
  // El fondo paga las deudas de la más vieja a la más nueva.
  let i = 0;
  for (const d of deudas) {
    while (d.libre > 0.004 && i < fondo.length) {
      const f = fondo[i];
      const toma = r2(Math.min(d.libre, f.monto));
      d.libre = r2(d.libre - toma);
      f.monto = r2(f.monto - toma);
      d.porOrigen[f.origen] = r2(d.porOrigen[f.origen] + toma);
      if (f.monto <= 0.004) i++;
    }
  }
  const sobrante = vacio();
  for (; i < fondo.length; i++) sobrante[fondo[i].origen] = r2(sobrante[fondo[i].origen] + fondo[i].monto);
  return {
    deudas: deudas.map((d) => ({
      pedidoId: d.pedidoId, monto: d.monto, pagado: r2(d.monto - d.libre), porPagar: d.libre, porOrigen: d.porOrigen,
    })),
    sobrante: { ...sobrante, total: r2(sobrante.efectivo + sobrante.transferencia + sobrante.saldo + sobrante.ajuste) },
  };
}

/** Los movimientos de su cuenta, en orden, con lo que hace falta para saber su origen. */
async function movimientosConOrigen(ejecutor, clienteId) {
  const [movs] = await ejecutor.query(
    `SELECT m.id, m.tipo, m.monto, m.pedido_id, m.creado_en, mp.interno, mp.nombre AS metodo
       FROM credito_movimientos m LEFT JOIN metodos_pago mp ON mp.id = m.metodo_pago_id
      WHERE m.cliente_id = :id
      ORDER BY m.creado_en, m.id`,
    { id: clienteId }
  );
  return movs;
}

/**
 * Lo que quedaría LIBRE si se cancela esta venta a crédito (2026-10-26): lo que
 * se le abonó y ya no pagaría nada, por origen. Simula la cancelación: lo que
 * debía esa nota (su cargo y sus ajustes) se va y lo abonado a ella pasa al
 * fondo, que primero paga sus otras notas.
 */
async function libreSiSeCancela(ejecutor, clienteId, pedidoId) {
  const movs = (await movimientosConOrigen(ejecutor, clienteId))
    .filter((m) => !(Number(m.pedido_id) === Number(pedidoId) && m.tipo !== 'abono'));
  return rastrearPagos(movs).sobrante;
}

/**
 * LAS NOTAS A CRÉDITO QUE SE PUEDEN PAGAR (2026-10-19: "quiero hacer el abono a
 * las notas, no en general; y también así como está, abono a cuenta"). Las que
 * todavía deben algo, de la más vieja a la más nueva, con lo que debe cada una
 * con la misma cuenta que la da por pagada.
 *
 * CADA QUIEN, SUS TIENDAS, con el detalle que pidió el usuario: quien no ve todas
 * ve las de sus tiendas y, si el cliente TAMBIÉN COMPRA AQUÍ (tiene una venta
 * vigente en alguna de sus tiendas), también las de las otras, con su tienda
 * (`otra_tienda`). Si nunca le ha comprado, ninguna: le queda el abono a la
 * cuenta. `ocultas` dice cuántas no puede ver (para explicarlo).
 */
async function notasPorPagar(ejecutor, clienteId, almacenes = null) {
  const deben = (await aplicarAbonos(ejecutor, clienteId)).filter((d) => d.pedidoId != null && d.porPagar > 0.004);
  if (!deben.length) return { notas: [], ocultas: 0 };
  const [ps] = await ejecutor.query(
    `SELECT p.id, p.numero_pedido, DATE_FORMAT(p.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
            p.almacen_id, a.nombre AS almacen, p.total
       FROM pedidos p LEFT JOIN almacenes a ON a.id = p.almacen_id
      WHERE p.id IN (:ids) AND p.cliente_id = :cli AND p.estado NOT IN ('cancelado', 'devuelto')`,
    { ids: deben.map((d) => d.pedidoId), cli: clienteId }
  );
  const porId = new Map(ps.map((p) => [Number(p.id), p]));
  const compraAqui = await compraEnSusTiendas(ejecutor, clienteId, almacenes);
  const todas = deben
    .filter((d) => porId.has(d.pedidoId))
    .map((d) => {
      const p = porId.get(d.pedidoId);
      const otra = Array.isArray(almacenes) && !almacenes.includes(Number(p.almacen_id));
      return {
        pedido_id: d.pedidoId,
        numero_pedido: p.numero_pedido,
        creado_en: p.creado_en,
        almacen_id: p.almacen_id == null ? null : Number(p.almacen_id),
        almacen: p.almacen,
        otra_tienda: otra,
        fiado: d.monto,
        pagado: d.pagado,
        por_pagar: d.porPagar,
      };
    });
  const notas = compraAqui ? todas : [];
  return { notas, ocultas: todas.length - notas.length };
}

/**
 * ¿El cliente TAMBIÉN COMPRA en alguna de estas tiendas? Una venta vigente que
 * se llevó la mercancía (`inventario_descontado`): una nota en espera o un
 * apartado no cuentan, o con hacer una y cancelarla se verían las notas de la
 * otra tienda. Quien ve todas (null), siempre.
 */
async function compraEnSusTiendas(ejecutor, clienteId, almacenes) {
  if (!Array.isArray(almacenes)) return true;
  if (!almacenes.length) return false;
  const [[c]] = await ejecutor.query(
    `SELECT EXISTS (SELECT 1 FROM pedidos WHERE cliente_id = :cli AND almacen_id IN (:alm)
                      AND estado NOT IN ('cancelado', 'devuelto') AND inventario_descontado = 1) AS si`,
    { cli: clienteId, alm: almacenes }
  );
  return Boolean(Number(c.si));
}

/**
 * De unas notas del cliente, los FOLIOS que esta persona puede ver (las de sus
 * tiendas, o todas si el cliente también le compra a la suya) y cuántas no:
 * el ticket y la respuesta del abono dicen "y 1 nota de otra tienda".
 */
async function foliosVisibles(ejecutor, clienteId, almacenes, pedidoIds) {
  if (!pedidoIds.length) return { folios: [], otras: 0 };
  const [ps] = await ejecutor.query(
    'SELECT id, numero_pedido, almacen_id FROM pedidos WHERE id IN (:ids) ORDER BY id',
    { ids: pedidoIds }
  );
  if (await compraEnSusTiendas(ejecutor, clienteId, almacenes)) {
    return { folios: ps.map((p) => p.numero_pedido), otras: 0 };
  }
  const suyas = ps.filter((p) => almacenes.includes(Number(p.almacen_id)));
  return { folios: suyas.map((p) => p.numero_pedido), otras: ps.length - suyas.length };
}

/**
 * Las partes de un abono A NOTAS, revisadas con la cuenta bloqueada: cada nota
 * una vez, de las que esta persona puede escoger, y no más de lo que debe.
 * null si el abono es a la cuenta.
 */
async function _partesANotas(conn, clienteId, aNotas, almacenes) {
  if (!Array.isArray(aNotas) || !aNotas.length) return null;
  const { notas } = await notasPorPagar(conn, clienteId, almacenes);
  const porId = new Map(notas.map((n) => [n.pedido_id, n]));
  const vistas = new Set();
  return aNotas.map((x) => {
    const id = Number(x.pedido_id);
    const monto = Math.round(Number(x.monto) * 100) / 100;
    if (vistas.has(id)) throw new AppError(422, 'NOTA_REPETIDA', 'Una nota viene dos veces en el abono.');
    vistas.add(id);
    const n = porId.get(id);
    if (!n) {
      throw new AppError(404, 'NOTA_NO_ENCONTRADA',
        'Esa nota ya no debe nada o no es de las que puedes cobrar aquí: haz el abono a la cuenta.');
    }
    if (!(monto > 0)) throw new AppError(422, 'MONTO_INVALIDO', `Pon cuánto abona a la nota ${n.numero_pedido}.`);
    if (monto > n.por_pagar + 0.001) {
      throw new AppError(422, 'ABONO_EXCEDE_NOTA',
        `A la nota ${n.numero_pedido} le faltan $${n.por_pagar.toFixed(2)}: no se le puede abonar ` +
        `$${monto.toFixed(2)}.`);
    }
    return { pedidoId: id, numero: n.numero_pedido, monto };
  });
}

/**
 * Da por PAGADAS las ventas a crédito que los abonos ya cubren.
 *
 * El crédito es un libro de la CUENTA, no venta por venta: el abono a la cuenta
 * no dice a qué venta va (el abono A UNA NOTA sí, desde el 2026-10-19). Pero una venta fiada nace 'pendiente' y sin esto se quedaba así
 * para siempre, aunque el cliente ya hubiera pagado todo (lo vio el usuario el
 * 2026-10-06: "lo aboné y la venta aún seguía pendiente").
 *
 * Los abonos se aplican a lo MÁS ANTIGUO primero (`aplicarAbonos`), que es como
 * se cobra: con $100 abonados sobre una venta de $100 del día 1 y otra de $200
 * del día 3, la del día 1 queda pagada y la del 3 sigue debiendo.
 *
 * Solo mueve 'pendiente' → 'pagado'. Nunca regresa una venta a pendiente: lo
 * más antiguo se cubre primero, así que una deuda nueva no destapa una vieja.
 * Va DENTRO de la transacción del abono (o del ajuste). Devuelve los folios que
 * quedaron pagados.
 */
async function liquidarVentasACredito(conn, clienteId, { ids = false } = {}) {
  const cubiertas = (await aplicarAbonos(conn, clienteId))
    .filter((d) => d.pedidoId != null && d.monto > 0 && d.porPagar === 0)
    .map((d) => d.pedidoId);
  if (!cubiertas.length) return [];

  const [pendientes] = await conn.query(
    `SELECT id, numero_pedido FROM pedidos
      WHERE id IN (:ids) AND estado = 'pendiente' FOR UPDATE`,
    { ids: cubiertas }
  );
  if (!pendientes.length) return [];
  await conn.query(
    "UPDATE pedidos SET estado = 'pagado' WHERE id IN (:ids)",
    { ids: pendientes.map((p) => p.id) }
  );
  return ids ? pendientes.map((p) => Number(p.id)) : pendientes.map((p) => p.numero_pedido);
}

/**
 * Carga a la cuenta del cliente lo que se llevó a crédito. Se llama DENTRO de
 * la transacción de la venta: si la venta se revierte, la deuda no queda.
 *
 * Valida el límite con las filas bloqueadas, para que dos cajas cobrando a la
 * vez no puedan pasarlo entre las dos.
 */
async function cargarVentaACredito(conn, { clienteId, monto, pedidoId, numeroPedido, usuarioId, diasCredito = null }) {
  const [crows] = await conn.query(
    'SELECT id, nombre, limite_credito, activo FROM clientes WHERE id = :id FOR UPDATE',
    { id: clienteId }
  );
  const cliente = crows[0];
  if (!cliente) throw new AppError(422, 'CLIENTE_INVALIDO', 'Ese cliente no existe');
  if (!cliente.activo) {
    throw new AppError(422, 'CLIENTE_INACTIVO', `${cliente.nombre} está dado de baja.`);
  }

  const limite = Number(cliente.limite_credito);
  if (limite <= 0) {
    throw new AppError(409, 'SIN_CREDITO',
      `${cliente.nombre} no tiene crédito autorizado. Captúrale un límite en su expediente.`);
  }

  const saldoActual = await saldo(clienteId, conn, true);
  const disponible = Math.round((limite - saldoActual) * 100) / 100;
  if (monto > disponible + 0.001) {
    throw new AppError(409, 'CREDITO_INSUFICIENTE',
      `${cliente.nombre} debe $${saldoActual.toFixed(2)} de un límite de ` +
      `$${limite.toFixed(2)}: le quedan $${disponible.toFixed(2)} y esta venta es ` +
      `de $${monto.toFixed(2)}.`);
  }

  // A CUÁNTOS DÍAS es la nota (2026-10-20): los que se dijeron al venderla; sin
  // decirlo, los de siempre. Vence el día en que se fía más esos días.
  const dias = diasCredito ?? plazoPorOmision();
  await conn.query('UPDATE pedidos SET dias_credito = :dias WHERE id = :id', { dias, id: pedidoId });
  return agregarMovimiento({
    cliente_id: clienteId,
    tipo: 'cargo',
    monto,
    pedido_id: pedidoId,
    notas: `Venta a crédito ${numeroPedido} a ${dias} ${dias === 1 ? 'día' : 'días'}`,
    usuario_id: usuarioId ?? null,
  }, conn);
}

/**
 * Deshace (o repone) la deuda de un pedido cuando se cancela o se reactiva.
 *
 * NO borra el cargo original: el libro de crédito no se borra, se corrige con
 * otro movimiento, igual que el kardex. Así el estado de cuenta sigue contando
 * lo que pasó ("se llevó, se canceló") en vez de fingir que nunca ocurrió.
 *
 * Es IDEMPOTENTE: revierte el NETO de todos los movimientos del pedido, así que
 * cancelar dos veces no perdona la deuda dos veces.
 */
async function ajustarCreditoPorPedido(conn, { pedidoId, numeroPedido, usuarioId, revertir }) {
  const [rows] = await conn.query(
    `SELECT cliente_id, tipo, monto FROM credito_movimientos
      WHERE pedido_id = :id FOR UPDATE`,
    { id: pedidoId }
  );
  const cambio = ajusteDeCancelacion(rows, revertir);
  if (cambio === null) return null;
  return agregarMovimiento({
    cliente_id: rows[0].cliente_id,
    tipo: 'ajuste',
    monto: cambio,
    pedido_id: pedidoId,
    notas: revertir
      ? `Cancelación de ${numeroPedido}: se quita la deuda`
      : `Reactivación de ${numeroPedido}: vuelve la deuda`,
    usuario_id: usuarioId ?? null,
  }, conn);
}

/**
 * Cuánto ajustar la nota al cancelarla o reactivarla, o null si nada. Sin base:
 * se prueba sola.
 *
 * Se mira su DEUDA —el cargo y sus ajustes—, no lo que se le abonó: lo abonado a
 * esa nota (2026-10-19) no se perdona ni se pierde, pasa a la cuenta del
 * cliente (`repartirAbonos`). Cancelar deja la deuda en 0, y es idempotente:
 * cancelar dos veces no perdona dos veces. Reactivar la regresa a lo que se
 * cargó (una venta con devoluciones no se cancela completa, así que su cargo es
 * lo que debía). Antes se miraba el neto y reactivar no reponía nada: cancelar
 * lo dejaba en 0 y la deuda solo volvía "si era negativa".
 */
function ajusteDeCancelacion(movs, revertir) {
  if (!movs.some((m) => m.tipo === 'cargo')) return null; // No fue una venta a crédito.
  const r2 = (n) => Math.round(n * 100) / 100;
  const deuda = r2(movs.filter((m) => m.tipo !== 'abono').reduce((s, m) => s + SIGNO_CREDITO[m.tipo] * Number(m.monto), 0));
  const cargos = r2(movs.filter((m) => m.tipo === 'cargo').reduce((s, m) => s + Number(m.monto), 0));
  const cambio = r2((revertir ? 0 : cargos) - deuda);
  if (revertir ? cambio >= -0.004 : cambio <= 0.004) return null;
  return cambio;
}

/**
 * La costumbre de un cliente, para la vista Resumen de su expediente.
 * El ritmo se mide en DÍAS con compra (dos tickets el mismo día son una visita),
 * igual que en la pestaña Frecuencia de compra.
 */
async function habitos(clienteId, almacenes = null) {
  // Su costumbre en SUS tiendas (2026-10-15).
  const f = filtroAlmacen('almacen_id', almacenes);
  const fp = filtroAlmacen('p.almacen_id', almacenes);
  const vivo = `estado NOT IN ('cancelado', 'devuelto')${f.sql}`;
  const [[v]] = await pool.query(
    `SELECT COUNT(DISTINCT DATE(creado_en)) AS dias_con_compra,
            DATE_FORMAT(MIN(creado_en), '%Y-%m-%d') AS primera,
            DATE_FORMAT(MAX(creado_en), '%Y-%m-%d') AS ultima,
            DATEDIFF(CURDATE(), DATE(MAX(creado_en))) AS dias_sin_venir,
            DATEDIFF(DATE(MAX(creado_en)), DATE(MIN(creado_en))) AS lapso
       FROM pedidos WHERE cliente_id = :id AND ${vivo}`,
    { id: clienteId, ...f.params }
  );
  const [visitas] = await pool.query(
    `SELECT DISTINCT DATE_FORMAT(creado_en, '%Y-%m-%d') AS dia, DATEDIFF(CURDATE(), DATE(creado_en)) AS hace
       FROM pedidos
      WHERE cliente_id = :id AND ${vivo} AND creado_en >= CURDATE() - INTERVAL 90 DAY
      ORDER BY dia`,
    { id: clienteId, ...f.params }
  );
  const [porDia] = await pool.query(
    `SELECT DAYOFWEEK(creado_en) AS dow, COUNT(*) AS n FROM pedidos
      WHERE cliente_id = :id AND ${vivo} GROUP BY dow`,
    { id: clienteId, ...f.params }
  );
  // Todas las horas, no solo la de costumbre: la pestaña "Cuándo compra" del
  // expediente dibuja cómo se reparten. La primera sigue siendo la que más.
  const [porHora] = await pool.query(
    `SELECT HOUR(creado_en) AS hora, COUNT(*) AS n FROM pedidos
      WHERE cliente_id = :id AND ${vivo} GROUP BY hora ORDER BY n DESC, hora`,
    { id: clienteId, ...f.params }
  );
  // Los últimos 90 días contra los 90 anteriores, con la MISMA ventana que la
  // pestaña Cuánto gasta (NOW() - INTERVAL): así el expediente y la pestaña
  // dicen la misma cifra de lo que gastó.
  const [[p90]] = await pool.query(
    `SELECT COUNT(CASE WHEN creado_en >= NOW() - INTERVAL 90 DAY THEN 1 END) AS compras,
            COALESCE(SUM(CASE WHEN creado_en >= NOW() - INTERVAL 90 DAY THEN total END), 0) AS total,
            COUNT(CASE WHEN creado_en < NOW() - INTERVAL 90 DAY THEN 1 END) AS compras_antes,
            COALESCE(SUM(CASE WHEN creado_en < NOW() - INTERVAL 90 DAY THEN total END), 0) AS total_antes
       FROM pedidos
      WHERE cliente_id = :id AND ${vivo} AND creado_en >= NOW() - INTERVAL 180 DAY`,
    { id: clienteId, ...f.params }
  );
  // Qué se llevó en esos 90 días: kilos, cuántos en cono y de cuántos HILOS
  // distintos (producto_id: el mismo color en dos calibres son dos hilos).
  const [[k90]] = await pool.query(
    `SELECT COALESCE(SUM(d.cantidad), 0) AS kg,
            COALESCE(SUM(CASE WHEN pv.tipo_presentacion = 'cono' THEN d.cantidad ELSE 0 END), 0) AS kg_cono,
            COUNT(DISTINCT pv.producto_id) AS hilos
       FROM pedido_detalle d
       JOIN pedidos p             ON p.id = d.pedido_id
       JOIN producto_variantes pv ON pv.id = d.variante_id
      WHERE p.cliente_id = :id AND p.estado NOT IN ('cancelado', 'devuelto')
        AND p.creado_en >= NOW() - INTERVAL 90 DAY${fp.sql}`,
    { id: clienteId, ...fp.params }
  );
  // Contra qué se compara su compra promedio: la de TODOS los clientes
  // identificados en el mismo periodo (el "Por compra" de Cuánto gasta).
  const [[tienda]] = await pool.query(
    `SELECT COUNT(*) AS compras, COALESCE(SUM(total), 0) AS total FROM pedidos
      WHERE cliente_id IS NOT NULL AND estado NOT IN ('cancelado', 'devuelto')
        AND creado_en >= NOW() - INTERVAL 90 DAY${f.sql}`,
    f.params
  );
  const [porMes] = await pool.query(
    `SELECT DATE_FORMAT(creado_en, '%Y-%m') AS mes, COUNT(*) AS compras, SUM(total) AS total
       FROM pedidos
      WHERE cliente_id = :id AND ${vivo}
        AND creado_en >= DATE_FORMAT(CURDATE() - INTERVAL 5 MONTH, '%Y-%m-01')
      GROUP BY mes ORDER BY mes`,
    { id: clienteId, ...f.params }
  );
  const n = Number(v.dias_con_compra ?? 0);
  const ritmo = n > 1 && Number(v.lapso) > 0 ? Math.max(1, Math.round(Number(v.lapso) / (n - 1))) : null;
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const dia = porDia.sort((a, b) => Number(b.n) - Number(a.n))[0];
  return {
    ritmo,
    primera: v.primera,
    ultima: v.ultima,
    dias_sin_venir: v.dias_sin_venir == null ? null : Number(v.dias_sin_venir),
    veces_su_ritmo: ritmo && v.dias_sin_venir != null ? Math.round((Number(v.dias_sin_venir) / ritmo) * 10) / 10 : null,
    dia_de_costumbre: dia ? DIAS[Number(dia.dow) - 1] : null,
    hora_de_costumbre: porHora[0] ? Number(porHora[0].hora) : null,
    visitas_90: visitas.map((x) => ({ dia: x.dia, hace: Number(x.hace) })),
    por_dia_semana: DIAS.map((d, i) => ({ dia: d, n: Number(porDia.find((x) => Number(x.dow) === i + 1)?.n ?? 0) })),
    por_mes: porMes.map((m) => ({ mes: m.mes, compras: Number(m.compras), total: Math.round(Number(m.total) * 100) / 100 })),
    por_hora: porHora
      .map((h) => ({ hora: Number(h.hora), n: Number(h.n) }))
      .sort((a, b) => a.hora - b.hora),
    ultimos_90: {
      compras: Number(p90.compras),
      total: Math.round(Number(p90.total) * 100) / 100,
      kg: Math.round(Number(k90.kg) * 1000) / 1000,
      kg_cono: Math.round(Number(k90.kg_cono) * 1000) / 1000,
      hilos: Number(k90.hilos),
    },
    anteriores_90: {
      compras: Number(p90.compras_antes),
      total: Math.round(Number(p90.total_antes) * 100) / 100,
    },
    ticket_tienda_90: Number(tienda.compras)
      ? Math.round((Number(tienda.total) / Number(tienda.compras)) * 100) / 100
      : null,
  };
}

/**
 * De qué tiendas es un abono a su cuenta: la de la nota a la que se abonó y la de
 * la caja donde se cobró (para "cada quien, sus tiendas"; 2026-10-26, auditoría).
 */
async function tiendasDelAbono(movId) {
  const [[m]] = await pool.query(
    `SELECT p.almacen_id AS de_nota, cj.almacen_id AS de_caja
       FROM credito_movimientos m
       LEFT JOIN pedidos p       ON p.id = m.pedido_id
       LEFT JOIN sesiones_caja s ON s.id = m.sesion_caja_id
       LEFT JOIN cajas cj        ON cj.id = s.caja_id
      WHERE m.id = :id`,
    { id: Number(movId) }
  );
  return m ?? null;
}

/** El turno de caja de un movimiento de su cuenta o de su saldo a favor (o null). */
async function turnoDelMovimiento(tabla, movId) {
  if (!['credito_movimientos', 'saldo_favor_movimientos'].includes(tabla)) {
    throw new Error(`turnoDelMovimiento: tabla no permitida (${tabla})`);
  }
  const [[m]] = await pool.query(`SELECT sesion_caja_id FROM ${tabla} WHERE id = :id`, { id: Number(movId) });
  return m?.sesion_caja_id ?? null;
}

module.exports = {
  tiendasDelAbono, turnoDelMovimiento,
  habitos,
  // Cuenta de la tienda en línea
  buscarPorCorreoConHash,
  buscarPorId,
  crear,
  // Expediente
  listar,
  obtener,
  buscarParaVenta, diasSinAbonar, atrasoDe, deudaMasVieja, diasDeLaMasVieja, diasSinAbonarDeTodos,
  vencimientoDe, notaVencimiento, sumarDias, plazoPorOmision, porCobrarHasta, finDeMes,
  crearDesdeStaff,
  actualizar,
  fijarLimiteCredito,
  duplicado,
  // Historial
  estadisticas,
  coloresMasComprados,
  pedidos,
  // Crédito
  saldo,
  movimientosCredito,
  agregarMovimiento,
  registrarAbono,
  cargarVentaACredito,
  ajustarCreditoPorPedido,
  ajusteDeCancelacion,
  notasPorPagar,
  foliosVisibles,
  liquidarVentasACredito,
  aplicarAbonos,
  rastrearPagos, movimientosConOrigen, libreSiSeCancela,
  repartirAbonos,
  SIGNO_CREDITO,
};
