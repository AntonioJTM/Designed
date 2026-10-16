'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requirePermiso, requireTodasLasTiendas } = require('../../middlewares/auth');

const router = Router();

const registroSchema = z
  .object({
    nombre: z.string().trim().min(2).max(120),
    correo: z.string().trim().toLowerCase().email().max(160),
    telefono: z.string().trim().max(20).optional(),
    contrasena: z.string().min(8).max(72), // bcrypt trunca a 72 bytes
    acepta_marketing: z.coerce.boolean().optional().default(false),
  })
  .strict();

const loginSchema = z
  .object({
    correo: z.string().trim().toLowerCase().email().max(160),
    contrasena: z.string().min(1).max(72),
  })
  .strict();

// ---------------------------------------------------------------------------
//  TIENDA EN LÍNEA APAGADA (2026-10, decisión del usuario: "el cliente por
//  ahora no la quiere"). Se COMENTA, no se borra: para volver a abrirla basta
//  con descomentar estas tres rutas y las de `frontend/src/app/app.routes.ts`.
//  Sin ellas nadie puede abrirse una cuenta ni entrar como cliente, así que el
//  checkout y las direcciones (que exigen token de cliente) quedan cerrados solos.
// ---------------------------------------------------------------------------
// // POST /api/v1/clientes/registro  → alta de cuenta de cliente
// router.post('/registro', validate(registroSchema), controller.registrar);
//
// // POST /api/v1/clientes/login  → inicio de sesión de cliente
// router.post('/login', validate(loginSchema), controller.iniciarSesion);
//
// // GET /api/v1/clientes/perfil  → perfil del cliente autenticado
// router.get('/perfil', authRequired, requireTipo('cliente'), controller.perfil);

// ---------------------------------------------------------------------------
//  El expediente del cliente. Solo personal.
//
//  Ojo con el ORDEN: las rutas literales ('/buscar', '/por-cobrar') van ANTES
//  de '/:id', o Express las tomaría por un id y respondería 404.
// ---------------------------------------------------------------------------

const soloStaff = [authRequired, requireTipo('usuario')];
// Corregir una deuda es dinero: lo decide Permisos («Corregir la deuda de un
// cliente»). Un cajero puede COBRAR un abono, pero de inicio no perdonar una deuda.

// Sin `codigo`: el número de cliente lo da el sistema y no se modifica
// (2026-10-14); mandarlo es 422.
const expedienteSchema = z
  .object({
    nombre: z.string().trim().min(1).max(120),
    // Como le dicen de verdad. Es con lo que la tienda lo busca.
    nombre_comercial: z.string().trim().max(120).nullable().optional(),
    rfc: z.string().trim().max(20).nullable().optional(),
    tipo_cliente_id: z.coerce.number().int().positive().nullable().optional(),
    correo: z.string().trim().toLowerCase().email().max(160).nullable().optional(),
    telefono: z.string().trim().max(20).nullable().optional(),
    telefono_alt: z.string().trim().max(20).nullable().optional(),
    direccion: z.string().trim().max(255).nullable().optional(),
    ciudad: z.string().trim().max(100).nullable().optional(),
    estado: z.string().trim().max(100).nullable().optional(),
    // A dónde se le entrega: uno de la lista de lugares de entrega.
    lugar_entrega_id: z.coerce.number().int().positive().nullable().optional(),
    como_llego: z.string().trim().max(60).nullable().optional(),
    fecha_nacimiento: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    // Desde cuándo compra DE VERDAD, no desde cuándo está capturado.
    cliente_desde: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    limite_credito: z.coerce.number().nonnegative().max(99999999).optional(),
    notas: z.string().trim().max(5000).nullable().optional(),
    activo: z.coerce.boolean().optional(),
  })
  .strict();

const editarSchema = expedienteSchema.partial();

const abonoSchema = z
  .object({
    monto: z.coerce.number().positive().max(99999999),
    metodo_pago_id: z.coerce.number().int().positive().optional(),
    // Obligatoria cuando el abono es en efectivo: el dinero tiene que entrar
    // al turno o el corte no cuadra.
    sesion_caja_id: z.coerce.number().int().positive().optional(),
    referencia: z.string().trim().max(120).optional(),
    notas: z.string().trim().max(255).optional(),
  })
  .strict();

