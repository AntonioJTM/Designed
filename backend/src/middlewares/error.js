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

/**
 * Marca un error cuyo mensaje NOMBRA otra tienda (2026-10-15: "no quiero que vea
 * nada de la otra tienda"). `almacenes` son los ids que nombra y `mensaje` lo que
 * se le dice a quien no los puede ver. El manejador decide cuál mensaje va.
 */
function enOtraTienda(err, almacenes, mensaje) {
  err.otraTienda = { almacenes: almacenes.filter((a) => a != null).map(Number), mensaje };
  return err;
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
  // Errores de validación de zod → 422. El mensaje nombra los campos que
  // fallaron: "Datos de entrada inválidos" a secas no le sirve a nadie.
  if (err instanceof ZodError) {
    const campos = [...new Set(err.issues.map((i) => i.path.join('.')).filter(Boolean))];
    const detalle = campos.length ? `: revisa ${campos.join(', ')}` : '';
    return enviarError(res, 422, 'VALIDACION', `Datos de entrada inválidos${detalle}`, err.issues);
  }

  if (err instanceof AppError && err.otraTienda && req.auth?.tipo === 'usuario') {
    // Quien no ve esa tienda recibe el mensaje sin su nombre, y en los detalles
    // dice "otra tienda".
    const { almacenesDe } = require('../modules/permisos/service');
    almacenesDe(req.auth)
      .then((alcance) => {
        const ajena = (id) => Array.isArray(alcance) && !alcance.includes(Number(id));
        if (!err.otraTienda.almacenes.some(ajena)) {
          return enviarError(res, err.status, err.code, err.message, err.detalles);
        }
        const detalles = err.detalles?.paquetes
          ? {
              ...err.detalles,
              paquetes: err.detalles.paquetes.map((p) =>
                ajena(p.almacen_id) ? { ...p, almacen: 'otra tienda' } : p),
            }
          : err.detalles;
        return enviarError(res, err.status, err.code, err.otraTienda.mensaje, detalles);
      })
      .catch(() => enviarError(res, err.status, err.code, err.otraTienda.mensaje, null));
    return undefined;
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

  // Número demasiado grande para la columna. Sin esto se iba como 500 y el
  // usuario solo veía "Ocurrió un error interno".
  if (err && (err.code === 'ER_WARN_DATA_OUT_OF_RANGE' || err.code === 'ER_DATA_TOO_LONG')) {
    const campo = /column '([^']+)'/.exec(err.sqlMessage || '')?.[1];
    return enviarError(
      res,
      422,
      'FUERA_DE_RANGO',
      campo
        ? `El valor de "${campo}" es demasiado grande para el sistema. Revísalo.`
        : 'Uno de los valores es demasiado grande para el sistema.'
    );
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

module.exports = { AppError, enOtraTienda, enviarError, notFound, errorHandler };
