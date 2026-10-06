'use strict';

// Las cuentas de banco para transferencias (2026-10-06): reglas sin base, para
// probarlas solas (cuentas.test.js).
//
// Una CLABE son 18 dígitos y el último es de control: se calcula con los otros
// 17 (pesos 3, 7, 1 repetidos; cada producto módulo 10; el dígito es lo que le
// falta a la suma para llegar a la siguiente decena). Revisarlo atrapa el error
// más común —un dígito mal tecleado— antes de que un cliente deposite a una
// cuenta que no existe.

const { AppError } = require('../../middlewares/error');

/** Solo los dígitos de lo que se tecleó ("012 180 …" → "012180…"); null si no queda nada. */
function soloDigitos(v) {
  const d = String(v ?? '').replace(/[\s-]/g, '');
  return d === '' ? null : d;
}

/** El dígito de control que le toca a los primeros 17 dígitos de una CLABE. */
function digitoControlClabe(primeros17) {
  const pesos = [3, 7, 1];
  const suma = [...primeros17].reduce((s, c, i) => s + ((Number(c) * pesos[i % 3]) % 10), 0);
  return (10 - (suma % 10)) % 10;
}

function clabeValida(clabe) {
  return /^\d{18}$/.test(clabe) && digitoControlClabe(clabe.slice(0, 17)) === Number(clabe[17]);
}

/**
 * Revisa y limpia una cuenta. Pide el banco y al menos un dato para depositar
 * (número de cuenta o CLABE); los números se guardan sin espacios.
 */
function normalizar(datos) {
  const banco = String(datos.banco ?? '').trim();
  if (banco.length < 2) {
    throw new AppError(422, 'FALTA_BANCO', 'Escribe el nombre del banco.');
  }
  const numero = soloDigitos(datos.numero_cuenta);
  const clabe = soloDigitos(datos.clabe);
  if (!numero && !clabe) {
    throw new AppError(422, 'FALTA_CUENTA',
      'Escribe el número de cuenta o la CLABE: sin ninguno de los dos no se puede depositar.');
  }
  if (numero && !/^\d{4,20}$/.test(numero)) {
    throw new AppError(422, 'NUMERO_CUENTA_INVALIDO', 'El número de cuenta lleva solo dígitos (de 4 a 20).');
  }
  if (clabe && !/^\d{18}$/.test(clabe)) {
    throw new AppError(422, 'CLABE_INVALIDA',
      `La CLABE lleva 18 dígitos y escribiste ${clabe.replace(/\D/g, '').length}.`);
  }
  if (clabe && !clabeValida(clabe)) {
    throw new AppError(422, 'CLABE_INVALIDA',
      'Esa CLABE no es válida: su último dígito no cuadra con los demás. Revisa que esté bien copiada.');
  }
  return {
    banco,
    titular: String(datos.titular ?? '').trim() || null,
    numero_cuenta: numero,
    clabe,
    activa: datos.activa === undefined ? true : !!datos.activa,
  };
}

module.exports = { soloDigitos, digitoControlClabe, clabeValida, normalizar };