const ajusteSchema = z
  .object({
    // Positivo sube la deuda, negativo la baja (condonar).
    monto: z.coerce.number().max(99999999).min(-99999999),
    notas: z.string().trim().min(1).max(255),
  })
  .strict();

// Búsqueda rápida para el POS: literal antes de '/:id'.
router.get('/buscar', ...soloStaff, controller.buscar);

// LUGARES DE ENTREGA (2026-10-14): el municipio y el estado a donde se le entrega,
// de una lista, para contar a cuántos clientes se les entrega en cada lugar.
// Literales antes de '/:id'.
const lugarSchema = z
  .object({
    nombre: z.string().trim().min(1, 'Pon el nombre del lugar').max(100),
    estado: z.string().trim().min(1, 'Pon el estado').max(100),
  })
  .strict();
router.get('/lugares-entrega', ...soloStaff, controller.lugaresListar);
router.post('/lugares-entrega', ...soloStaff, validate(lugarSchema), controller.lugaresCrear);
router.put('/lugares-entrega/:id', ...soloStaff, validate(lugarSchema), controller.lugaresActualizar);
// Las cinco pestañas de Clientes: frecuencia, deuda, que-compra, cuando, gasto.
// Suman TODAS las tiendas: solo quien las ve todas (2026-10-15).
router.get('/analisis/:vista', ...soloStaff, requirePermiso('ver:clientes'), requireTodasLasTiendas, controller.analisis);

router.get('/', ...soloStaff, controller.listar);
router.post('/', ...soloStaff, validate(expedienteSchema), controller.crearDesdeStaff);
router.get('/:id', ...soloStaff, controller.expediente);
router.put('/:id', ...soloStaff, validate(editarSchema), controller.actualizar);

// Crédito. El estado de cuenta viaja dentro del expediente (GET /:id) y la lista
// de quién debe, en el tablero (GET /analisis/tablero).
router.post('/:id/abonos', ...soloStaff, validate(abonoSchema), controller.abonar);
// Los datos de su ticket, al registrarlo o para reimprimirlo (2026-10-15).
router.get('/:id/abonos/:movId/ticket', ...soloStaff, controller.ticketAbono);
router.post('/:id/ajustes', ...soloStaff, requirePermiso('hacer:corregir_deuda'), validate(ajusteSchema), controller.ajustar);

// SALDO A FAVOR (2026-10-13): lo que le quedó de una devolución se descuenta de
// lo que debe cuando él lo pide. Sin `monto`, todo lo que alcance.
const aplicarSaldoSchema = z
  .object({ monto: z.coerce.number().positive().max(99999999).optional() })
  .strict();
router.post('/:id/saldo-favor/aplicar', ...soloStaff, validate(aplicarSaldoSchema), controller.aplicarSaldoFavor);
// AJUSTE A MANO del saldo a favor (2026-10-16): sumarle (positivo) o quitarle
// (negativo), con motivo. Con el permiso del ajuste de la deuda.
const ajusteSaldoSchema = z
  .object({
    monto: z.coerce.number().min(-99999999).max(99999999).refine((n) => n !== 0, 'El ajuste no puede ser cero'),
    notas: z.string().trim().min(1, 'Escribe el motivo').max(255),
  })
  .strict();
router.post('/:id/saldo-favor/ajuste', ...soloStaff, requirePermiso('hacer:corregir_deuda'), validate(ajusteSaldoSchema), controller.ajustarSaldoFavor);

// ANTICIPO (2026-10-14): dinero a cuenta, sin nota, en efectivo y/o por
// transferencia; le queda a favor. El efectivo exige el turno que lo recibe.
const anticipoSchema = z
  .object({
    efectivo: z.coerce.number().nonnegative().max(99999999).optional(),
    transferencia: z.coerce.number().nonnegative().max(99999999).optional(),
    sesion_caja_id: z.coerce.number().int().positive().optional(),
    referencia: z.string().trim().max(120).optional(),
    notas: z.string().trim().max(255).optional(),
  })
  .strict();
router.post('/:id/anticipos', ...soloStaff, validate(anticipoSchema), controller.recibirAnticipo);
router.get('/:id/anticipos/:movId/ticket', ...soloStaff, controller.ticketAnticipo);

module.exports = router;
