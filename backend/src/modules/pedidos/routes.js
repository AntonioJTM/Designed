'use strict';

const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requirePermiso } = require('../../middlewares/auth');

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
  // Cuántas piezas eran (los conos que se pesaron). Solo informativo: se cobra y
  // se descuenta por `cantidad`, que son kilos.
  piezas: z.coerce.number().int().positive().max(100000).optional(),
});

const pagoSchema = z.object({
  metodo_pago_id: z.coerce.number().int().positive(),
  monto: z.coerce.number().positive(),
  referencia_transaccion: z.string().trim().max(120).optional(),
});

const crearSchema = z
  .object({
    canal: z.enum(['tienda_linea', 'punto_venta']),
    // Cómo llega la mercancía. El mostrador siempre es 'recoger'; online lo
    // elige el cliente y 'envio' exige dirección.
    metodo_entrega: z.enum(['recoger', 'envio']).optional(),
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
    // Cómo dice el CLIENTE de la tienda en línea que va a pagar (transferencia
    // o efectivo en tienda). No cobra nada: deja el pedido 'pendiente' con un
    // pago 'pendiente' que el administrador confirma. El staff usa `pagos`.
    metodo_pago_id: z.coerce.number().int().positive().optional(),
    // Cuánto de esta venta se va A CRÉDITO (se lo lleva y paga después).
    // Admite venta MIXTA: paga algo hoy y el resto queda a deber, que es como
    // ocurre de verdad en el mostrador. Exige `cliente_id`: no se le puede
    // fiar a un desconocido.
    a_credito: z.coerce.number().positive().max(99999999).optional(),
    /**
     * APARTADO: el cliente deja un anticipo y la mercancía se guarda. No se
     * descuenta del inventario —se RESERVA— hasta que la entregue.
     * El anticipo va en `pagos` y puede ser cualquier cosa, incluso nada.
     */
    apartado: z.coerce.boolean().optional(),
    /**
     * PEDIDO (encargo): una venta que se entrega después —la recoge o la lleva
     * el chofer—. La mercancía se aparta; lo que falte se cobra (o se fía) al
     * entregarla. `metodo_entrega` 'envio' = la lleva el chofer, a
     * `entrega_direccion`.
     */
    encargo: z.boolean().optional(),
    entrega_direccion: z.string().trim().max(255).optional(),
    entrega_para: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

// Lo mismo, pero para pedir el desglose sin comprometer nada. No lleva pagos:
// cotizar no cobra.
const cotizarSchema = crearSchema.omit({
  pagos: true, metodo_pago_id: true, a_credito: true, apartado: true,
});

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
    // 'apartado' solo para reactivar un apartado cancelado (lo valida el model).
    // 'listo' solo para los pedidos (encargos); también lo valida el model.
    estado: z.enum([
      'apartado', 'pendiente', 'pagado', 'en_preparacion', 'listo', 'enviado', 'entregado', 'cancelado', 'devuelto',
    ]),
    devoluciones: z.array(devolucionSchema).max(200).optional(),
  })
  .strict();

// Cuánto costaría, sin crearlo. Lo consulta el checkout para mostrar el
// desglose —envío, cupón, IVA— antes de que el cliente confirme.
router.post('/cotizacion', authRequired, validate(cotizarSchema), controller.cotizar);

// Crear pedido: staff (POS/admin) o cliente autenticado (online).
router.post('/', authRequired, validate(crearSchema), controller.crear);

// Pedidos del cliente autenticado (debe ir antes de '/:id').
router.get('/mis', authRequired, controller.misPedidos);

// Los apartados vigentes. Va ANTES de '/:id' o Express lo tomaría por un id y
// respondería 404 — el mismo cuidado que con '/mis' y '/cotizacion'.
router.get('/apartados', ...soloStaff, controller.apartados);
// Los PEDIDOS (encargos) sin entregar: por preparar, listos y en camino.
router.get('/encargos', ...soloStaff, requirePermiso('ver:encargos'), controller.encargos);
// Las cifras de arriba de Pedidos: hoy, la semana, lo fiado por cobrar y lo cancelado.
router.get('/resumen', ...soloStaff, controller.resumen);

// Consulta y gestión: staff.
router.get('/', ...soloStaff, controller.listar);
router.get('/:id', ...soloStaff, controller.obtener);
router.patch('/:id/estado', ...soloStaff, validate(estadoSchema), controller.cambiarEstado);

// ---- Apartados ----
const abonoApartadoSchema = z
  .object({
    monto: z.coerce.number().positive().max(99999999),
    metodo_pago_id: z.coerce.number().int().positive(),
    // Obligatoria si el abono es en efectivo: el dinero entra al turno.
    sesion_caja_id: z.coerce.number().int().positive().optional(),
    referencia: z.string().trim().max(120).optional(),
  })
  .strict();

router.post('/:id/abonos', ...soloStaff, validate(abonoApartadoSchema), controller.abonarApartado);
// Aquí es donde por fin se descuenta del inventario. Un PEDIDO cobra (o fía)
// aquí lo que le falte.
const entregaSchema = z
  .object({
    pagos: z.array(pagoSchema).max(10).optional(),
    sesion_caja_id: z.coerce.number().int().positive().optional(),
    a_credito: z.coerce.number().positive().max(99999999).optional(),
  })
  .strict();
router.post('/:id/entregar', ...soloStaff, validate(entregaSchema), controller.entregarApartado);

// PREPARAR un pedido: los paquetes que van (escaneados) y lo que pesaron los
// conos; queda listo con el total al peso real. Lo hace quien ve Pedidos.
const prepararSchema = z
  .object({
    lineas: z
      .array(
        z
          .object({
            detalle_id: z.coerce.number().int().positive(),
            codigos: z.array(z.string().trim().min(1).max(60)).max(500).optional(),
            cantidad: z.coerce.number().positive().max(100000).optional(),
            piezas: z.coerce.number().int().min(0).max(100000).nullable().optional(),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict();
router.post('/:id/preparar', ...soloStaff, requirePermiso('ver:encargos'), validate(prepararSchema), controller.prepararEncargo);

// ---- Comprobante de pago ----
// La captura que el cliente le manda al administrador cuando deposita. La sube
// SOLO el personal (el cliente la manda por fuera) y subirla da el pedido por
// pagado, en un paso.
//
// El cuerpo llega en CRUDO, como la lista de empaque de las remesas: el
// navegador manda el File tal cual y el nombre viaja en `X-Nombre-Archivo`. El
// tipo real se valida por los primeros bytes del archivo (utils/archivos.js),
// no por lo que diga la cabecera. 8 MB alcanza de sobra para una captura de
// pantalla y evita que alguien llene el disco.
const capturaEnCrudo = express.raw({ type: () => true, limit: '8mb' });

router.post('/:id/comprobante', ...soloStaff, capturaEnCrudo, controller.subirComprobante);
router.get('/:id/comprobante', ...soloStaff, controller.verComprobante);
router.delete('/:id/comprobante', ...soloStaff, controller.eliminarComprobante);

module.exports = router;
