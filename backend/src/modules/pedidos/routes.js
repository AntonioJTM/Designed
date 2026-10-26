'use strict';

const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { unaVez } = require('../../middlewares/una-vez');
const { authRequired, requireTipo, requirePermiso, requirePermisoAlguno } = require('../../middlewares/auth');
const { autorizable } = require('../autorizaciones/autorizable');
const { sinCostosEnRespuesta } = require('../permisos/service');

const router = Router();
// Una venta de otra tienda no se ve ni se toca (2026-10-15): toda ruta con `:id`.
router.param('id', controller.deSusTiendas);
// El costo congelado de cada línea (`costo_unitario`) solo a quien ve costos (2026-10-16).
router.use(sinCostosEnRespuesta);
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
  // A qué cuenta llegó una transferencia (2026-10-20, Transferencias).
  cuenta_bancaria_id: z.coerce.number().int().positive().optional(),
});

const crearSchema = z
  .object({
    canal: z.enum(['tienda_linea', 'punto_venta']),
    // Llave de un solo uso de la caja: la misma venta no se registra dos veces
    // (doble clic o la red que reintenta; 2026-10-19).
    clave_cobro: z.string().uuid().optional(),
    // Cómo llega la mercancía. El mostrador siempre es 'recoger'; online lo
    // elige el cliente y 'envio' exige dirección.
    metodo_entrega: z.enum(['recoger', 'envio']).optional(),
    cliente_id: z.coerce.number().int().positive().optional(),
    // Lista de precios a aplicar. Sin esto se cobra el precio público.
    tipo_cliente_id: z.coerce.number().int().positive().optional(),
    sesion_caja_id: z.coerce.number().int().positive().optional(),
    // Quién la VENDIÓ, si no es quien cobra (2026-10-23): personal de esa tienda.
    // A esa persona va la comisión; quien la registra queda como «Elaboró».
    vendedor_id: z.coerce.number().int().positive().optional(),
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
    // A cuántos días es la nota a crédito (2026-10-20); sin decirlo, 15.
    dias_credito: z.coerce.number().int().min(1).max(365).optional(),
    // Fiarle aunque traiga la cuenta atrasada: la caja lo pregunta antes (2026-10-16).
    fiar_con_atraso: z.boolean().optional(),
    // NOTA PENDIENTE DE PAGO: se lleva la mercancía y paga después (2026-10-13).
    pendiente_pago: z.boolean().optional(),
    // Cuánto paga con su SALDO A FAVOR (2026-10-13): lo que le quedó de una
    // devolución. Exige cliente y que le alcance.
    saldo_favor: z.coerce.number().positive().max(99999999).optional(),
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
  clave_cobro: true,
  pagos: true, metodo_pago_id: true, a_credito: true, apartado: true, pendiente_pago: true, saldo_favor: true,
  fiar_con_atraso: true, vendedor_id: true,
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
    // Al CANCELAR, lo que pagó queda a su saldo a favor en vez de regresárselo
    // (2026-10-26): por el efectivo y por la transferencia. Sin cliente no aplica.
    a_favor: z.object({ efectivo: z.boolean().optional(), transferencia: z.boolean().optional() }).strict().optional(),
    // Una venta A CRÉDITO ya abonada: lo abonado que queda libre se le REGRESA
    // (en efectivo de la caja o por el banco) en vez de quedarle a favor (2026-10-26).
    abonado_se_regresa: z.enum(['efectivo', 'banco']).optional(),
  })
  .strict();

// DEVOLUCIÓN CON SALDO A FAVOR (2026-10-13): de cada línea de la nota, los
// paquetes cerrados que regresan (escaneados) y lo suelto que regresa (pesado).
const devolverSchema = z
  .object({
    cliente_id: z.coerce.number().int().positive().optional(),
    destino: z.enum(['favor', 'deuda']),
    notas: z.string().trim().max(255).optional(),
    lineas: z
      .array(
        z
          .object({
            detalle_id: z.coerce.number().int().positive(),
            codigos: z.array(z.string().trim().min(1).max(60)).max(500).optional(),
            kg_sueltos: z.coerce.number().nonnegative().max(1000000).optional(),
            conos: z.coerce.number().int().nonnegative().max(100000).optional(),
          })
          .strict()
      )
      .min(1)
      .max(200),
  })
  .strict();

