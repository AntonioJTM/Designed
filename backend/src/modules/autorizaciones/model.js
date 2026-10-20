'use strict';

const crypto = require('crypto');
const { pool, withTransaction } = require('../../config/db');
const { AppError } = require('../../middlewares/error');

// Las SOLICITUDES de autorización (2026-10-19). Cada una guarda la petición tal
// cual (método, ruta y cuerpo ya validados) para hacerla al aceptarla, con lo
// que se pidió en palabras y de qué tiendas es.
//
//   pendiente → aprobando → aprobada      (se hizo)
//             ↘ rechazada                 (con su motivo)
//             ↘ cancelada                 (la retiró quien la pidió, o ya no la puede pedir)
//             ↘ vencida                   (lo de la caja que no se aceptó el mismo día)
//   aprobando (interrumpida) → cerrada    (no se sabe si se hizo; alguien la cerró)
// "aprobando" es el momento en que el sistema la está haciendo: si no se pudo,
// regresa a pendiente con el porqué (`ultimo_error`). Una que se quedó así más
// de 5 minutos (el servidor se reinició a media aprobación) NO se reabre sola:
// pudo haberse hecho. Se ve como "interrumpida" y solo se cierra ('cerrada', sin
// borrar quién la estaba autorizando); si no se hizo, se vuelve a pedir. Así nada
// se hace dos veces.

const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

const SELECT = `
  SELECT a.id, a.operacion, a.estado, a.resumen, a.almacenes,
         a.solicitante_id, us.nombre AS solicitante,
         DATE_FORMAT(a.solicitado_en, '%Y-%m-%d %H:%i:%s') AS solicitado_en,
         a.autorizador_id, ua.nombre AS autorizador, a.en_el_momento,
         DATE_FORMAT(a.resuelto_en, '%Y-%m-%d %H:%i:%s') AS resuelto_en,
         a.motivo, a.ultimo_error, a.nota_aprobacion, a.aviso,
         (a.estado = 'aprobando' AND a.aprobando_en < NOW() - INTERVAL 5 MINUTE) AS interrumpida,
         (DATE(a.solicitado_en) < CURDATE()) AS de_otro_dia
    FROM autorizaciones a
    JOIN usuarios us      ON us.id = a.solicitante_id
    LEFT JOIN usuarios ua ON ua.id = a.autorizador_id`;

const listaAlmacenes = (texto) => (texto ? String(texto).split(',').map(Number).filter(Boolean) : null);
const deFila = (r) => (r ? {
  ...r,
  en_el_momento: Boolean(Number(r.en_el_momento)),
  interrumpida: Boolean(Number(r.interrumpida)),
  de_otro_dia: Boolean(Number(r.de_otro_dia)),
  almacenes: listaAlmacenes(r.almacenes),
} : null);
const textoAlmacenes = (lista) => (lista && lista.length ? lista.join(',') : null);

async function obtener(id, ejecutor = pool) {
  const [[r]] = await ejecutor.query(`${SELECT} WHERE a.id = :id`, { id: Number(id) });
  return deFila(r);
}

/** Lo que se necesita para hacerla (no va a la pantalla: lleva el cuerpo y el contexto). */
async function paraHacer(id) {
  const [[r]] = await pool.query(
    'SELECT id, operacion, estado, metodo, ruta, cuerpo, contexto, solicitante_id FROM autorizaciones WHERE id = :id',
    { id: Number(id) }
  );
  return r ?? null;
}

/**
 * Guarda la solicitud. Si quien pide ya tiene una PENDIENTE idéntica (el mismo
 * retiro pedido dos veces), devuelve esa: aceptar las dos serían dos retiros.
 */
