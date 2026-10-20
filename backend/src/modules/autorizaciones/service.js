'use strict';

const env = require('../../config/env');
const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const { firmarToken } = require('../../utils/jwt');
const { puede, almacenesDe, esAdmin } = require('../permisos/service');
const { avisar } = require('../tiempo-real/bus');
const { OPERACIONES } = require('./operaciones');
const model = require('./model');

/**
 * ¿Esta persona autoriza esta solicitud? Hace la operación directo y comparte
 * alguna tienda con ella (las de la operación o, si no es de una tienda, las de
 * quien la pidió; vacío = de todas). Quien ve todas, cualquiera.
 */
async function puedeAutorizar(auth, fila) {
  const op = OPERACIONES[fila.operacion];
  if (!op || !(await puede(auth, op.permiso))) return false;
  if (op.autorizaSoloSi && !(await op.autorizaSoloSi(auth))) return false;
  // Lo suyo (sus vacaciones) no se lo autoriza nadie a sí mismo, salvo el administrador.
  if (op.noASiMismo && Number(fila.solicitante_id) === Number(auth.sub) && !(await esAdmin(auth))) return false;
  const mias = await almacenesDe(auth);
  // Un pedido a otra tienda lo autoriza quien ve el almacén que SURTE.
  if (op.tiendasQueAutorizan) {
    if (mias === null) return true;
    const p = await model.paraHacer(fila.id);
    const deciden = op.tiendasQueAutorizan(JSON.parse(p?.cuerpo ?? '{}'));
    return deciden.every((a) => mias.includes(Number(a)));
  }
  return mias === null || !fila.almacenes || fila.almacenes.some((a) => mias.includes(Number(a)));
}

/** Quien la pidió o quien la autoriza la puede ver. */
async function puedeVer(auth, fila) {
  return Number(fila.solicitante_id) === Number(auth.sub) || (await puedeAutorizar(auth, fila));
}

/** Lo de la caja y el mostrador que no se aceptó el mismo día: vence. */
const vencio = (fila) => fila.estado === 'pendiente' && fila.de_otro_dia && OPERACIONES[fila.operacion]?.vence === 'dia';

async function conNombres(filas) {
  const tiendas = await model.nombresDeAlmacenes();
  return filas.map((f) => ({
    ...f,
    operacion_nombre: OPERACIONES[f.operacion]?.nombre ?? f.operacion,
    tiendas: (f.almacenes ?? []).map((a) => tiendas.get(Number(a))).filter(Boolean),
    // Se puede autorizar MENOS de lo pedido (un pedido a otra tienda).
    ajustable: Boolean(OPERACIONES[f.operacion]?.ajustar),
  }));
}

/**
 * ¿Quien la pidió TODAVÍA la puede pedir? Activo, con el permiso (de pedirla o de
 * hacerla) y, si es de una tienda, que siga siendo suya. Si no, al aceptarla la
 * repetición le daría 403/404 y se quedaría pendiente para siempre.
 */
async function quienPidioPuede(fila) {
  const op = OPERACIONES[fila.operacion];
  if (!op) return false;
  const quien = { sub: Number(fila.solicitante_id), tipo: 'usuario' };
  if (!(await puede(quien, op.pedir)) && !(await puede(quien, op.permiso))) return false;
  if (op.conTienda && fila.almacenes) {
    const suyas = await almacenesDe(quien);
    const ajenas = suyas === null ? [] : fila.almacenes.filter((a) => !suyas.includes(Number(a)));
    // De dos tiendas (un pedido a otra): basta con que siga siendo de una.
    if (op.conTienda === 'alguna' ? ajenas.length === fila.almacenes.length : ajenas.length) return false;
  }
  return true;
}

/**
 * Los renglones que quien autoriza puede ajustar (un pedido a otra tienda), con
 * lo que hay en el origen solo si esa persona ve ese almacén.
 */
