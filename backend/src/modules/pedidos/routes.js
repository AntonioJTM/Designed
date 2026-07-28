'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo } = require('../../middlewares/auth');

const router = Router();
const soloStaff = [authRequired, requireTipo('usuario')];

/** Un bulto físico que se entregó en esta línea, con lo que pesó. */
const bultoVendidoSchema = z.object({
  codigo: z.string().trim().min(1).max(60),
  peso_kg: z.coerce.number().positive().max(100000),
  lote: z.string().trim().max(40).nullable().optional(),
});

const itemSchema = z.object({
  variante_id: z.coerce.number().int().positive(),
  cantidad: z.coerce.number().positive(),
  descuento: z.coerce.number().nonnegative().optional(),
  // De qué bultos salió la cantidad. Opcional: una venta a granel o por pieza
  // no escanea bultos, y la tienda en línea nunca los manda.
  bultos: z.array(bultoVendidoSchema).max(500).optional(),
});

const pagoSchema = z.object({
  metodo_pago_id: z.coerce.number().int().positive(),
  monto: z.coerce.number().positive(),
  referencia_transaccion: z.string().trim().max(120).optional(),
});

const crearSchema = z
  .object({
    canal: z.enum(['tienda_linea', 'punto_venta']),
    cliente_id: z.coerce.number().int().positive().optional(),
    // Lista de precios a aplicar. Sin esto se cobra el precio público.
    tipo_cliente_id: z.coerce.number().int().positive().optional(),
    sesion_caja_id: z.coerce.number().int().positive().optional(),
    almacen_id: z.coerce.number().int().positive().optional(),
    direccion_envio_id: z.coerce.number().int().positive().optional(),
    cupon_codigo: z.string().trim().max(40).optional(),
    costo_envio: z.coerce.number().nonnegative().optional(),
    notas: z.string().trim().optional(),
    items: z.array(itemSchema).min(1),
    pagos: z.array(pagoSchema).optional(),
  })
  .strict();

// En qué presentación regresa cada línea al cancelar o devolver. Sin esto vuelve
// tal como se vendió; sirve para cuando se entregó el paquete y devuelven conos.
const devolucionSchema = z
  .object({
    detalle_id: z.coerce.number().int().positive(),
    variante_id: z.coerce.number().int().positive(),
    cantidad: z.coerce.number().positive().max(1000000).optional(),
  })
  .strict();

const estadoSchema = z
  .object({
    estado: z.enum(['pendiente', 'pagado', 'en_preparacion', 'enviado', 'entregado', 'cancelado', 'devuelto']),
    devoluciones: z.array(devolucionSchema).max(200).optional(),
  })
  .strict();

// Crear pedido: staff (POS/admin) o cliente autenticado (online).
router.post('/', authRequired, validate(crearSchema), controller.crear);

// Pedidos del cliente autenticado (debe ir antes de '/:id').
router.get('/mis', authRequired, controller.misPedidos);

// Consulta y gestión: staff.
router.get('/', ...soloStaff, controller.listar);
router.get('/:id', ...soloStaff, controller.obtener);
router.patch('/:id/estado', ...soloStaff, validate(estadoSchema), controller.cambiarEstado);

module.exports = router;
