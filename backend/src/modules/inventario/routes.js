'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requirePermiso } = require('../../middlewares/auth');

const router = Router();
// Un envío de otras tiendas no se ve ni se toca (2026-10-15): toda ruta con `:id`.
router.param('id', controller.traspasoDeSusTiendas);
// El costo del kardex y de las existencias solo a quien ve costos (2026-10-16).
router.use(require('../permisos/service').sinCostosEnRespuesta);
const soloStaff = [authRequired, requireTipo('usuario')];

const movimientoSchema = z
  .object({
    variante_id: z.coerce.number().int().positive(),
    almacen_id: z.coerce.number().int().positive(),
    tipo: z.enum(['entrada', 'salida', 'ajuste', 'devolucion', 'merma']),
    cantidad: z.coerce.number().nonnegative(),
    costo_unitario: z.coerce.number().nonnegative().nullable().optional(),
    referencia_tipo: z.string().trim().max(30).optional(),
    referencia_id: z.coerce.number().int().positive().nullable().optional(),
    motivo: z.string().trim().max(255).optional(),
  })
  .strict();

// Bajar UN paquete a conos, SIEMPRE con su código (2026-10-18: "es un peligro
// y puede descuadrar inventario", usuario). Del código salen el hilo, el cono,
// los KILOS (los del paquete, no se teclean) y los conos que rinde. Se quitaron
// `cono_variante_id`, `paquetes` y `kg`: con ellos se sacaban kilos sin marcar
// ningún paquete como abierto. `.strict()` los rechaza si alguien los manda.
const desarmarSchema = z
  .object({
    almacen_origen_id: z.coerce.number().int().positive(),
    almacen_destino_id: z.coerce.number().int().positive(),
    // Conos que rinde de verdad, solo si el paquete no lo dice (la lista del
    // proveedor lo trae). No mueve kilos: es cuántas piezas son.
    conos: z.coerce.number().positive().max(1000000).nullable().optional(),
    // Lo que GANA de peso el hilo al enconarse (el tubo de cada cono). Lo captura
    // la tienda: no se calcula. Se suma a los kilos y queda en el kardex.
    destare_kg: z.coerce.number().nonnegative().max(100000).nullable().optional(),
    // O por CONO (lo que pesa el tubo de uno): se multiplica por los conos que
    // salen (2026-10-06: "eso se le suma a cada cono"). Si viene, manda.
    destare_por_cono_kg: z.coerce.number().nonnegative().max(1).nullable().optional(),
    // El paquete que se abre: escaneado o escrito a mano, es lo mismo.
    codigo_bulto: z.string({ required_error: 'Escanea o escribe el código del paquete que vas a abrir' })
      .trim().min(1, 'Escanea o escribe el código del paquete que vas a abrir').max(60),
    motivo: z.string().trim().max(255).optional(),
  })
  .strict();