async function crear({ operacion, metodo, ruta, cuerpo, resumen, almacenes, contexto, solicitanteId }) {
  // Solo la de hace un momento (el doble clic): dos retiros iguales pedidos a
  // distintas horas son dos retiros.
  const [[igual]] = await pool.query(
    `SELECT id FROM autorizaciones
      WHERE estado = 'pendiente' AND solicitante_id = :yo AND metodo = :metodo AND ruta = :ruta AND cuerpo = :cuerpo
        AND solicitado_en > NOW() - INTERVAL 2 MINUTE
      LIMIT 1`,
    { yo: solicitanteId, metodo, ruta, cuerpo }
  );
  if (igual) return obtener(igual.id);
  const [r] = await pool.query(
    `INSERT INTO autorizaciones (operacion, metodo, ruta, cuerpo, resumen, almacenes, contexto, solicitante_id)
     VALUES (:operacion, :metodo, :ruta, :cuerpo, :resumen, :almacenes, :contexto, :solicitante)`,
    {
      operacion, metodo, ruta, cuerpo, resumen,
      almacenes: textoAlmacenes(almacenes),
      contexto: contexto ? JSON.stringify(contexto) : null,
      solicitante: solicitanteId,
    }
  );
  return obtener(r.insertId);
}

/**
 * AUTORIZADA CON SU CLAVE, en la pantalla de quien pidió: queda anotada ANTES de
 * hacerse ("aprobando", en el momento), así nunca se hace sin rastro.
 */
async function crearEnElMomento({ operacion, metodo, ruta, cuerpo = null, resumen, almacenes, solicitanteId, autorizadorId }) {
  const [r] = await pool.query(
    `INSERT INTO autorizaciones (operacion, estado, metodo, ruta, cuerpo, resumen, almacenes, solicitante_id,
                                 autorizador_id, en_el_momento, aprobando_en)
     VALUES (:operacion, 'aprobando', :metodo, :ruta, :cuerpo, :resumen, :almacenes, :solicitante, :autorizador, 1, NOW())`,
    {
      operacion, metodo, ruta, cuerpo, resumen, almacenes: textoAlmacenes(almacenes),
      solicitante: solicitanteId, autorizador: autorizadorId,
    }
  );
  return r.insertId;
}

/** Terminó la petición autorizada en el momento: se hizo (aprobada) o no se hizo (se borra: no pasó nada). */
async function cerrarEnElMomento(id, hecha) {
  if (hecha) {
    await pool.query(
      "UPDATE autorizaciones SET estado = 'aprobada', resuelto_en = NOW() WHERE id = :id AND estado = 'aprobando'",
      { id }
    );
  } else {
    await pool.query("DELETE FROM autorizaciones WHERE id = :id AND estado = 'aprobando' AND en_el_momento = 1", { id });
  }
}

/**
 * La toma para hacerla: con la fila bloqueada, solo si sigue PENDIENTE (dos que
 * aceptan a la vez: la segunda recibe 409). Devuelve la llave de un solo uso con
 * que el sistema la hace (se guarda solo su sha256).
 */
async function tomarParaAprobar(id, autorizadorId) {
  return withTransaction(async (conn) => {
    const [[r]] = await conn.query('SELECT estado FROM autorizaciones WHERE id = :id FOR UPDATE', { id: Number(id) });
    if (!r) throw new AppError(404, 'NO_ENCONTRADA', 'Esa solicitud no existe.');
    if (r.estado !== 'pendiente') {
      throw new AppError(409, 'YA_RESUELTA',
        r.estado === 'aprobando' ? 'Esa solicitud se está haciendo (o se interrumpió): revisa si ya se hizo.' : 'Esa solicitud ya se resolvió.');
    }
    const llave = crypto.randomBytes(24).toString('hex');
    await conn.query(
      `UPDATE autorizaciones SET estado = 'aprobando', autorizador_id = :autorizador, aprobando_en = NOW(),
              secreto = :secreto, ultimo_error = NULL
        WHERE id = :id`,
      { id: Number(id), autorizador: autorizadorId, secreto: sha256(llave) }
    );
    return llave;
  });
}

/**
 * ¿Es la petición que el sistema está haciendo al aceptar esta solicitud? La
 * llave es de ESA solicitud, de esa ruta, de quien la pidió, y se GASTA al usarla
 * (un solo UPDATE): no sirve dos veces.
 */
