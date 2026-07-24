'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Firma un JWT. El payload identifica al sujeto y su tipo:
 *   { sub: <id>, tipo: 'usuario' | 'cliente', rol_id?, rol? }
 */
function firmarToken(payload) {
  return jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
}

/** Verifica y decodifica un JWT; lanza si es inválido o expiró. */
function verificarToken(token) {
  return jwt.verify(token, env.jwt.secret);
}

module.exports = { firmarToken, verificarToken };
