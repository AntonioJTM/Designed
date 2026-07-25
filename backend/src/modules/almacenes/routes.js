'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requireRol } = require('../../middlewares/auth');

const router = Router();

const crearSchema = z
  .object({
    nombre: z.string().trim().min(1).max(100),
    direccion: z.string().trim().max(255).optional(),
    es_punto_venta: z.coerce.boolean().optional(),
    // Marca el almacén del que descuenta la tienda en línea. Al encenderlo
    // aquí, se apaga en el resto: solo puede haber uno.
    es_tienda_linea: z.coerce.boolean().optional(),
    // Marca el almacén que surte a las sucursales. También es único.
    es_matriz: z.coerce.boolean().optional(),
    activo: z.coerce.boolean().optional(),
  })
  .strict();

const actualizarSchema = crearSchema.partial();

// Consultarlos es abierto (el catálogo público los necesita); configurarlos es
// de administrador, igual que las cajas y el personal.
const soloAdmin = [authRequired, requireTipo('usuario'), requireRol('administrador')];

router.get('/', controller.listar);
// Ruta específica antes de '/:id' para que no la absorba.
router.get('/tienda-linea', controller.tiendaLinea);
router.get('/matriz', controller.matriz);
router.get('/:id', controller.obtener);
router.post('/', ...soloAdmin, validate(crearSchema), controller.crear);
router.put('/:id', ...soloAdmin, validate(actualizarSchema), controller.actualizar);
router.delete('/:id', ...soloAdmin, controller.eliminar);

module.exports = router;