async function conDetalle(auth, filas) {
  const mias = await almacenesDe(auth);
  const veAlmacen = (id) => mias === null || mias.includes(Number(id));
  for (const f of filas) {
    const op = OPERACIONES[f.operacion];
    if (!op?.detalle || f.estado !== 'pendiente') continue;
    const p = await model.paraHacer(f.id);
    try {
      f.detalle = await op.detalle(JSON.parse(p?.cuerpo ?? '{}'), { veAlmacen, ruta: p?.ruta });
    } catch {
      f.detalle = null;
    }
  }
  return filas;
}

/** Las pendientes que ya no valen se cierran solas: las que vencieron y las de quien ya no las puede pedir. */
async function vigentes(filas) {
  const vivas = [];
  for (const f of filas) {
    if (f.estado !== 'pendiente') vivas.push(f);
    else if (vencio(f)) await model.marcarVencida(f.id);
    else if (!(await quienPidioPuede(f))) await model.cerrarSinQuienPidio(f.id);
    else vivas.push(f);
  }
  return vivas;
}

/**
 * Las listas de la pantalla: `por_autorizar` (las pendientes que esta persona
 * puede aceptar, y las que se interrumpieron a media aprobación), `mias` (las que
 * pidió) e `historial` (las resueltas que pidió o que podía autorizar). Con
 * cuántas esperan su autorización.
 */
async function listar(auth, vista = 'por_autorizar') {
  const pendientes = [];
  for (const f of await vigentes(await model.pendientes())) if (await puedeAutorizar(auth, f)) pendientes.push(f);
  let filas;
  if (vista === 'mias') filas = await model.deSolicitante(auth.sub);
  else if (vista === 'historial') {
    filas = [];
    for (const f of await model.resueltas()) if (await puedeVer(auth, f)) filas.push(f);
    filas = filas.slice(0, 100);
  } else filas = pendientes;
  if (vista === 'por_autorizar') await conDetalle(auth, filas);
  return {
    vista,
    por_autorizar: pendientes.filter((f) => f.estado === 'pendiente').length,
    filas: await conNombres(filas),
  };
}

/** Cuántas esperan su autorización (la campana): las mismas que cuenta la pantalla. */
async function cuantasPorAutorizar(auth) {
  let n = 0;
  for (const f of await vigentes(await model.pendientes())) {
    if (f.estado === 'pendiente' && (await puedeAutorizar(auth, f))) n++;
  }
  return n;
}

/**
 * ACEPTAR: revisa que siga valiendo (no venció; el saldo de un ajuste no cambió),
 * la toma (nadie más la acepta a la vez) y la HACE en ese momento, repitiendo la
 * petición que se pidió como la persona que la pidió, con una llave de un solo
 * uso (`X-Autorizacion`). Pasa por todo lo de siempre —validación, tiendas,
 * existencias, caja—: si ya no se puede, sigue pendiente y dice por qué.
 */
