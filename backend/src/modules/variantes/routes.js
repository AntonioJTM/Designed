'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requirePermiso } = require('../../middlewares/auth');

const router = Router();

const crearSchema = z
  .object({
    producto_id: z.coerce.number().int().positive(),
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

const precioTipoSchema = z
  .object({
    tipo_cliente_id: z.coerce.number().int().positive(),
    // null borra el precio y ese tipo vuelve a pagar el público.
    precio: z.coerce.number().nonnegative().max(9999999).nullable(),
  })
  .strict();

// Un código es un BULTO: puede traer su peso real, su lote y cuántos conos
// rinde. Todo opcional, porque también sirve para un código de barras suelto.
const codigoSchema = z
  .object({
    codigo: z.string().trim().min(1).max(60),
    peso_kg: z.coerce.number().positive().max(100000).nullable().optional(),
    lote: z.string().trim().max(40).nullable().optional(),
    conos: z.coerce.number().int().positive().max(10000).nullable().optional(),
    etiqueta: z.string().trim().max(60).optional(),
  })
  .strict();

// Lo que se puede cambiar de una presentación que YA existe: su precio
// público, su oferta, su peso y si está a la venta. El SKU, el tipo y de qué
// paquete sale un cono no se tocan aquí: cambiarlos con existencias y ventas
// encima dejaría el kardex hablando de otra cosa.
const actualizarSchema = z
  .object({
    precio: z.coerce.number().nonnegative().max(9999999).optional(),
    precio_oferta: z.coerce.number().nonnegative().max(9999999).nullable().optional(),
    peso_kg: z.coerce.number().positive().max(999999).nullable().optional(),
    activo: z.coerce.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'No hay nada que cambiar' });

const soloStaff = [authRequired, requireTipo('usuario')];
// Cambiar el precio que se le cobra a todos es decisión de los jefes, no de caja.
const soloJefes = [...soloStaff, requirePermiso('hacer:cambiar_precios')];
// Dar de alta o quitar presentaciones y códigos es del catálogo.
const catalogo = [...soloStaff, requirePermiso('ver:catalogo')];

router.get('/', controller.listar);

router.post('/', ...catalogo, validate(crearSchema), controller.crear);
router.patch('/:id', ...soloJefes, validate(actualizarSchema), controller.actualizar);
router.delete('/:id', ...catalogo, controller.eliminar);

// Precio de la variante para un tipo de cliente.
router.put('/:id/precios', ...soloJefes, validate(precioTipoSchema), controller.fijarPrecioTipo);

// Códigos de barras adicionales de una variante
// Antes de '/:id' para que 'resolver' no se interprete como un id.
router.get('/resolver/:codigo', ...soloStaff, controller.resolverCodigo);
router.get('/:id/codigos', controller.listarCodigos);
router.post('/:id/codigos', ...catalogo, validate(codigoSchema), controller.agregarCodigo);
router.delete('/codigos/:codigoId', ...catalogo, controller.eliminarCodigo);

module.exports = router;