async function consumirLlave(cabecera, { metodo, ruta, solicitanteId }) {
  const [id, llave] = String(cabecera).split('.');
  const [r] = await pool.query(
    `UPDATE autorizaciones SET secreto = NULL
      WHERE id = :id AND estado = 'aprobando' AND secreto = :secreto
        AND metodo = :metodo AND ruta = :ruta AND solicitante_id = :yo`,
    { id: Number(id) || 0, secreto: sha256(llave ?? ''), metodo, ruta, yo: solicitanteId }
  );
  if (!r.affectedRows) throw new AppError(403, 'AUTORIZACION_INVALIDA', 'Esa autorización no vale para esta operación.');
  return Number(id);
}

async function marcarAprobada(id, resultado, nota = null) {
  await pool.query(
    `UPDATE autorizaciones SET estado = 'aprobada', resuelto_en = NOW(), secreto = NULL, ultimo_error = NULL,
            resultado = :resultado, nota_aprobacion = :nota
      WHERE id = :id AND estado = 'aprobando'`,
    { id: Number(id), resultado, nota: nota ? String(nota).slice(0, 500) : null }
  );
}

/** Lo que se le avisó a quien la pidió (el WhatsApp de sus vacaciones). */
async function anotarAviso(id, aviso) {
  await pool.query('UPDATE autorizaciones SET aviso = :aviso WHERE id = :id', { id: Number(id), aviso: String(aviso).slice(0, 255) });
}

/** La solicitud que espera para una ruta (la de pagar una nómina), o null. */
async function esperandoDe(operacion, ruta) {
  const [[r]] = await pool.query(
    `SELECT a.id, us.nombre AS solicitante, DATE_FORMAT(a.solicitado_en, '%Y-%m-%d %H:%i:%s') AS solicitado_en
       FROM autorizaciones a JOIN usuarios us ON us.id = a.solicitante_id
      WHERE a.operacion = :operacion AND a.ruta = :ruta AND a.estado IN ('pendiente', 'aprobando')
      ORDER BY a.id DESC LIMIT 1`,
    { operacion, ruta }
  );
  return r ?? null;
}

/**
 * Las de una operación para su propia pantalla (los pedidos a otra tienda en
 * Surtir sucursal): las que esperan y las resueltas de los últimos `dias`. Con
 * su cuerpo y lo que contestó (de ahí sale el traspaso que se creó); no van tal
 * cual a la pantalla.
 */
async function deOperacion(operacion, dias = 30) {
  const [rows] = await pool.query(
    `${SELECT.replace('a.motivo, a.ultimo_error,', 'a.motivo, a.ultimo_error, a.cuerpo, a.resultado,')}
      WHERE a.operacion = :operacion
        AND (a.estado IN ('pendiente', 'aprobando') OR a.solicitado_en >= NOW() - INTERVAL :dias DAY)
      ORDER BY a.solicitado_en DESC, a.id DESC LIMIT 200`,
    { operacion, dias }
  );
  return rows.map(deFila);
}

/** Sus solicitudes de vacaciones, las más nuevas primero (para "Mis vacaciones"). */
async function vacacionesPedidas(usuarioId, limite = 20) {
  const [rows] = await pool.query(
    `SELECT a.id, a.estado, a.cuerpo, a.motivo, a.aviso,
            DATE_FORMAT(a.solicitado_en, '%Y-%m-%d %H:%i:%s') AS solicitado_en,
            DATE_FORMAT(a.resuelto_en, '%Y-%m-%d %H:%i:%s') AS resuelto_en, ua.nombre AS autorizador
       FROM autorizaciones a LEFT JOIN usuarios ua ON ua.id = a.autorizador_id
      WHERE a.operacion = 'vacaciones' AND a.solicitante_id = :yo
      ORDER BY a.solicitado_en DESC, a.id DESC LIMIT :limite`,
    { yo: usuarioId, limite }
  );
  return rows.map(({ cuerpo, ...r }) => {
    const c = JSON.parse(cuerpo ?? '{}');
    return { ...r, fecha_inicio: c.fecha_inicio, fecha_fin: c.fecha_fin, notas: c.notas ?? null };
  });
}

