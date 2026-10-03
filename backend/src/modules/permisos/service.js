'use strict';

const model = require('./model');
const { CATALOGO, CLAVES } = require('./catalogo');
const { AppError } = require('../../middlewares/error');

const ADMIN = 'administrador';

/**
 * ¿La tienda lleva el COSTO de lo que compra? NO, por decisión del usuario
 * (2026-10-03): "no necesito lo que me costó, solo me sirve en cuánto lo voy a
 * vender". Mientras esto esté en false, «Ver costos y márgenes» no lo tiene
 * NADIE —ni el administrador—: el costo no sale en ninguna respuesta, el
 * tablero no calcula ganancia, margen ni dinero parado, el asistente no ofrece
 * sus herramientas de costo y los PDF no imprimen el precio de compra. La
 * pantalla de Permisos ya no lo enseña (y al guardar no se pierde a quien lo
 * tenía). Las columnas y el promedio ponderado siguen en la base, intactos:
 * para volver a llevarlo se pone en true aquí y en su gemelo del frontend
 * (`core/costos.ts`).
 */
const SE_LLEVA_COSTO = false;
const VER_COSTOS = 'hacer:ver_costos';

/** True si el sujeto del token es el administrador: él lo puede todo. */
function esAdmin(auth) {
  return auth?.tipo === 'usuario' && auth?.rol === ADMIN;
}

/** Las claves que tiene quien viene en el token (todas, si es el administrador). */
async function clavesDe(auth) {
  if (!auth || auth.tipo !== 'usuario') return new Set();
  // Copia: el Set del puesto es el del caché y no se debe tocar.
  const claves = new Set(esAdmin(auth) ? CLAVES : await model.clavesDeRol(auth.rol_id));
  if (!SE_LLEVA_COSTO) claves.delete(VER_COSTOS);
  return claves;
}

async function puede(auth, clave) {
  // El costo no se lleva: nadie lo ve, tampoco el administrador.
  if (clave === VER_COSTOS && !SE_LLEVA_COSTO) return false;
  if (esAdmin(auth)) return true;
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
  if (req.auth) return puede(req.auth, 'hacer:ver_costos');
  const [esquema, token] = (req.headers?.authorization || '').split(' ');
  if (esquema !== 'Bearer' || !token) return false;
  try {
    return await puede(require('../../utils/jwt').verificarToken(token), 'hacer:ver_costos');
  } catch {
    return false;
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

module.exports = { esAdmin, clavesDe, puede, matriz, guardar, crearRol, veCostos, sinCostosSiNoVe, SE_LLEVA_COSTO };
