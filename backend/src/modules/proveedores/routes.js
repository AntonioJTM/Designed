'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requirePermiso, requirePermisoAlguno } = require('../../middlewares/auth');

const router = Router();

const crearSchema = z
  .object({
    nombre: z.string().trim().min(1).max(160),
    contacto: z.string().trim().max(120).optional(),
    telefono: z.string().trim().max(20).optional(),
    correo: z.string().trim().max(160).optional(),
    rfc_id_fiscal: z.string().trim().max(30).optional(),
  })
  .strict();

const soloStaff = [authRequired, requireTipo('usuario')];

// La lista la ve quien surte inventario o lee sus reportes; dar de alta uno es
// parte de surtir (se crea al vuelo desde la carga).
router.get('/', ...soloStaff, requirePermisoAlguno('ver:remesa', 'ver:catalogo', 'ver:inventario', 'ver:reportes'), controller.listar);
router.post('/', ...soloStaff, requirePermiso('ver:remesa'), validate(crearSchema), controller.crear);

module.exports = router;
