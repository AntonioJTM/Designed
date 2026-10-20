'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requirePermiso, requireTodasLasTiendas } = require('../../middlewares/auth');
const { autorizable } = require('../autorizaciones/autorizable');
const { AppError } = require('../../middlewares/error');
const nominaModel = require('./model');

/**
 * NADIE TOCA SU PROPIA NÓMINA (fase 3, 2026-10-19): ni su recibo (días, horas
 * extra, bonos, descuentos) ni su sueldo; solo el administrador. Quien la
 * prepara ve la suya, pero no la ajusta.
 */
const DUENO = {
  empleado: (p) => Number(p.usuarioId),
  recibo: (p) => nominaModel.duenoDeRecibo(p.id),
  concepto: (p) => nominaModel.duenoDeConcepto(p.conceptoId),
};
const noEsSuya = (de) => async (req, res, next) => {
  try {
    const { esAdmin } = require('../permisos/service');
    if (await esAdmin(req.auth)) return next();
    const dueno = await DUENO[de](req.params);
    if (dueno != null && dueno === Number(req.auth.sub)) {
      throw new AppError(403, 'ES_TU_NOMINA', 'Tu propia nómina (tu recibo y tu sueldo) la ajusta el administrador.');
    }
    return next();
  } catch (err) {
    return next(err);
  }
};
// Las vacaciones en Nómina las registra (o las quita) solo quien las autoriza.
const autorizaVacaciones = requirePermiso('hacer:autorizar_vacaciones');

const router = Router();

// La nómina expone sueldos del personal: es exclusiva de administradores,
// igual que la gestión de staff.
// Las comisiones son de las ventas de todas las tiendas: solo quien las ve todas (2026-10-15).
const soloAdmin = [authRequired, requireTipo('usuario'), requirePermiso('ver:nomina'), requireTodasLasTiendas];

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato YYYY-MM-DD');
const hora = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Usa el formato HH:MM');

// Un día de su horario (0 = domingo … 6 = sábado). Los días que no vienen son descanso.
const diaHorarioSchema = z
  .object({
    dia_semana: z.coerce.number().int().min(0).max(6),
    hora_entrada: hora,
    hora_salida: hora,
  })
  .strict();

const empleadoSchema = z
  .object({
    sueldo_base_semanal: z.coerce.number().nonnegative().max(9999999).optional(),
    paga_comision: z.coerce.boolean().optional(),
    porcentaje_comision: z.coerce.number().min(0).max(100).optional(),
    valor_hora_extra: z.coerce.number().nonnegative().max(99999).optional(),
    fecha_ingreso: fecha.nullable().optional(),
    comida_min: z.coerce.number().int().min(0).max(240).optional(),
    horario: z.array(diaHorarioSchema).max(7).optional(),
    activo: z.coerce.boolean().optional(),
  })
  .strict();

const vacacionesSchema = z
  .object({
    fecha_inicio: fecha,
    fecha_fin: fecha,
    notas: z.string().trim().max(255).optional(),
  })
  .strict();

// Días trabajados de la semana: de medio en medio día.
const diasSchema = z
  .object({ dias_trabajados: z.coerce.number().min(0).max(7).multipleOf(0.5) })
  .strict();

const horasExtraSchema = z
  .object({
    fecha,
    hora_entrada: hora.optional(),
    hora_salida: hora.optional(),
    descripcion: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine((d) => d.hora_entrada || d.hora_salida, 'Escribe a qué hora salió (o entró) ese día.');

const crearPeriodoSchema = z
  .object({
    // Cualquier día de la semana deseada; el backend lo ajusta al domingo.
    fecha: fecha.optional(),
    notas: z.string().trim().max(1000).optional(),
  })
  .strict();

const estadoSchema = z
  .object({ estado: z.enum(['borrador', 'pagado', 'cancelado']) })
  .strict();

const conceptoSchema = z
  .object({
    clave: z.enum(['horas_extra', 'falta', 'descuento', 'otro']),
    // Solo se necesita con clave 'otro'; en el resto se deduce de la clave.
    tipo: z.enum(['percepcion', 'deduccion']).optional(),
    descripcion: z.string().trim().max(200).optional(),
    cantidad: z.coerce.number().positive().max(9999).optional(),
    // Opcional en horas extra: se calcula con el valor de hora del empleado.
    importe: z.coerce.number().positive().max(9999999).optional(),
  })
  .strict();

// El reporte de comisiones y el PDF: de todos, o solo de una persona.
const deQuienSchema = z
  .object({ usuario_id: z.coerce.number().int().positive().optional() })
  .strict();

// Configuración de nómina del personal.
router.get('/empleados', ...soloAdmin, controller.listarEmpleados);
router.put('/empleados/:usuarioId', ...soloAdmin, noEsSuya('empleado'), validate(empleadoSchema), controller.guardarEmpleado);

// Vacaciones: saldo según su antigüedad y lo que ha tomado.
router.get('/empleados/:usuarioId/vacaciones', ...soloAdmin, controller.vacacionesDe);
router.post('/empleados/:usuarioId/vacaciones', ...soloAdmin, autorizaVacaciones, validate(vacacionesSchema), controller.registrarVacaciones);
router.delete('/vacaciones/:id', ...soloAdmin, autorizaVacaciones, controller.eliminarVacaciones);

// MIS VACACIONES (2026-10-19): cada quien ve las suyas y las PIDE; se registran
// cuando las acepta quien tiene «Autorizar vacaciones» (nunca las propias) y se
// le avisa por WhatsApp. Las de quien no entra al sistema se siguen capturando
// arriba, en la nómina.
router.get('/mis-vacaciones', authRequired, requireTipo('usuario'), controller.misVacaciones);
router.post('/mis-vacaciones', authRequired, requireTipo('usuario'), validate(vacacionesSchema), autorizable('vacaciones'),
  controller.registrarMisVacaciones);

// Periodos semanales. '/actual' va antes de '/:id/...' para no colisionar.
router.get('/periodos/actual', ...soloAdmin, controller.periodoActual);
router.get('/periodos', ...soloAdmin, controller.listarPeriodos);
router.post('/periodos', ...soloAdmin, validate(crearPeriodoSchema), controller.crearPeriodo);
// Qué venta paga comisión en esta nómina y qué falta por liquidar.
router.get('/periodos/:id/comisiones', ...soloAdmin, validate(deQuienSchema, 'query'), controller.comisiones);
router.get('/periodos/:id/pdf', ...soloAdmin, validate(deQuienSchema, 'query'), controller.pdf);
router.post('/periodos/:id/calcular', ...soloAdmin, controller.calcular);
// PAGAR la semana se autoriza (fase 3): la prepara la gerente o Contabilidad.
router.patch('/periodos/:id/estado', ...soloAdmin, validate(estadoSchema), autorizable('pagar_nomina'), controller.cambiarEstado);

// Conceptos manuales del recibo (horas extra, faltas y descuentos).
router.post('/recibos/:id/conceptos', ...soloAdmin, noEsSuya('recibo'), validate(conceptoSchema), controller.agregarConcepto);
router.patch('/recibos/:id/dias', ...soloAdmin, noEsSuya('recibo'), validate(diasSchema), controller.fijarDiasTrabajados);
router.post('/recibos/:id/horas-extra', ...soloAdmin, noEsSuya('recibo'), validate(horasExtraSchema), controller.agregarHorasExtra);
router.delete('/conceptos/:conceptoId', ...soloAdmin, noEsSuya('concepto'), controller.eliminarConcepto);

module.exports = router;