// Traspaso de matriz a sucursal. Cada línea manda `paquetes` (si la variante
// es un paquete) o `cantidad` en la unidad de la variante.
const traspasoSchema = z
  .object({
    almacen_origen_id: z.coerce.number().int().positive(),
    almacen_destino_id: z.coerce.number().int().positive(),
    notas: z.string().trim().max(1000).optional(),
    items: z
      .array(
        z
          .object({
            variante_id: z.coerce.number().int().positive(),
            paquetes: z.coerce.number().positive().max(1000000).optional(),
            cantidad: z.coerce.number().positive().max(1000000).optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

/**
 * Lo que el responsable declara al recibir. Sin `recibido` se acepta el envío
 * completo; con él se dice línea por línea qué llegó de verdad.
 */
// Los paquetes escaneados al surtir: sin ellos no se envía (el modelo lo dice
// con SIN_ESCANEAR, en palabras de la tienda). `notas`: lo que quiera añadir
// quien surte; lo que no salió completo se anota solo.
const envioSchema = z
  .object({
    codigos: z.array(z.string().trim().min(1).max(60)).max(2000).optional(),
    // Los que el sistema tenía en otro almacén y quien surte confirmó que sí
    // están aquí: se pasan al origen con sus kilos (2026-10-07).
    encontrados: z.array(z.string().trim().min(1).max(60)).max(2000).optional(),
    notas: z.string().trim().max(1000).optional(),
  })
  .strict();

const recepcionSchema = z
  .object({
    notas: z.string().trim().max(1000).optional(),
    recibido: z
      .array(
        z
          .object({
            detalle_id: z.coerce.number().int().positive(),
            paquetes: z.coerce.number().min(0).max(1000000).optional(),
            cantidad: z.coerce.number().min(0).max(1000000).optional(),
          })
          .strict()
      )
      .optional(),
  })
  .strict();

const cancelacionSchema = z
  .object({ motivo: z.string().trim().max(255).optional() })
  .strict();

const configurarSchema = z
  .object({
    variante_id: z.coerce.number().int().positive(),
    almacen_id: z.coerce.number().int().positive(),
    stock_minimo: z.coerce.number().nonnegative().optional(),
    stock_maximo: z.coerce.number().nonnegative().nullable().optional(),
    ubicacion_fisica: z.string().trim().max(60).optional(),
  })
  .strict();

// Lecturas (staff): existencias, alertas y kardex.
router.get('/', ...soloStaff, controller.listarStock);
router.get('/alertas', ...soloStaff, controller.alertas);
// Panorama de qué hay en cada almacén (totales + matriz producto × almacén).
router.get('/resumen', ...soloStaff, controller.resumenPorAlmacen);
// El detalle de un hilo: cuánto hay por presentación, sus lotes y los bultos de cada uno.
router.get('/hilos/:productoId', ...soloStaff, controller.detalleHilo);
router.get('/hilos/:productoId/bultos', ...soloStaff, controller.bultosDeLote);
router.get('/movimientos', ...soloStaff, controller.listarMovimientos);
router.get('/conversiones', ...soloStaff, controller.listarConversiones);
// Lo que trae un bulto, para mostrarlo antes de bajarlo a mostrador.
router.get('/desarmes/previa/:codigo', ...soloStaff, controller.previaDesarmeBulto);
// Cuántos paquetes son X kilos, con el peso real de los bultos de la bodega.
router.get('/equivalencia-paquetes', ...soloStaff, controller.equivalenciaPaquetes);
router.get('/traspasos', ...soloStaff, controller.listarTraspasos);
router.get('/traspasos/:id', ...soloStaff, controller.obtenerTraspaso);

// Escrituras (staff): movimientos, desarmes, traspasos y configuración de umbrales.
router.post('/movimientos', ...soloStaff, requirePermiso('hacer:ajuste_merma'), validate(movimientoSchema), controller.registrarMovimiento);
router.post('/desarmes', ...soloStaff, requirePermiso('hacer:bajar_conos'), validate(desarmarSchema), controller.desarmar);
// El traspaso tiene tres pasos: se solicita (aparta), se envía (sale) y se
// recibe (entra, con el acuse de quien lo aceptó). Cualquiera del staff puede
// recibir; queda guardado su nombre y la hora.
router.post('/traspasos', ...soloStaff, requirePermiso('ver:surtir'), validate(traspasoSchema), controller.solicitarTraspaso);
router.post('/traspasos/:id/enviar', ...soloStaff, requirePermiso('hacer:enviar_traspaso'), validate(envioSchema), controller.enviarTraspaso);
// Guardar lo escaneado a medio surtir (la lista completa): esos paquetes quedan
// apartados para este envío hasta que se envíe o se cancele.
const escaneosSchema = z
  .object({
    codigos: z.array(z.string().trim().min(1).max(60)).max(2000),
    encontrados: z.array(z.string().trim().min(1).max(60)).max(2000).optional(),
  })
  .strict();
router.put('/traspasos/:id/escaneos', ...soloStaff, requirePermiso('hacer:enviar_traspaso'), validate(escaneosSchema), controller.guardarEscaneos);
router.post('/traspasos/:id/recibir', ...soloStaff, requirePermiso('hacer:recibir_traspaso'), validate(recepcionSchema), controller.recibirTraspaso);
router.post('/traspasos/:id/cancelar', ...soloStaff, requirePermiso('ver:surtir'), validate(cancelacionSchema), controller.cancelarTraspaso);
router.put('/configuracion', ...soloStaff, requirePermiso('ver:inventario'), validate(configurarSchema), controller.configurar);
// El mínimo para VARIOS hilos de un almacén, en paquetes (2026-10-16): vista previa o guardar.
const minimosSchema = z
  .object({
    almacen_id: z.coerce.number().int().positive(),
    paquetes: z.coerce.number().int().min(0).max(999),
    solo_sin_minimo: z.boolean().optional(),
    guardar: z.boolean().optional(),
  })
  .strict();
router.post('/configuracion/minimos', ...soloStaff, requirePermiso('ver:inventario'), validate(minimosSchema), controller.minimos);

module.exports = router;