/** No se pudo hacer: sigue pendiente y dice por qué (se puede volver a aceptar o rechazar). */
async function regresarAPendiente(id, error) {
  await pool.query(
    `UPDATE autorizaciones SET estado = 'pendiente', autorizador_id = NULL, aprobando_en = NULL, secreto = NULL,
            ultimo_error = :error
      WHERE id = :id AND estado = 'aprobando'`,
    { id: Number(id), error: String(error ?? '').slice(0, 500) }
  );
}

/** Al aceptarla ya no se puede (el saldo cambió): sigue pendiente con el porqué. */
async function anotarError(id, error) {
  await pool.query(
    "UPDATE autorizaciones SET ultimo_error = :error WHERE id = :id AND estado = 'pendiente'",
    { id: Number(id), error: String(error ?? '').slice(0, 500) }
  );
}

/** Rechazar una pendiente, con su motivo. */
async function rechazar(id, autorizadorId, motivo) {
  const [r] = await pool.query(
    `UPDATE autorizaciones SET estado = 'rechazada', autorizador_id = :autorizador, resuelto_en = NOW(), motivo = :motivo,
            secreto = NULL
      WHERE id = :id AND estado = 'pendiente'`,
    { id: Number(id), autorizador: autorizadorId, motivo }
  );
  if (!r.affectedRows) throw new AppError(409, 'YA_RESUELTA', 'Esa solicitud ya se resolvió.');
}

/**
 * Cerrar una que se interrumpió a media aprobación: no se sabe si se hizo, así
 * que no es un rechazo ('cerrada'). Se queda quien la estaba autorizando; quien
 * la cerró va en el motivo.
 */
async function cerrarInterrumpida(id, motivo) {
  const [r] = await pool.query(
    `UPDATE autorizaciones SET estado = 'cerrada', resuelto_en = NOW(), motivo = :motivo, secreto = NULL
      WHERE id = :id AND estado = 'aprobando' AND aprobando_en < NOW() - INTERVAL 5 MINUTE`,
    { id: Number(id), motivo: String(motivo).slice(0, 255) }
  );
  if (!r.affectedRows) throw new AppError(409, 'YA_RESUELTA', 'Esa solicitud ya se resolvió o todavía se está haciendo.');
}

/** Pedirla otra vez reemplaza la que esperaba (pagar una nómina): la anterior se cierra con el porqué. */
async function reemplazarPendientes(operacion, ruta) {
  await pool.query(
    `UPDATE autorizaciones SET estado = 'cancelada', resuelto_en = NOW(), motivo = 'Se volvió a pedir.'
      WHERE operacion = :operacion AND ruta = :ruta AND estado = 'pendiente'`,
    { operacion, ruta }
  );
}

/** Lo que ya no tiene caso esperar (la nómina se pagó o se canceló por otro lado): se cierra con el porqué. */
async function cerrarPendientesDeRuta(operacion, ruta, motivo) {
  await pool.query(
    `UPDATE autorizaciones SET estado = 'cancelada', resuelto_en = NOW(), motivo = :motivo
      WHERE operacion = :operacion AND ruta = :ruta AND estado = 'pendiente'`,
    { operacion, ruta, motivo: String(motivo).slice(0, 255) }
  );
}

/** El contexto que se guardó al pedirla (lo que se revisa al hacerla). */
async function contextoDe(id) {
  const [[r]] = await pool.query('SELECT contexto FROM autorizaciones WHERE id = :id', { id: Number(id) });
  return r?.contexto ? JSON.parse(r.contexto) : null;
}

/** Al aceptarla ya había cambiado (la nómina): se cierra sola, con el porqué, para que se vuelva a pedir. */
async function cerrarPorCambio(id, porque) {
  await pool.query(
    `UPDATE autorizaciones SET estado = 'cancelada', resuelto_en = NOW(), motivo = :motivo, ultimo_error = :motivo
      WHERE id = :id AND estado = 'pendiente'`,
    { id: Number(id), motivo: String(porque).slice(0, 255) }
  );
}