// Cuánto costaría, sin crearlo. Lo consulta el checkout para mostrar el
// desglose —envío, cupón, IVA— antes de que el cliente confirme.
router.post('/cotizacion', authRequired, validate(cotizarSchema), controller.cotizar);

// Crear pedido: staff (POS/admin) o cliente autenticado (online).
// Fiar a quien trae su cuenta atrasada se autoriza con clave en el momento (2026-10-19).
router.post('/', authRequired, validate(crearSchema), autorizable('fiar_atrasado'), controller.crear);

// Pedidos del cliente autenticado (debe ir antes de '/:id').
router.get('/mis', authRequired, controller.misPedidos);

// Los apartados vigentes. Va ANTES de '/:id' o Express lo tomaría por un id y
// respondería 404 — el mismo cuidado que con '/mis' y '/cotizacion'.
router.get('/apartados', ...soloStaff, controller.apartados);
// Los PEDIDOS (encargos) sin entregar: en espera.
router.get('/encargos', ...soloStaff, requirePermiso('ver:encargos'), controller.encargos);
// Las NOTAS PENDIENTES DE PAGO por cobrar (2026-10-13).
router.get('/notas-pendientes', ...soloStaff, requirePermiso('ver:notas_pendientes'), controller.notasPendientes);
// Quién puede quedar como VENDEDOR de una venta de esa tienda (2026-10-23): la caja
// los ofrece debajo del cambio. Solo de SUS tiendas.
router.get('/vendedores', ...soloStaff, requirePermiso('ver:pos'), controller.vendedores);
// Las cifras de arriba de Pedidos: hoy, la semana, lo fiado por cobrar y lo cancelado.
router.get('/resumen', ...soloStaff, controller.resumen);

// Consulta y gestión: staff.
router.get('/', ...soloStaff, controller.listar);
router.get('/:id', ...soloStaff, controller.obtener);
router.patch('/:id/estado', ...soloStaff, validate(estadoSchema), autorizable('cancelar_venta'), controller.cambiarEstado);

// ---- Apartados ----
const abonoApartadoSchema = z
  .object({
    monto: z.coerce.number().positive().max(99999999),
    // Sin método si se paga CON SU SALDO A FAVOR (2026-10-20).
    metodo_pago_id: z.coerce.number().int().positive().optional(),
    con_saldo_favor: z.boolean().optional(),
    // Obligatoria si el abono es en efectivo: el dinero entra al turno.
    sesion_caja_id: z.coerce.number().int().positive().optional(),
    referencia: z.string().trim().max(120).optional(),
    // A qué cuenta llegó, si es por transferencia (2026-10-20).
    cuenta_bancaria_id: z.coerce.number().int().positive().optional(),
  })
  .strict();

// Con su llave de un solo uso (`X-Clave-Unica`, 2026-10-20).
router.post('/:id/abonos', ...soloStaff, validate(abonoApartadoSchema), unaVez(), controller.abonarApartado);
// PAGAR UNA NOTA PENDIENTE CON HASTA DOS FORMAS (2026-10-26): efectivo, transferencia,
// su saldo a favor y/o lo que falte a crédito, en UNA operación (o todo o nada). Lo
// que va a crédito pide «Vender a crédito», y con la cuenta atrasada se autoriza.
const parteNotaSchema = z
  .object({
    metodo_pago_id: z.coerce.number().int().positive().optional(),
    con_saldo_favor: z.boolean().optional(),
    monto: z.coerce.number().positive().max(99999999),
    referencia: z.string().trim().max(120).optional(),
    cuenta_bancaria_id: z.coerce.number().int().positive().optional(),
  })
  .strict();
const pagoNotaSchema = z
  .object({
    partes: z.array(parteNotaSchema).max(2).optional(),
    sesion_caja_id: z.coerce.number().int().positive().optional(),
    a_credito: z.boolean().optional(),
    dias_credito: z.coerce.number().int().min(1).max(365).optional(),
    fiar_con_atraso: z.boolean().optional(),
  })
  .strict();
