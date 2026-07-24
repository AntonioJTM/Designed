'use strict';

const { ZodError } = require('zod');

/**
 * Error de aplicación con código HTTP y clave estable para el cliente.
 * Úsalo en servicios/controladores: throw new AppError(404, 'NO_ENCONTRADO', 'Mensaje');
 */
class AppError extends Error {
  constructor(status, code, message, detalles = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.detalles = detalles;
  }
}

/** Envía la forma de respuesta de error del proyecto: { data: null, error: {...} }. */
function enviarError(res, status, code, message, detalles = null) {
  return res.status(status).json({
    data: null,
    error: { code, message, detalles },
  });
}

/** Middleware 404 para rutas no definidas. */
function notFound(req, res) {
  return enviarError(res, 404, 'RUTA_NO_ENCONTRADA', `No existe el recurso: ${req.method} ${req.originalUrl}`);
}

/** Middleware central de manejo de errores (debe registrarse al final). */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Errores de validación de zod → 422 con el detalle de campos.
  if (err instanceof ZodError) {
    return enviarError(res, 422, 'VALIDACION', 'Datos de entrada inválidos', err.issues);
  }

  if (err instanceof AppError) {
    return enviarError(res, err.status, err.code, err.message, err.detalles);
  }

  // Violación de índice único de MySQL (p.ej. correo o SKU duplicado).
  if (err && err.code === 'ER_DUP_ENTRY') {
    return enviarError(res, 409, 'DUPLICADO', 'El registro ya existe (valor único duplicado)');
  }

  // FK inexistente al insertar/actualizar (p.ej. categoria_id que no existe).
  if (err && err.code === 'ER_NO_REFERENCED_ROW_2') {
    return enviarError(res, 422, 'REFERENCIA_INVALIDA', 'Una referencia (llave foránea) no existe');
  }

  // Intento de borrar un registro referenciado por otros.
  if (err && err.code === 'ER_ROW_IS_REFERENCED_2') {
    return enviarError(res, 409, 'EN_USO', 'No se puede eliminar: el registro está referenciado por otros');
  }

  // Cualquier otro error: log en servidor, respuesta genérica al cliente.
  console.error('[error]', err);
  const esProd = process.env.NODE_ENV === 'production';
  return enviarError(
    res,
    500,
    'ERROR_INTERNO',
    esProd ? 'Ocurrió un error interno' : String(err && err.message ? err.message : err)
  );
}

module.exports = { AppError, enviarError, notFound, errorHandler };
