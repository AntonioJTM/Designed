'use strict';

const { Router } = require('express');
const controller = require('./controller');
const { authRequired, requireTipo, requirePermiso } = require('../../middlewares/auth');

const router = Router();

// El tablero muestra saldos de clientes, costos y márgenes: es información
// sensible del negocio, solo para administradores y gerentes.
// Lo ve quien tenga "Cómo va el negocio" en Permisos (antes: administrador y gerente).
const soloJefes = [authRequired, requireTipo('usuario'), requirePermiso('ver:negocio')];

// Las cuatro preguntas de un viaje: cobranza, clientes enfriados, hilo muerto y
// margen. Tenían una ruta cada una, pero la pantalla siempre pide las cuatro y
// el asistente lee los models directo, así que nadie las usaba sueltas.
router.get('/tablero', ...soloJefes, controller.tablero);

module.exports = router;