async function aprobar(id, auth, { ajustes = null } = {}) {
  const fila = await model.obtener(id);
  if (!fila || !(await puedeVer(auth, fila))) throw new AppError(404, 'NO_ENCONTRADA', 'Esa solicitud no existe.');
  if (!(await puedeAutorizar(auth, fila))) {
    throw new AppError(403, 'SIN_PERMISO', 'Tu puesto no puede autorizar esta operación.');
  }
  if (vencio(fila)) {
    await model.marcarVencida(id);
    throw new AppError(409, 'VENCIDA', 'Venció: se pidió otro día y lo de la caja se autoriza el mismo día. Que se vuelva a pedir.');
  }
  if (fila.estado === 'pendiente' && !(await quienPidioPuede(fila))) {
    await model.cerrarSinQuienPidio(id);
    throw new AppError(409, 'YA_NO_LO_PUEDE_PEDIR',
      `${fila.solicitante} ya no puede pedir esto (le cambiaron el puesto o la tienda, o ya no trabaja aquí): se cerró sin hacerse.`);
  }
  const op = OPERACIONES[fila.operacion];
  const peticion = await model.paraHacer(id);
  if (op.revisarAntes && peticion.estado === 'pendiente') {
    const porque = await op.revisarAntes(JSON.parse(peticion.cuerpo ?? '{}'), JSON.parse(peticion.contexto ?? 'null'));
    if (porque) {
      if (op.cerrarSiCambio) {
        await model.cerrarPorCambio(id, porque);
        throw new AppError(409, 'CAMBIO_DESDE_QUE_SE_PIDIO', `No se hizo: ${porque} Esta solicitud se cerró.`);
      }
      await model.anotarError(id, porque);
      throw new AppError(409, 'NO_SE_PUDO_HACER', `No se puede hacer: ${porque}`);
    }
  }
  // Autorizar MENOS de lo pedido: se hace con lo autorizado; lo pedido se queda
  // en la solicitud y la nota dice qué cambió.
  let cuerpoAHacer = peticion.cuerpo ?? '{}';
  let nota = null;
  if (ajustes != null) {
    if (!op.ajustar) throw new AppError(422, 'NO_SE_AJUSTA', 'Esta solicitud se acepta o se rechaza completa.');
    const r = await op.ajustar(JSON.parse(peticion.cuerpo ?? '{}'), ajustes);
    cuerpoAHacer = JSON.stringify(r.cuerpo);
    nota = r.nota;
  }
  const llave = await model.tomarParaAprobar(id, auth.sub);
  const [[quien]] = await pool.query(
    'SELECT u.id, u.rol_id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = :id',
    { id: peticion.solicitante_id }
  );
  let status = 0;
  let cuerpo = null;
  try {
    const r = await fetch(`http://127.0.0.1:${env.port}/api/v1${peticion.ruta}`, {
      method: peticion.metodo,
      headers: {
        Authorization: `Bearer ${firmarToken({ sub: quien?.id ?? peticion.solicitante_id, tipo: 'usuario', rol_id: quien?.rol_id, rol: quien?.rol })}`,
        'Content-Type': 'application/json',
        'X-Autorizacion': `${id}.${llave}`,
      },
      body: ['GET', 'HEAD'].includes(peticion.metodo) ? undefined : cuerpoAHacer,
    });
    status = r.status;
    cuerpo = await r.json().catch(() => null);
  } catch (e) {
    cuerpo = { error: { message: e.message } };
  }
  if (!status) {
    // No contestó: la llave ya se pudo haber gastado y la operación pudo hacerse.
    // Se queda "aprobando" (a los 5 minutos se ve como interrumpida, para revisarla).
    await model.anotarErrorAprobando(id, `No contestó al hacerla: ${cuerpo?.error?.message ?? ''}`);
    throw new AppError(409, 'NO_SE_SABE',
      'No se pudo confirmar si se hizo (se cortó la conexión). Revisa en unos minutos: si no se hizo, ciérrala y que se vuelva a pedir.');
  }
  if (status >= 200 && status < 300) {
    await model.marcarAprobada(id, op.sinResultado ? null : JSON.stringify(cuerpo?.data ?? null).slice(0, 60000), nota);
    alResolver(id, 'aprobada');
    return (await conNombres([await model.obtener(id)]))[0];
  }
  const mensaje = cuerpo?.error?.message ?? `respondió ${status}`;
  await model.regresarAPendiente(id, mensaje);
  throw new AppError(409, 'NO_SE_PUDO_HACER', `No se pudo hacer: ${mensaje} La solicitud sigue pendiente.`);
}

async function rechazar(id, auth, motivo) {
  const fila = await model.obtener(id);
  if (!fila || !(await puedeVer(auth, fila))) throw new AppError(404, 'NO_ENCONTRADA', 'Esa solicitud no existe.');
  if (!(await puedeAutorizar(auth, fila))) {
    throw new AppError(403, 'SIN_PERMISO', 'Tu puesto no puede autorizar esta operación.');
  }
  if (fila.interrumpida) {
    // No se sabe si se hizo: se CIERRA (no se rechaza) y queda quién la cerró.
    const [[yo]] = await pool.query('SELECT nombre FROM usuarios WHERE id = :id', { id: auth.sub });
    await model.cerrarInterrumpida(id, `La cerró ${yo?.nombre ?? 'alguien'}: ${motivo}`);
    return (await conNombres([await model.obtener(id)]))[0];
  }
  await model.rechazar(id, auth.sub, motivo);
  alResolver(id, 'rechazada', motivo);
  return (await conNombres([await model.obtener(id)]))[0];
}

