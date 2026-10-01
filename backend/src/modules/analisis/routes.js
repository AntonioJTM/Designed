'use strict';

const { Router } = require('express');
const controller = require('./controller');
const { authRequired, requireTipo, requireRol } = require('../../middlewares/auth');

const router = Router();

// El tablero muestra saldos de clientes, costos y márgenes: es información
// sensible del negocio. Los costos y el margen, solo administradores y
// gerentes; la cobranza y los clientes enfriados los necesita quien atiende.
const soloStaff = [authRequired, requireTipo('usuario')];
const soloJefes = [authRequired, requireTipo('usuario'), requireRol('administrador', 'gerente')];

router.get('/cobranza', ...soloStaff, controller.cobranza);
router.get('/clientes-enfriados', ...soloStaff, controller.clientesEnfriados);
router.get('/hilo-muerto', ...soloJefes, controller.hiloMuerto);
router.get('/margen', ...soloJefes, controller.margen);
// Todo junto, de un viaje. Requiere ser jefe porque incluye costos y margen.
router.get('/tablero', ...soloJefes, controller.tablero);

module.exports = router;
