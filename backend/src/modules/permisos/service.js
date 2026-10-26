'use strict';

const model = require('./model');
const { CATALOGO, CLAVES, soloConTodas, notaTiendas } = require('./catalogo');
const { AppError } = require('../../middlewares/error');

const ADMIN = 'administrador';

/**
 * ¿La tienda lleva el COSTO de lo que compra? SÍ, desde el 2026-10-06: "costo
 * por kilo, solo administrador y contabilidad" (al surtir inventario). Del
 * 2026-10-03 a esa fecha estuvo en false ("no necesito lo que me costó") y
 * entonces «Ver costos y márgenes» no lo tenía nadie, ni el administrador.
 *
 * Encendido, lo ve quien tenga `hacer:ver_costos`: el administrador (siempre) y
 * el puesto Contabilidad (migración 2026-10_carga_proveedor_costo, que se lo
 * quitó al gerente). Con false se vuelve a apagar todo lo del costo; su gemelo
 * del frontend es `core/costos.ts`.
 */
const SE_LLEVA_COSTO = true;
const VER_COSTOS = 'hacer:ver_costos';

/**
 * Los puestos de quien viene en el token: el principal y los demás (una persona
 * puede tener varios desde el 2026-10-06). Se leen de la BASE por su id, no del
 * token: así dar o quitar un puesto en Personal vale en el acto, y a quien se le
 * quita el acceso ("Sin acceso") ya no le pasa ninguna guarda aunque su token
 * siga vivo. El token solo dice QUIÉN es.
 */
async function puestosDe(auth) {
  if (!auth || auth.tipo !== 'usuario' || !auth.sub) return [];
  const { activo, puestos } = await model.puestosDeUsuario(auth.sub);
  // Un puesto que no entra al sistema (el cargador) no da nada, aunque alguien
  // le hubiera marcado permisos: a quien pasa a cargador se le acaba en el acto.
  return activo ? puestos.filter((p) => p.entra_al_sistema) : [];
}

/**
 * LAS TIENDAS DE CADA PERSONA (2026-10-15: "si abro una caja en Moroleón no
 * quiero que vea nada de la otra tienda ni del inventario; solo lo de su tienda
 * y su almacén"). Devuelve los ids de almacén que puede ver, o `null` si ve
 * TODAS (el administrador siempre; los demás si así lo dice Personal). Una
 * lista vacía es "ninguna": no ve nada de ninguna tienda.
 */
async function almacenesDe(auth) {
  if (!auth || auth.tipo !== 'usuario' || !auth.sub) return [];
  if (await esAdmin(auth)) return null;
  const { todas, ids } = await model.tiendasDeUsuario(auth.sub);
  return todas ? null : ids;
}

/** ¿Ve todas las tiendas? (Reportes, Cómo va el negocio, Nómina y las miradas de Clientes.) */
async function veTodasLasTiendas(auth) {
  return (await almacenesDe(auth)) === null;
}

/** ¿Puede ver ese almacén? `null` (todas) puede cualquiera. */
function puedeAlmacen(almacenes, almacenId) {
  return almacenes === null || almacenes.includes(Number(almacenId));
}

/**
 * Detiene lo que es de OTRA tienda: 404, como si no existiera (no se dice ni
 * que existe). Para el detalle de una venta, un turno, un traspaso…
 */
function exigirAlmacen(almacenes, almacenId, que = 'Eso') {
  if (!puedeAlmacen(almacenes, almacenId)) {
    throw new AppError(404, 'OTRA_TIENDA', `${que} es de otra tienda.`);
  }
}

/**
 * El turno de caja con que se cobra (una venta, un abono, un anticipo) tiene
 * que ser de una caja de SUS tiendas: 404 si no.
 */
async function exigirTurno(auth, sesionId) {
  if (!(Number(sesionId) > 0)) return;
  const almacenes = await almacenesDe(auth);
  if (almacenes === null) return;
  const almacenId = await model.almacenDeTurno(sesionId);
  if (almacenId != null) exigirAlmacen(almacenes, almacenId, 'Esa caja');
}

/**
 * El pedazo de SQL que deja solo sus tiendas: `AND col IN (…)`, o nada si ve
 * todas. Con la lista vacía no deja pasar nada. Los parámetros van con
 * nombre (`:almacenesAlcance`), como en el resto de los modelos.
 */
function filtroAlmacen(columna, almacenes) {
  if (almacenes === null || almacenes === undefined) return { sql: '', params: {} };
  if (!almacenes.length) return { sql: ' AND 1 = 0', params: {} };
  return { sql: ` AND ${columna} IN (:almacenesAlcance)`, params: { almacenesAlcance: almacenes } };
}