/**
 * LOS PEDIDOS A OTRA TIENDA EN SURTIR SUCURSAL (2026-10-20: "que salgan las
 * solicitudes y cuál ya está aprobada y cuál está por aprobar o rechazar"). Los
 * de SUS tiendas (las del origen o del destino): los que esperan y los resueltos
 * de los últimos 30 días, cada uno con qué se pidió, en qué quedó y, si se
 * autorizó, el traspaso que nació y en qué va. Solo lo pedido: nada de cuánto
 * hay en el origen (pedir a ciegas).
 */
async function pedidosASucursal(auth, { dias = 30 } = {}) {
  const { lineasPedido, nombreAlmacen } = require('./operaciones');
  const mias = await almacenesDe(auth);
  const filas = (await model.deOperacion('surtir_sucursal', dias))
    .filter((f) => mias === null || !f.almacenes || f.almacenes.some((a) => mias.includes(Number(a))));
  const vivas = new Set((await vigentes(filas.filter((f) => f.estado === 'pendiente'))).map((f) => f.id));
  const lista = [];
  for (const f of filas) {
    if (f.estado === 'pendiente' && !vivas.has(f.id)) continue; // se acaba de cerrar sola
    let cuerpo = {};
    try { cuerpo = JSON.parse(f.cuerpo ?? '{}'); } catch { /* vacío */ }
    let traspaso = null;
    if (f.estado === 'aprobada') {
      let creado = null;
      try { creado = JSON.parse(f.resultado ?? 'null'); } catch { /* sin resultado */ }
      if (creado?.id) {
        const [[t]] = await pool.query('SELECT id, folio, estado FROM traspasos WHERE id = :id', { id: Number(creado.id) });
        traspaso = t ?? null;
      }
    }
    lista.push({
      id: f.id,
      estado: f.estado,
      interrumpida: f.interrumpida,
      origen: await nombreAlmacen(cuerpo.almacen_origen_id),
      destino: await nombreAlmacen(cuerpo.almacen_destino_id),
      lineas: (await lineasPedido(cuerpo.items)).map(({ hilo, unidad, pedido }) => ({ hilo, unidad, pedido })),
      notas: cuerpo.notas ?? null,
      solicitante: f.solicitante,
      solicitado_en: f.solicitado_en,
      autorizador: f.autorizador,
      resuelto_en: f.resuelto_en,
      motivo: f.motivo,
      nota_aprobacion: f.nota_aprobacion,
      ultimo_error: f.estado === 'pendiente' ? f.ultimo_error : null,
      traspaso,
      es_mia: Number(f.solicitante_id) === Number(auth.sub),
      puedo_autorizar: f.estado === 'pendiente' && (await puedeAutorizar(auth, f)),
    });
  }
  return lista;
}

/**
 * Lo que sigue al aceptarla o rechazarla (el WhatsApp de las vacaciones). Corre
 * DESPUÉS de contestar —mandar un WhatsApp tarda— y deja dicho qué se avisó;
 * las pantallas abiertas se ponen al día solas.
 */
function alResolver(id, estado, motivo = null) {
  return (async () => {
    const fila = await model.obtener(id);
    const op = fila && OPERACIONES[fila.operacion];
    if (!op?.alResolver) return;
    const aviso = await op.alResolver(fila, { estado, motivo });
    if (aviso) {
      await model.anotarAviso(id, aviso);
      avisar(['autorizaciones']);
    }
  })().catch((e) => console.error(`[autorizaciones] lo de después de resolver la ${id} falló:`, e.message));
}

async function cancelar(id, auth) {
  await model.cancelar(id, auth.sub);
  return (await conNombres([await model.obtener(id)]))[0];
}

/**
 * Quiénes pueden autorizar esta operación en estas tiendas: activos, que entran
 * al sistema, que la hacen directo y comparten alguna tienda (`tiendas` null =
 * de todas). `con_clave`: ya pusieron su clave de autorización (solo ellos
 * autorizan en el momento). Solo su nombre.
 */
