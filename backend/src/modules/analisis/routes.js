'use strict';

const { Router } = require('express');
const controller = require('./controller');
const { authRequired, requireTipo, requirePermiso, requireTodasLasTiendas } = require('../../middlewares/auth');

const router = Router();

// El tablero muestra saldos de clientes, costos y márgenes: es información
// sensible del negocio, solo para administradores y gerentes.
// Lo ve quien tenga "Cómo va el negocio" en Permisos (antes: administrador y gerente).
// Suma todas las tiendas: solo quien las ve todas (2026-10-15).
const soloJefes = [authRequired, requireTipo('usuario'), requirePermiso('ver:negocio'), requireTodasLasTiendas];

// Las cuatro preguntas de un viaje: cobranza, clientes enfriados, hilo muerto y
// margen. Tenían una ruta cada una, pero la pantalla siempre pide las cuatro,
// así que nadie las usaba sueltas.
router.get('/tablero', ...soloJefes, controller.tablero);

module.exports = router;
