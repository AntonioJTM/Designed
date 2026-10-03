'use strict';

const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requirePermiso, requirePermisoAlguno } = require('../../middlewares/auth');

const router = Router();
const soloStaff = [authRequired, requireTipo('usuario')];

const bultoSchema = z
  .object({
    codigo: z.string().trim().min(1).max(60),
    peso_kg: z.coerce.number().positive().max(100000),
    lote: z.string().trim().max(40).nullable().optional(),
    conos: z.coerce.number().int().positive().max(10000).nullable().optional(),
    // La vista previa devuelve el renglón del Excel; se acepta y se ignora.
    fila: z.coerce.number().int().optional(),
  })
  .strict();

// Se manda `producto_id` (la pantalla del producto: crea la presentación si le
// falta) o `variante_id` (la presentación exacta). Uno de los dos.
const confirmarSchema = z
  .object({
    producto_id: z.coerce.number().int().positive().optional(),
    variante_id: z.coerce.number().int().positive().optional(),
    almacen_id: z.coerce.number().int().positive(),
    archivo: z.string().trim().max(255).nullable().optional(),
    // A cómo salió el KILO en esta compra. Con esto se recalcula el costo
    // promedio del hilo y se puede ver el margen. Opcional: sin él la remesa
    // entra igual, solo que ese margen no se podrá calcular.
    costo_kg: z.coerce.number().nonnegative().max(9999999).nullable().optional(),
    notas: z.string().trim().max(1000).optional(),
    bultos: z.array(bultoSchema).min(1).max(5000),
  })
  .strict()
  .refine((d) => d.producto_id || d.variante_id, {
    message: 'Indica producto_id o variante_id',
  });

// La LISTA COMPLETA del proveedor: varios hilos en un archivo (ver lista.js).
// Cada hilo trae su nombre y calibre tal cual el Excel; el servidor vuelve a
// empatarlos contra el catálogo al confirmar, no confía en la vista previa.
const listaSchema = z
  .object({
    almacen_id: z.coerce.number().int().positive(),
    archivo: z.string().trim().max(255).nullable().optional(),
    notas: z.string().trim().max(1000).optional(),
    // Material y línea de los hilos que se van a CREAR. El material solo se
    // exige si hay hilos nuevos (lo valida el modelo).
    categoria_id: z.coerce.number().int().positive().nullable().optional(),
    linea_id: z.coerce.number().int().positive().nullable().optional(),
    documento: z
      .object({
        proveedor: z.string().trim().max(120).nullable().optional(),
        numero: z.string().trim().max(60).nullable().optional(),
        fecha: z.string().trim().max(30).nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    hilos: z
      .array(
        z
          .object({
            nombre: z.string().trim().min(1).max(160),
            calibre: z.string().trim().min(1).max(30),
            costo_kg: z.coerce.number().nonnegative().max(9999999).nullable().optional(),
            bultos: z.array(bultoSchema).min(1).max(5000),
          })
          .strict()
      )
      .min(1)
      .max(200),
  })
  .strict()
  .refine((d) => d.hilos.reduce((s, h) => s + h.bultos.length, 0) <= 5000, {
    message: 'Una lista admite hasta 5,000 bultos',
  });

// La vista previa recibe el .xlsx en crudo. Se acepta cualquier binario para no
// depender de que el navegador mande el content-type exacto.
const cuerpoBinario = express.raw({ type: () => true, limit: '15mb' });

router.get('/', ...soloStaff, controller.listar);

// Reportes en PDF de las entradas (ver reportes.js). Se piden desde Recibir
// remesa, desde las presentaciones del producto y desde Inventario.
const veReportes = requirePermisoAlguno('ver:remesa', 'ver:catalogo', 'ver:inventario');
router.get('/producto/:productoId/pdf', ...soloStaff, veReportes, controller.pdfProducto);
router.get('/:id/pdf', ...soloStaff, veReportes, controller.pdfCarga);
// Varias cargas en un solo PDF (?ids=1,2,3): las de una lista completa.
router.get('/pdf', ...soloStaff, veReportes, controller.pdfCargas);
router.post('/previa', ...soloStaff, requirePermiso('ver:remesa'), cuerpoBinario, controller.previa);
router.post('/', ...soloStaff, requirePermiso('ver:remesa'), validate(confirmarSchema), controller.confirmar);
router.post('/lista/previa', ...soloStaff, requirePermiso('ver:remesa'), cuerpoBinario, controller.previaLista);
router.post('/lista', ...soloStaff, requirePermiso('ver:remesa'), validate(listaSchema), controller.confirmarLista);

module.exports = router;