/** Quien la pidió ya no la puede pedir (lo dieron de baja, le quitaron el permiso o la tienda). */
async function cerrarSinQuienPidio(id) {
  await pool.query(
    `UPDATE autorizaciones SET estado = 'cancelada', resuelto_en = NOW(),
            motivo = 'Quien lo pidió ya no lo puede pedir (le cambiaron el puesto o la tienda, o ya no trabaja aquí).'
      WHERE id = :id AND estado = 'pendiente'`,
    { id: Number(id) }
  );
}

/** Al hacerla no contestó (se cortó la conexión): se queda "aprobando" —pudo hacerse— con el porqué. */
async function anotarErrorAprobando(id, error) {
  await pool.query(
    "UPDATE autorizaciones SET ultimo_error = :error WHERE id = :id AND estado = 'aprobando'",
    { id: Number(id), error: String(error ?? '').slice(0, 500) }
  );
}

/** Quien la pidió la retira mientras siga pendiente. */
async function cancelar(id, solicitanteId) {
  const [r] = await pool.query(
    `UPDATE autorizaciones SET estado = 'cancelada', resuelto_en = NOW()
      WHERE id = :id AND solicitante_id = :yo AND estado = 'pendiente'`,
    { id: Number(id), yo: solicitanteId }
  );
  if (!r.affectedRows) throw new AppError(409, 'YA_RESUELTA', 'Esa solicitud ya no está pendiente o no es tuya.');
}

/** Lo de la caja que no se aceptó el mismo día. */
async function marcarVencida(id) {
  await pool.query(
    "UPDATE autorizaciones SET estado = 'vencida', resuelto_en = NOW() WHERE id = :id AND estado = 'pendiente'",
    { id: Number(id) }
  );
}

/** Las pendientes (también las que se están aceptando), de la más vieja a la más nueva. */
async function pendientes() {
  const [rows] = await pool.query(`${SELECT} WHERE a.estado IN ('pendiente', 'aprobando') ORDER BY a.solicitado_en, a.id`);
  return rows.map(deFila);
}

/** Las de una persona, de la más nueva a la más vieja. */
async function deSolicitante(solicitanteId, limite = 50) {
  const [rows] = await pool.query(
    `${SELECT} WHERE a.solicitante_id = :yo ORDER BY a.solicitado_en DESC, a.id DESC LIMIT :limite`,
    { yo: solicitanteId, limite }
  );
  return rows.map(deFila);
}

/** Las ya resueltas, de la más nueva a la más vieja (se filtran después por quién las puede ver). */
async function resueltas(limite = 300) {
  const [rows] = await pool.query(
    `${SELECT} WHERE a.estado IN ('aprobada', 'rechazada', 'cancelada', 'vencida', 'cerrada')
      ORDER BY a.resuelto_en DESC, a.id DESC LIMIT :limite`,
    { limite }
  );
  return rows.map(deFila);
}

/** Los nombres de unas tiendas, para decir de dónde es cada solicitud. */
async function nombresDeAlmacenes() {
  const [rows] = await pool.query('SELECT id, nombre FROM almacenes');
  return new Map(rows.map((r) => [Number(r.id), r.nombre]));
}

module.exports = {
  obtener, paraHacer, crear, crearEnElMomento, cerrarEnElMomento, tomarParaAprobar, consumirLlave,
  marcarAprobada, anotarAviso, vacacionesPedidas, deOperacion, esperandoDe, reemplazarPendientes, cerrarPorCambio, cerrarPendientesDeRuta, contextoDe, regresarAPendiente, anotarError, anotarErrorAprobando, rechazar, cerrarInterrumpida,
  cerrarSinQuienPidio, cancelar, marcarVencida,
  pendientes, deSolicitante, resueltas, nombresDeAlmacenes,
};