/** True si alguno de sus puestos es el de administrador: entonces lo puede todo. */
async function esAdmin(auth) {
  return (await puestosDe(auth)).some((p) => p.nombre === ADMIN);
}

/**
 * Las claves que tiene quien viene en el token: la SUMA de las de todos sus
 * puestos (todas, si alguno es el de administrador).
 */
async function clavesDe(auth) {
  const puestos = await puestosDe(auth);
  // Copia: los Set de cada puesto son los del caché y no se deben tocar.
  const claves = new Set();
  if (puestos.some((p) => p.nombre === ADMIN)) {
    for (const c of CLAVES) claves.add(c);
  } else {
    for (const p of puestos) for (const c of await model.clavesDeRol(p.id)) claves.add(c);
  }
  if (!SE_LLEVA_COSTO) claves.delete(VER_COSTOS);
  return claves;
}

async function puede(auth, clave) {
  // El costo no se lleva: nadie lo ve, tampoco el administrador.
  if (clave === VER_COSTOS && !SE_LLEVA_COSTO) return false;
  return (await clavesDe(auth)).has(clave);
}

/** Lo que dibuja la pantalla de Permisos. */
async function matriz() {
  const [roles, asignados, registradas, sinTodas] = await Promise.all([
    model.roles(), model.asignados(), model.clavesRegistradas(), model.personasSinTodas(),
  ]);
  // Sin costo, «Ver costos» no hace nada: no se ofrece en la pantalla.
  const visible = (c) => SE_LLEVA_COSTO || c !== VER_COSTOS;
  return {
    // `nota_tiendas`: la ve (o la hace) solo quien tiene «Todas las tiendas» (2026-10-22).
    catalogo: CATALOGO.filter((p) => visible(p.clave))
      .map((p) => (notaTiendas(p.clave) ? { ...p, nota_tiendas: notaTiendas(p.clave) } : p)),
    no_las_ven: noLasVen(roles, asignados, sinTodas),
    // El puesto que no entra al sistema (el cargador) no tiene nada que decidir aquí.
    roles: roles.filter((r) => Number(r.entra_al_sistema)).map(({ entra_al_sistema, ...r }) => ({
      ...r,
      personas: Number(r.personas),
      es_admin: r.nombre === ADMIN,
      claves: (r.nombre === ADMIN ? [...CLAVES] : asignados[r.id] ?? []).filter(visible),
    })),
    // Si la migración no se aplicó, la pantalla lo dice en vez de guardar en el aire.
    falta_migracion: registradas.size === 0,
  };
}

/**
 * Quien tiene en su puesto pantallas que suman TODAS las tiendas pero trabaja en
 * una (o varias) y por eso NO las ve (2026-10-22: Contabilidad tenía
 * Transferencias y su persona, de la Matriz, no la veía sin saber por qué). El
 * administrador las ve siempre.
 */
function noLasVen(roles, asignados, personas) {
  const admin = new Set(roles.filter((r) => r.nombre === ADMIN).map((r) => Number(r.id)));
  const nombreRol = Object.fromEntries(roles.map((r) => [Number(r.id), r.nombre]));
  const out = [];
  for (const p of personas) {
    if (p.puestos.some((id) => admin.has(id))) continue;
    const { pantallas, acciones } = soloConTodas(p.puestos.flatMap((id) => asignados[id] ?? []));
    if (!pantallas.length && !acciones.length) continue;
    out.push({
      usuario_id: p.id, nombre: p.nombre, tiendas: p.tiendas,
      puestos: p.puestos.map((id) => nombreRol[id]).filter(Boolean),
      pantallas, acciones,
    });
  }
  return out;
}

async function guardar(rolId, claves) {
  const rol = await model.obtenerRol(rolId);
  if (!rol) throw new AppError(404, 'NO_ENCONTRADO', 'Ese puesto no existe');
  if (rol.nombre === ADMIN) {
    throw new AppError(422, 'ADMIN_FIJO',
      'El administrador siempre lo puede todo: su columna no se cambia.');
  }
  if (!rol.entra_al_sistema) {
    throw new AppError(422, 'PUESTO_SIN_ACCESO',
      `El puesto ${rol.nombre} no entra al sistema: no lleva permisos.`);
  }
  const desconocidas = claves.filter((c) => !CLAVES.has(c));
  if (desconocidas.length) {
    throw new AppError(422, 'PERMISO_DESCONOCIDO', `No existen: ${desconocidas.join(', ')}`);
  }
  const registradas = await model.clavesRegistradas();
  if (registradas.size === 0) {
    throw new AppError(409, 'FALTA_MIGRACION',
      'Falta aplicar la migración 2026-10_permisos_por_puesto.sql en la base.');
  }
  // La pantalla no enseña «Ver costos» mientras no se lleve el costo, así que
  // no lo manda: a quien ya lo tenía se le conserva, por si vuelve a llevarse.
  const finales = new Set(claves);
  if (!SE_LLEVA_COSTO && (await model.clavesDeRol(rolId)).has(VER_COSTOS)) finales.add(VER_COSTOS);
  await model.guardar(rolId, [...finales]);
  return matriz();
}

