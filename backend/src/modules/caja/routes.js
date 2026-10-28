'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { unaVez } = require('../../middlewares/una-vez');
const { authRequired, requireTipo, requirePermiso, requirePermisoAlguno, requireTodasLasTiendas } = require('../../middlewares/auth');
const { autorizable } = require('../autorizaciones/autorizable');
const gastos = require('./gastos-controller');

const router = Router();
const soloStaff = [authRequired, requireTipo('usuario')];

const cajaSchema = z
  .object({
    almacen_id: z.coerce.number().int().positive(),
    nombre: z.string().trim().min(1).max(60),
    activo: z.coerce.boolean().optional(),
  })
  .strict();

const actualizarCajaSchema = cajaSchema.partial();

const abrirSchema = z
  .object({
    caja_id: z.coerce.number().int().positive(),
    monto_inicial: z.coerce.number().nonnegative().optional(),
  })
  .strict();

// El retiro EXIGE motivo: dinero que sale del cajón sin explicación es un
// faltante en el corte que nadie puede aclarar después.
const movimientoSchema = z
  .object({
    tipo: z.enum(['ingreso', 'retiro']),
    monto: z.coerce.number().positive(),
    motivo: z.string().trim().max(255).optional(),
  })
  .strict()
  .refine((m) => m.tipo !== 'retiro' || (m.motivo ?? '').length >= 3, {
    message: 'Un retiro necesita decir para qué se sacó el dinero.',
    path: ['motivo'],
  });

const cerrarSchema = z.object({ monto_final: z.coerce.number().nonnegative() }).strict();

// GASTOS (2026-10-20). El límite es POR GASTO; sin límite (null), TODO gasto de ese tipo se autoriza.
const tipoGastoSchema = z
  .object({
    nombre: z.string().trim().min(2).max(60),
    limite: z.coerce.number().positive().max(99999999).nullable().optional(),
    activo: z.coerce.boolean().optional(),
  })
  .strict();
// Qué se compró es obligatorio: un gasto sin explicación no se aclara en el corte.
const gastoSchema = z
  .object({
    tipo_gasto_id: z.coerce.number().int().positive(),
    monto: z.coerce.number().positive().max(99999999),
    descripcion: z.string().trim().min(3, 'Escribe qué se compró o para qué fue.').max(255),
  })
  .strict();
const gastosConsultaSchema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tipo_gasto_id: z.coerce.number().int().positive().optional(),
  almacen_id: z.coerce.number().int().positive().optional(),
  sesion_caja_id: z.coerce.number().int().positive().optional(),
});
const cancelarGastoSchema = z
  .object({ motivo: z.string().trim().min(3, 'Escribe por qué se cancela.').max(255) })
  .strict();

// Todo el módulo es de staff.
router.use(...soloStaff);

// Cualquier cajero necesita ver las cajas para abrir su turno, pero darlas de
// alta o modificarlas es configuración: lo da Permisos («Almacenes y Listas de precio»).
const soloAdmin = [requirePermiso('ver:almacenes'), requireTodasLasTiendas];

router.get('/cajas', controller.listarCajas);
router.post('/cajas', soloAdmin, validate(cajaSchema), controller.crearCaja);
router.put('/cajas/:id', soloAdmin, validate(actualizarCajaSchema), controller.actualizarCaja);
router.delete('/cajas/:id', soloAdmin, controller.eliminarCaja);

// Abrir y cerrar el turno: quien entra a Caja (2026-10-26, auditoría: bastaba ser del
// personal de esa tienda, y un almacenista podía cerrar el turno por la API).
router.post('/sesiones', requirePermiso('ver:caja'), validate(abrirSchema), controller.abrirSesion);
router.get('/sesiones/abierta', controller.sesionAbierta); // ?caja_id=
router.get('/sesiones/:id', controller.obtenerSesion);
// Con AUTORIZACIÓN (2026-10-19): quien no lo hace directo lo pide.
// Con su llave de un solo uso (`X-Clave-Unica`, 2026-10-20): un doble clic no saca dos veces.
router.post('/sesiones/:id/movimientos', validate(movimientoSchema), unaVez(), autorizable('mover_efectivo'), controller.registrarMovimiento);
router.post('/sesiones/:id/cerrar', requirePermiso('ver:caja'), validate(cerrarSchema), controller.cerrarSesion);

// GASTOS DE LA CAJA (2026-10-20). Los tipos y sus límites los da quien tiene
// «Tipos de gasto» (el administrador siempre). Registrar pide «Registrar gastos»;
// un gasto ARRIBA del límite de su tipo pide autorización (`gasto_sobre_limite`).
router.get('/tipos-gasto', gastos.listarTipos);
// Los tipos son de TODAS las tiendas: los cambia quien las ve todas.
// Darlo de alta: directo quien tiene «Tipos de gasto» (y todas las tiendas); el
// cajero lo PIDE y quien autoriza lo acepta poniéndole su límite (`tipo_gasto`).
router.post('/tipos-gasto', requirePermisoAlguno('hacer:tipos_gasto', 'pedir:tipos_gasto'), validate(tipoGastoSchema),
  unaVez(), autorizable('tipo_gasto'), gastos.crearTipo);
router.put('/tipos-gasto/:id', requirePermiso('hacer:tipos_gasto'), requireTodasLasTiendas, validate(tipoGastoSchema.partial()), gastos.actualizarTipo);
router.get('/gastos', requirePermiso('ver:caja'), validate(gastosConsultaSchema, 'query'), gastos.listar);
router.post('/sesiones/:id/gastos', requirePermiso('hacer:registrar_gasto'), validate(gastoSchema), unaVez(),
  autorizable('gasto_sobre_limite'), gastos.registrar);
router.post('/gastos/:id/cancelar', requirePermiso('hacer:mover_efectivo'), validate(cancelarGastoSchema), unaVez(), gastos.cancelar);
router.post('/gastos/:id/comprobante', requirePermiso('hacer:registrar_gasto'), gastos.fotoEnCrudo, gastos.subirComprobante);
router.get('/gastos/:id/comprobante', requirePermiso('ver:caja'), gastos.verComprobante);
router.delete('/gastos/:id/comprobante', requirePermiso('hacer:registrar_gasto'), gastos.quitarComprobante);

module.exports = router;
