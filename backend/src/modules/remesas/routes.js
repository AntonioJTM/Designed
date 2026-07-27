'use strict';

const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo } = require('../../middlewares/auth');

const router = Router();
const soloStaff = [authRequired, requireTipo('usuario')];

const bultoSchema = z
  .object({
    codigo: z.string().trim().min(1).max(60),
    peso_kg: z.coerce.number().positive().max(100000),
    lote: z.string().trim().max(40).nullable().optional(),
    conos: z.coerce.number().int().positive().max(10000).nullable().optional(),
    // La vista previa devuelve el renglón del Excel; se acepta y se ignora.
    fila: z.coerce.number().int().optional(),
  })
  .strict();

// Se manda `producto_id` (la pantalla del producto: crea la presentación si le
// falta) o `variante_id` (la presentación exacta). Uno de los dos.
const confirmarSchema = z
  .object({
    producto_id: z.coerce.number().int().positive().optional(),
    variante_id: z.coerce.number().int().positive().optional(),
    almacen_id: z.coerce.number().int().positive(),
    archivo: z.string().trim().max(255).nullable().optional(),
    notas: z.string().trim().max(1000).optional(),
    bultos: z.array(bultoSchema).min(1).max(5000),
  })
  .strict()
  .refine((d) => d.producto_id || d.variante_id, {
    message: 'Indica producto_id o variante_id',
  });

// La vista previa recibe el .xlsx en crudo. Se acepta cualquier binario para no
// depender de que el navegador mande el content-type exacto.
const cuerpoBinario = express.raw({ type: () => true, limit: '15mb' });

router.get('/', ...soloStaff, controller.listar);
router.get('/:id', ...soloStaff, controller.obtener);
router.post('/previa', ...soloStaff, cuerpoBinario, controller.previa);
router.post('/', ...soloStaff, validate(confirmarSchema), controller.confirmar);

module.exports = router;
