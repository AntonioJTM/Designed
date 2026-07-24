'use strict';

/**
 * Middleware de validación con zod. Valida y NORMALIZA una parte del request.
 * Reemplaza req[origen] con los datos ya parseados (tipos coercionados, sin
 * campos extra). Un fallo lanza ZodError, que el errorHandler traduce a 422.
 *
 *   router.post('/', validate(esquema), controlador)          // valida body
 *   router.get('/', validate(esquema, 'query'), controlador)  // valida query
 */
function validate(schema, origen = 'body') {
  return (req, res, next) => {
    try {
      req[origen] = schema.parse(req[origen]);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { validate };