router.post('/:id/pago-nota', ...soloStaff, validate(pagoNotaSchema), unaVez(), autorizable('fiar_atrasado'), controller.pagarNota);
// Los datos del ticket de uno de sus pagos, al registrarlo o para reimprimirlo (2026-10-15).
router.get('/:id/pagos/:pagoId/ticket', ...soloStaff, controller.ticketPago);
// Pasar a crédito lo que falta de una nota pendiente de pago (es vender a crédito: pide su permiso).
// Con la cuenta atrasada se confirma (`fiar_con_atraso`) y eso se autoriza (2026-10-19).
const aCreditoSchema = z
  .object({
    fiar_con_atraso: z.boolean().optional(),
    // A cuántos días queda la nota (2026-10-20).
    dias_credito: z.coerce.number().int().min(1).max(365).optional(),
  })
  .strict();
router.post('/:id/a-credito', ...soloStaff, requirePermiso('hacer:fiar'), validate(aCreditoSchema),
  autorizable('fiar_atrasado'), controller.pasarACredito);

// Lo que se puede devolver de una nota y la devolución misma (queda a favor).
// La vista previa la ve también quien PIDE la devolución (para armarla).
router.get('/:id/devolucion', ...soloStaff, requirePermisoAlguno('hacer:cancelar_venta', 'pedir:cancelar_venta'), controller.previaDevolucion);
router.post('/:id/devoluciones', ...soloStaff, validate(devolverSchema), autorizable('devolucion'), controller.devolver);
// Aquí es donde por fin se descuenta del inventario. Un PEDIDO cobra (o fía)
// aquí lo que le falte.
const entregaSchema = z
  .object({
    pagos: z.array(pagoSchema).max(10).optional(),
    sesion_caja_id: z.coerce.number().int().positive().optional(),
    a_credito: z.coerce.number().positive().max(99999999).optional(),
    // A cuántos días es la nota a crédito (2026-10-20); sin decirlo, 15.
    dias_credito: z.coerce.number().int().min(1).max(365).optional(),
    // Se lleva la mercancía como NOTA PENDIENTE DE PAGO: lo que falta se cobra después.
    pendiente_pago: z.boolean().optional(),
    // Fiarle lo que falta aunque traiga su cuenta atrasada (se autoriza, 2026-10-19).
    fiar_con_atraso: z.boolean().optional(),
    // Lo que se paga con su SALDO A FAVOR antes de cobrar lo demás (2026-10-20).
    saldo_favor: z.coerce.number().positive().max(99999999).optional(),
  })
  .strict();
router.post('/:id/entregar', ...soloStaff, validate(entregaSchema), unaVez(), autorizable('fiar_atrasado'), controller.entregarApartado);

// MODIFICAR un pedido en espera (2026-10-07: "hay casos donde el cliente quiere
// modificar su pedido, agregar o quitar cosas"): la lista COMPLETA de lo que
// lleva (las líneas que no vienen se quitan; las nuevas van sin detalle_id), y
// la entrega, el envío, para cuándo y las notas. Lo hace quien ve Pedidos.
const modificarSchema = z
  .object({
    lineas: z
      .array(
        z
          .object({
            detalle_id: z.coerce.number().int().positive().optional(),
            variante_id: z.coerce.number().int().positive().optional(),
            codigos: z.array(z.string().trim().min(1).max(60)).max(500).optional(),
            cantidad: z.coerce.number().positive().max(100000).optional(),
            piezas: z.coerce.number().int().min(0).max(100000).nullable().optional(),
          })
          .strict()
      )
      .max(100),
    metodo_entrega: z.enum(['recoger', 'envio']).optional(),
    entrega_direccion: z.string().trim().max(255).nullable().optional(),
    costo_envio: z.coerce.number().nonnegative().max(999999).optional(),
    entrega_para: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notas: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();
router.put('/:id/encargo', ...soloStaff, requirePermiso('ver:encargos'), validate(modificarSchema), controller.modificarEncargo);

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
