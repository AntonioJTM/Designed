'use strict';

const express = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { validate } = require('../../middlewares/validate');
const { authRequired, requireTipo, requirePermiso, requireTodasLasTiendas } = require('../../middlewares/auth');

const router = express.Router();

// ROTACIÓN DE INVENTARIO (2026-10-22): junta todas las tiendas, así que la ve
// quien tiene la pantalla y ve TODAS las tiendas (como Reportes). Solo kilos.
router.use(authRequired, requireTipo('usuario'), requirePermiso('ver:rotacion'), requireTodasLasTiendas);

router.get('/resumen', controller.resumen); // ?almacen_id=&producto_id=
router.get('/temporadas', controller.temporadas); // ?almacen_id=&anio=AAAA|promedio
// Sin :productoId abre el que más se vende.
router.get('/hilo', controller.hilo);
router.get('/hilo/:productoId', controller.hilo);
router.get('/que-pedir', controller.quePedir);
router.get('/que-pedir.csv', controller.quePedirCsv); // ?hilos=1,2,3

// Los tiempos del proveedor y del pedido. Al guardarlos quedan confirmados.
const ajustesSchema = z
  .object({
    semanas_proveedor: z.coerce.number().int().min(1).max(52),
    semanas_colchon: z.coerce.number().int().min(0).max(12),
    meses_cubre: z.coerce.number().int().min(1).max(12),
    kg_contenedor: z.coerce.number().positive().max(10000000).nullable().optional(),
  })
  .strict();
router.get('/ajustes', controller.ajustes);
// Cambiarlos mueve el «Qué pedir» de toda la empresa: lleva su permiso (revisor de tiendas, 2026-10-22).
router.put('/ajustes', requirePermiso('hacer:ajustes_rotacion'), validate(ajustesSchema), controller.guardarAjustes);

// VENTAS DE AÑOS ANTERIORES (parte 2): el Excel llega en crudo.
const cuerpoBinario = express.raw({ type: () => true, limit: '15mb' });
const cargaAnteriores = requirePermiso('hacer:cargar_ventas_anteriores');
router.get('/ventas-anteriores', controller.anterioresResumen);
router.post('/ventas-anteriores/previa', cargaAnteriores, cuerpoBinario, controller.anterioresPrevia);
router.post('/ventas-anteriores', cargaAnteriores, cuerpoBinario, controller.anterioresCargar);
router.delete('/ventas-anteriores', cargaAnteriores, controller.anterioresBorrar);

module.exports = router;
