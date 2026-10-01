'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo } = require('../../middlewares/auth');

const router = Router();

// Cualquiera del personal puede preguntar; lo que PUEDE consultar depende de su
// rol y lo filtra el catálogo de herramientas. El cliente de la tienda en línea
// no tiene acceso: sus datos no son asunto suyo.
const soloStaff = [authRequired, requireTipo('usuario')];

const preguntarSchema = z
  .object({
    pregunta: z.string().trim().min(1).max(2000),
    // Los turnos anteriores, para poder decir "¿y del mes pasado?" sin repetir
    // el contexto. Se recorta en el service.
    historial: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().max(4000),
        })
      )
      .max(20)
      .optional(),
  })
  .strict();

// Qué puede contestar, para poder mostrarlo en la pantalla.
router.get('/capacidades', ...soloStaff, controller.capacidades);
router.post('/preguntar', ...soloStaff, validate(preguntarSchema), controller.preguntar);

module.exports = router;
