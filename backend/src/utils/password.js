'use strict';

const bcrypt = require('bcrypt');
const env = require('../config/env');

/** Genera el hash bcrypt de una contraseña en texto plano. */
function hashPassword(plano) {
  return bcrypt.hash(plano, env.bcryptRounds);
}

/** Compara una contraseña en texto plano contra su hash almacenado. */
function verificarPassword(plano, hash) {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(plano, hash);
}

module.exports = { hashPassword, verificarPassword };
