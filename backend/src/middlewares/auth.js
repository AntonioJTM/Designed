'use strict';

const { verificarToken } = require('../utils/jwt');
const { AppError } = require('./error');

/**
 * Middleware de autenticación JWT.
 * Extrae el token del header `Authorization: Bearer <token>`, lo verifica y
 * coloca el payload en `req.auth` = { sub, tipo, rol_id?, rol? }.
 */
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const [esquema, token] = header.split(' ');

  if (esquema !== 'Bearer' || !token) {
    return next(new AppError(401, 'NO_AUTENTICADO', 'Falta el token Bearer de autenticación'));
  }

  try {
    req.auth = verificarToken(token);
    return next();
  } catch (err) {
    const code = err && err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO';
    return next(new AppError(401, code, 'Token inválido o expirado'));
  }
}

/**
 * Restringe el acceso a un tipo de sujeto ('usuario' = staff, 'cliente').
 * Debe usarse después de authRequired.
 */
function requireTipo(...tipos) {
  return (req, res, next) => {
    if (!req.auth) {
      return next(new AppError(401, 'NO_AUTENTICADO', 'Se requiere autenticación'));
    }
    if (!tipos.includes(req.auth.tipo)) {
      return next(new AppError(403, 'PROHIBIDO', 'No tienes permiso para acceder a este recurso'));
    }
    return next();
  };
}

/**
 * Restringe el acceso a ciertos roles de staff (por nombre de rol).
 * Implica tipo 'usuario'. Debe usarse después de authRequired.
 */
function requireRol(...roles) {
  return (req, res, next) => {
    if (!req.auth || req.auth.tipo !== 'usuario') {
      return next(new AppError(403, 'PROHIBIDO', 'Recurso exclusivo de personal (staff)'));
    }
    if (roles.length && !roles.includes(req.auth.rol)) {
      return next(new AppError(403, 'PROHIBIDO', 'Tu rol no tiene permiso para esta acción'));
    }
    return next();
  };
}

/**
 * Exige un permiso del puesto (Administración → Permisos). El administrador
 * siempre pasa. Implica personal (tipo 'usuario'). Debe ir después de
 * authRequired.
 *
 * Es lo que hace que esconder un botón no sea la única defensa: quien no tiene
 * el permiso recibe 403 aunque llame al endpoint por su cuenta.
 */
function requirePermiso(clave) {
  return async (req, res, next) => {
    if (!req.auth || req.auth.tipo !== 'usuario') {
      return next(new AppError(403, 'PROHIBIDO', 'Recurso exclusivo de personal (staff)'));
    }
    try {
      // Perezoso: el módulo de permisos usa la base y este archivo lo cargan todos.
      const { puede } = require('../modules/permisos/service');
      if (await puede(req.auth, clave)) return next();
      const { NOMBRE } = require('../modules/permisos/catalogo');
      return next(new AppError(403, 'SIN_PERMISO',
        `Tu puesto no tiene permiso para «${NOMBRE[clave] ?? clave}». Pídeselo al administrador.`));
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Como `requirePermiso`, pero basta con UNO de varios. Para lo que se usa desde
 * dos pantallas distintas: el PDF de una carga se pide en Recibir remesa
 * (`ver:remesa`) y en las presentaciones del producto (`ver:catalogo`).
 */
function requirePermisoAlguno(...claves) {
  return async (req, res, next) => {
    if (!req.auth || req.auth.tipo !== 'usuario') {
      return next(new AppError(403, 'PROHIBIDO', 'Recurso exclusivo de personal (staff)'));
    }
    try {
      const { puede } = require('../modules/permisos/service');
      for (const c of claves) if (await puede(req.auth, c)) return next();
      return next(new AppError(403, 'SIN_PERMISO', 'Tu puesto no tiene permiso para ver este reporte.'));
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { authRequired, requireTipo, requireRol, requirePermiso, requirePermisoAlguno };
