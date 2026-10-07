'use strict';

const model = require('./model');
const { CATALOGO, CLAVES } = require('./catalogo');
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
  return activo ? puestos : [];
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
  const [roles, asignados, registradas] = await Promise.all([
    model.roles(), model.asignados(), model.clavesRegistradas(),
  ]);
  // Sin costo, «Ver costos» no hace nada: no se ofrece en la pantalla.
  const visible = (c) => SE_LLEVA_COSTO || c !== VER_COSTOS;
  return {
    catalogo: CATALOGO.filter((p) => visible(p.clave)),
    roles: roles.map((r) => ({
      ...r,
      personas: Number(r.personas),
      es_admin: r.nombre === ADMIN,
      claves: (r.nombre === ADMIN ? [...CLAVES] : asignados[r.id] ?? []).filter(visible),
    })),
    // Si la migración no se aplicó, la pantalla lo dice en vez de guardar en el aire.
    falta_migracion: registradas.size === 0,
  };
}

async function guardar(rolId, claves) {
  const rol = await model.obtenerRol(rolId);
  if (!rol) throw new AppError(404, 'NO_ENCONTRADO', 'Ese puesto no existe');
  if (rol.nombre === ADMIN) {
    throw new AppError(422, 'ADMIN_FIJO',
      'El administrador siempre lo puede todo: su columna no se cambia.');
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

module.exports = { authOpcional, puestosDe, esAdmin, clavesDe, puede, matriz, guardar, crearRol, veCostos, sinCostosSiNoVe, SE_LLEVA_COSTO };
