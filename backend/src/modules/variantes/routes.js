'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo } = require('../../middlewares/auth');

const router = Router();

const crearSchema = z
  .object({
    producto_id: z.coerce.number().int().positive(),
    color_id: z.coerce.number().int().positive().nullable().optional(),
    sku: z.string().trim().min(1).max(60),
    codigo_barras: z.string().trim().max(60).nullable().optional(),
    presentacion: z.string().trim().max(40).optional(),
    // Etiqueta de la remesa. Solo se guarda si el producto es "por lotes".
    lote: z.string().trim().max(40).nullable().optional(),
    // Presentación: 'paquete' se vende por kilo y se puede desarmar en conos;
    // 'cono' se vende por pieza y sale de un paquete; 'simple' es el caso base.
    tipo_presentacion: z.enum(['simple', 'paquete', 'cono']).optional(),
    peso_kg: z.coerce.number().positive().max(999999).nullable().optional(),
    origen_variante_id: z.coerce.number().int().positive().nullable().optional(),
    piezas_por_origen: z.coerce.number().int().positive().max(100000).nullable().optional(),
    // 'calculado' reparte el valor del paquete entre sus conos; 'manual' lo fija el usuario.
    modo_precio: z.enum(['manual', 'calculado']).optional(),
    // Opcional: con un cono de precio calculado lo determina el paquete.
    precio: z.coerce.number().nonnegative().optional(),
    precio_oferta: z.coerce.number().nonnegative().nullable().optional(),
    costo: z.coerce.number().nonnegative().nullable().optional(),
    activo: z.coerce.boolean().optional(),
  })
  .strict();

// En update no se permite cambiar producto_id (la variante pertenece a su producto).
const actualizarSchema = crearSchema.partial().omit({ producto_id: true });

const precioTipoSchema = z
  .object({
    tipo_cliente_id: z.coerce.number().int().positive(),
    // null borra el precio y ese tipo vuelve a pagar el público.
    precio: z.coerce.number().nonnegative().max(9999999).nullable(),
  })
  .strict();

const codigoSchema = z
  .object({
    codigo: z.string().trim().min(1).max(60),
    etiqueta: z.string().trim().max(60).optional(),
  })
  .strict();

const soloStaff = [authRequired, requireTipo('usuario')];

router.get('/', controller.listar);
router.get('/:id', controller.obtener);

router.post('/', ...soloStaff, validate(crearSchema), controller.crear);
router.put('/:id', ...soloStaff, validate(actualizarSchema), controller.actualizar);
router.delete('/:id', ...soloStaff, controller.eliminar);

// Precio de la variante para un tipo de cliente.
router.put('/:id/precios', ...soloStaff, validate(precioTipoSchema), controller.fijarPrecioTipo);

// Códigos de barras adicionales de una variante
router.get('/:id/codigos', controller.listarCodigos);
router.post('/:id/codigos', ...soloStaff, validate(codigoSchema), controller.agregarCodigo);
router.delete('/codigos/:codigoId', ...soloStaff, controller.eliminarCodigo);

module.exports = router;