async function autorizadores(op, tiendas, { excluir = null } = {}) {
  const [us] = await pool.query(
    `SELECT u.id, u.nombre FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.activo = 1 AND r.entra_al_sistema = 1 ORDER BY u.nombre`
  );
  const lista = [];
  for (const u of us) {
    if (excluir != null && Number(u.id) === Number(excluir)) continue;
    const auth = { sub: u.id, tipo: 'usuario' };
    if (!(await puede(auth, op.permiso))) continue;
    if (op.autorizaSoloSi && !(await op.autorizaSoloSi(auth))) continue;
    const suyas = await almacenesDe(auth);
    if (suyas !== null && tiendas && tiendas.length && !tiendas.some((a) => suyas.includes(Number(a)))) continue;
    lista.push({ id: Number(u.id), nombre: u.nombre });
  }
  const { conClaveAutorizacion } = require('../usuarios/service');
  const conClave = await conClaveAutorizacion(lista.map((u) => u.id));
  return lista.map((u) => ({ ...u, con_clave: conClave.has(u.id) }));
}

// Claves equivocadas: por quien pide Y por la persona cuya clave se prueba.
// 5 seguidas en un minuto y hay que esperar. Cada fallo queda en la bitácora.
const intentos = new Map();
const LIMITE = 5;
const VENTANA = 60000;

function bloqueado(llave, ahora) {
  const p = intentos.get(llave);
  return p && p.fallos >= LIMITE && ahora - p.desde < VENTANA;
}
function fallo(llave, ahora) {
  const p = intentos.get(llave);
  if (p && ahora - p.desde < VENTANA) p.fallos += 1;
  else intentos.set(llave, { fallos: 1, desde: ahora });
}

/**
 * AUTORIZAR EN EL MOMENTO: quien autoriza escribe su CLAVE DE AUTORIZACIÓN (no
 * su contraseña de entrar) en la pantalla de quien pide. Cabecera `X-Autoriza` =
 * base64 de {"usuario_id": 3, "clave": "1234"}. Vale si esa persona puede
 * autorizar esto aquí, tiene su clave y es la correcta. La clave solo se revisa
 * si la persona puede autorizar (no se puede probar la de cualquiera).
 */
async function revisarClave(cabecera, op, { solicitanteId, tiendas }) {
  let datos = null;
  try {
    datos = JSON.parse(Buffer.from(String(cabecera), 'base64').toString('utf8'));
  } catch { /* abajo */ }
  const objetivo = Number(datos?.usuario_id) || 0;
  const ahora = Date.now();
  if (bloqueado(`s${solicitanteId}`, ahora) || bloqueado(`o${objetivo}`, ahora)) {
    throw new AppError(429, 'DEMASIADOS_INTENTOS', 'Demasiadas claves equivocadas: espera un minuto.');
  }
  const candidato = (await autorizadores(op, tiendas, { excluir: op.noASiMismo ? solicitanteId : null }))
    .find((u) => u.id === objetivo && u.con_clave);
  const { claveDe, LIMITE_CLAVE } = require('../usuarios/service');
  const u = candidato ? await claveDe(candidato.id, datos?.clave, { porId: solicitanteId }) : null;
  if (!u || u.equivocada) {
    fallo(`s${solicitanteId}`, ahora);
    fallo(`o${objetivo}`, ahora);
    console.warn(`[autorizaciones] clave equivocada: la pidió el usuario ${solicitanteId} con la de ${objetivo} (${op.clave})`);
    if (u?.apagada) {
      throw new AppError(403, 'AUTORIZACION_INVALIDA',
        `La clave no es correcta. Se escribió mal ${LIMITE_CLAVE} veces seguidas y se apagó: ${candidato.nombre} tiene que ` +
        'volver a ponerla en «Mi clave para autorizar». Mientras, pídela para que la acepte desde Autorizaciones.');
    }
    throw new AppError(403, 'AUTORIZACION_INVALIDA', 'La clave no es correcta o esa persona no puede autorizar esto.');
  }
  intentos.delete(`s${solicitanteId}`);
  intentos.delete(`o${objetivo}`);
  return u;
}

module.exports = {
  listar, cuantasPorAutorizar, aprobar, rechazar, cancelar, autorizadores, revisarClave, puedeAutorizar, alResolver,
  pedidosASucursal,
};
