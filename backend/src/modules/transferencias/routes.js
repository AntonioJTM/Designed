'use strict';

const { Router } = require('express');
const { z } = require('zod');
const model = require('./model');
const { validate } = require('../../middlewares/validate');
const {
  authRequired, requireTipo, requirePermiso, requireTodasLasTiendas,
} = require('../../middlewares/auth');
const { parsePagination, parseBool } = require('../../utils/query');

/**
 * TRANSFERENCIAS (2026-10-20): la lista de todo lo que entró por transferencia
 * y su revisión contra el banco. Suma todas las tiendas (y el abono o anticipo
 * por transferencia no tiene tienda): la ve solo quien ve todas.
 */
const router = Router();
const soloStaff = [authRequired, requireTipo('usuario')];

// Las cuentas activas, para elegir a cuál llegó AL COBRAR (cualquiera del personal).
router.get('/cuentas', ...soloStaff, async (req, res, next) => {
  try {
    res.json({ data: await model.cuentasActivas(), error: null });
  } catch (err) { next(err); }
});

const ver = [...soloStaff, requirePermiso('ver:transferencias'), requireTodasLasTiendas];
// Marcar pide también VER la pantalla: el PUT contesta el renglón completo.
const revisar = [...soloStaff, requirePermiso('ver:transferencias'), requirePermiso('hacer:revisar_transferencias'),
  requireTodasLasTiendas];

const fecha = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

router.get('/', ...ver, async (req, res, next) => {
  try {
    const { limit, offset } = parsePagination({ ...req.query, limit: req.query.limit ?? 100 });
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    const data = await model.listar({
      desde: fecha(req.query.desde),
      hasta: fecha(req.query.hasta),
      q: q || undefined,
      cuenta: req.query.cuenta === 'sin' ? 'sin' : Number(req.query.cuenta) > 0 ? Number(req.query.cuenta) : undefined,
      estado: model.ESTADOS.includes(req.query.estado) ? req.query.estado : undefined,
      facturada: parseBool(req.query.facturada),
      de: typeof req.query.de === 'string' ? req.query.de : undefined,
    }, { limit, offset });
    res.json({ data: { ...data, limit, offset, hay_mas: offset + data.items.length < data.total }, error: null });
  } catch (err) { next(err); }
});

const cambiosSchema = {
  // null = "sin cuenta".
  cuenta_bancaria_id: z.coerce.number().int().positive().nullable().optional(),
  referencia: z.string().trim().max(120).nullable().optional(),
  estado: z.enum(['por_revisar', 'procesada']).optional(),
  facturada: z.boolean().optional(),
};

// Corregir o marcar UNA (cuenta, número de operación, Procesada, Facturada).
const unaSchema = z
  .object(cambiosSchema)
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Di qué cambiar.' });
router.put('/:clave', ...revisar, validate(unaSchema), async (req, res, next) => {
  try {
    res.json({ data: await model.actualizar(req.params.clave, req.body, req.auth.sub), error: null });
  } catch (err) { next(err); }
});

// Marcar VARIAS de una vez: Procesadas y/o Facturadas.
const variasSchema = z
  .object({
    claves: z.array(z.string().regex(/^(pago|abono|anticipo)-\d+$/)).min(1).max(500),
    estado: cambiosSchema.estado,
    facturada: cambiosSchema.facturada,
  })
  .strict()
  .refine((b) => b.estado !== undefined || b.facturada !== undefined, {
    message: 'Di qué marcar: Procesadas o Facturadas.',
  });
router.post('/marcar', ...revisar, validate(variasSchema), async (req, res, next) => {
  try {
    const { claves, ...cambios } = req.body;
    res.json({ data: await model.marcarVarias(claves, cambios, req.auth.sub), error: null });
  } catch (err) { next(err); }
});

module.exports = router;