async function crearRol({ nombre, descripcion, copiar_de }) {
  const limpio = String(nombre).trim().toLowerCase();
  if (await model.porNombre(limpio)) {
    throw new AppError(409, 'PUESTO_EXISTE', `Ya hay un puesto llamado "${limpio}"`);
  }
  const id = await model.crearRol(limpio, descripcion);
  // Arranca con lo mismo que otro puesto, si se pidió: es lo normal ("como
  // cajero, pero que también pueda recibir mercancía").
  if (copiar_de) {
    const base = await model.obtenerRol(copiar_de);
    if (base && base.nombre !== ADMIN) {
      await model.guardar(id, [...(await model.clavesDeRol(copiar_de))]);
    }
  }
  return matriz();
}

/**
 * ¿Quien hace la petición puede ver COSTOS? Para las rutas públicas o de todo el
 * personal que devuelven presentaciones (`GET /productos/:id`, `GET /variantes`,
 * el escáner de la caja): el costo viene en el renglón y sin esto lo veía
 * cualquiera, incluso sin sesión. El token es opcional: sin token, o sin el
 * permiso, no.
 */
async function veCostos(req) {
  const auth = authOpcional(req);
  return auth ? puede(auth, 'hacer:ver_costos') : false;
}

/**
 * Quién pregunta en una ruta que no exige sesión: el token si viene y es válido,
 * o null. Para dar más a quien es del personal sin cerrarle la ruta al público.
 */
function authOpcional(req) {
  if (req.auth) return req.auth;
  const [esquema, token] = (req.headers?.authorization || '').split(' ');
  if (esquema !== 'Bearer' || !token) return null;
  try {
    return require('../../utils/jwt').verificarToken(token);
  } catch {
    return null;
  }
}

/** Los campos que dicen a cómo le sale el hilo a la tienda. */
const CAMPOS_COSTO = new Set(['costo', 'costo_unitario', 'costo_actualizado_en']);

/** Copia sin los campos del costo, a cualquier profundidad. */
function quitarCostos(valor) {
  if (Array.isArray(valor)) return valor.map(quitarCostos);
  if (!valor || typeof valor !== 'object' || valor instanceof Date || Buffer.isBuffer(valor)) return valor;
  const limpio = {};
  for (const [k, v] of Object.entries(valor)) if (!CAMPOS_COSTO.has(k)) limpio[k] = quitarCostos(v);
  return limpio;
}

/**
 * Middleware de un router entero (2026-10-16, revisión de "cada quien, sus
 * tiendas"): a quien no tiene «Ver costos» ninguna respuesta le lleva el costo,
 * venga de la ruta que venga. Antes cada ruta tenía que acordarse
 * (`sinCostosSiNoVe`) y varias se olvidaban: el detalle de la venta traía el
 * `costo_unitario` de cada línea y cambiar un precio regresaba el `costo`.
 */
function sinCostosEnRespuesta(req, res, next) {
  const json = res.json.bind(res);
  res.json = (cuerpo) => {
    veCostos(req)
      .then((ve) => json(ve ? cuerpo : quitarCostos(cuerpo)))
      .catch(() => json(quitarCostos(cuerpo)));
    return res;
  };
  next();
}

/** Mandar un costo sin poder verlo: 403 (la regla del costo, 2026-10-06). */
async function exigirVerCostos(req, ...valores) {
  if (valores.every((v) => v === undefined || v === null)) return; // vacío: no captura nada
  if (!(await veCostos(req))) {
    throw new AppError(403, 'SIN_PERMISO', 'El costo solo lo capturan administración y contabilidad.');
  }
}

/** Quita el costo de una presentación (o de una lista) si quien pregunta no lo puede ver. */
async function sinCostosSiNoVe(req, variantes) {
  if (await veCostos(req)) return variantes;
  for (const v of [].concat(variantes ?? [])) {
    if (v && typeof v === 'object') {
      delete v.costo;
      delete v.costo_actualizado_en;
    }
  }
  return variantes;
}

module.exports = {
  almacenesDe, veTodasLasTiendas, puedeAlmacen, exigirAlmacen, exigirTurno, filtroAlmacen,
  sinCostosEnRespuesta, exigirVerCostos, quitarCostos,
  authOpcional, puestosDe, esAdmin, clavesDe, puede, matriz, guardar, crearRol, veCostos, sinCostosSiNoVe, SE_LLEVA_COSTO };
