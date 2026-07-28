'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo } = require('../../middlewares/auth');

const router = Router();
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

// Desarmar paquetes en conos. El peso del paquete y cuántos conos salen ya
// están en la variante cono; aquí solo se dice cuántos paquetes se abren.
const desarmarSchema = z
  .object({
    // Con `codigo_bulto` no hace falta: se resuelve el paquete del bulto y, si el
    // producto no tiene cono todavía, se crea con los conos que dice el bulto.
    cono_variante_id: z.coerce.number().int().positive().optional(),
    almacen_origen_id: z.coerce.number().int().positive(),
    almacen_destino_id: z.coerce.number().int().positive(),
    paquetes: z.coerce.number().positive().max(100000).optional(),
    // Kilos reales a consumir. Sin este dato se usa paquetes × peso del paquete;
    // sirve cuando el bulto no pesó exactamente lo nominal.
    kg: z.coerce.number().positive().max(1000000).nullable().optional(),
    // Conos que rinde de verdad. Sin este dato se usan los nominales de la
    // presentación; hace falta cuando el bulto rinde menos (uno del archivo real
    // da 7 en vez de 12, así viene de fábrica) o el inventario queda inflado.
    conos: z.coerce.number().positive().max(1000000).nullable().optional(),
    // Lo que GANA de peso el hilo al enconarse (el tubo de cada cono). Lo captura
    // la tienda: no se calcula. Se suma a los kilos y queda en el kardex.
    destare_kg: z.coerce.number().nonnegative().max(100000).nullable().optional(),
    // Bulto que se desarmó, para dejar el rastro en el kardex.
    codigo_bulto: z.string().trim().max(60).nullable().optional(),
    motivo: z.string().trim().max(255).optional(),
  })
  .strict()
  .refine((d) => d.cono_variante_id || d.codigo_bulto, {
    message: 'Escanea el bulto o indica qué cono se va a producir',
  });

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
router.get('/movimientos', ...soloStaff, controller.listarMovimientos);
router.get('/conversiones', ...soloStaff, controller.listarConversiones);
// Lo que trae un bulto, para mostrarlo antes de bajarlo a mostrador.
router.get('/desarmes/previa/:codigo', ...soloStaff, controller.previaDesarmeBulto);
// Cuántos paquetes son X kilos, con el peso real de los bultos de la bodega.
router.get('/equivalencia-paquetes', ...soloStaff, controller.equivalenciaPaquetes);
router.get('/traspasos', ...soloStaff, controller.listarTraspasos);
router.get('/traspasos/:id', ...soloStaff, controller.obtenerTraspaso);

// Escrituras (staff): movimientos, desarmes, traspasos y configuración de umbrales.
router.post('/movimientos', ...soloStaff, validate(movimientoSchema), controller.registrarMovimiento);
router.post('/desarmes', ...soloStaff, validate(desarmarSchema), controller.desarmar);
// El traspaso tiene tres pasos: se solicita (aparta), se envía (sale) y se
// recibe (entra, con el acuse de quien lo aceptó). Cualquiera del staff puede
// recibir; queda guardado su nombre y la hora.
router.post('/traspasos', ...soloStaff, validate(traspasoSchema), controller.solicitarTraspaso);
router.post('/traspasos/:id/enviar', ...soloStaff, controller.enviarTraspaso);
router.post('/traspasos/:id/recibir', ...soloStaff, validate(recepcionSchema), controller.recibirTraspaso);
router.post('/traspasos/:id/cancelar', ...soloStaff, validate(cancelacionSchema), controller.cancelarTraspaso);
router.put('/configuracion', ...soloStaff, validate(configurarSchema), controller.configurar);

module.exports = router;
