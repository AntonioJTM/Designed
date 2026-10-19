'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

// LO QUE UNA PETICIÓN TOCÓ POR DENTRO (2026-10-19, revisión de tiendas del aviso
// en vivo). La ruta dice la tienda de la petición, pero hay cambios que caen en
// OTRA de rebote: un abono en Tienda Principal liquida una venta a crédito de
// Moroleón, al surtir se trae un paquete que el sistema tenía en una tercera
// tienda. Quien escribe el kardex, el crédito y el saldo a favor lo anota aquí y
// el aviso lo suma (`bus.js`).
//   · `almacenes`: las tiendas cuyo inventario se movió.
//   · `compartidos`: los tipos que ven TODAS las tiendas y que sí cambiaron —la
//     deuda total y el saldo a favor del cliente ("clientes"), un hilo o una
//     presentación nueva ("catalogo")—. Esos le llegan a todos: no delatan nada
//     que no se vea ya al recargar.
// Fuera de una petición (el WhatsApp, un script) no hay contexto y no se anota.

const contexto = new AsyncLocalStorage();

/** Corre la petición con su libreta de anotaciones. */
function conAnotaciones(fn) {
  const notas = { almacenes: new Set(), compartidos: new Set() };
  contexto.run(notas, fn);
  return notas;
}

/** Se movió el inventario de esa tienda. */
function anotarAlmacen(id) {
  const notas = contexto.getStore();
  const n = Number(id);
  if (notas && Number.isInteger(n) && n > 0) notas.almacenes.add(n);
}

/** Cambió algo que ven todas las tiendas ('clientes' o 'catalogo'). */
function anotarCompartido(tipo) {
  const notas = contexto.getStore();
  if (notas) notas.compartidos.add(tipo);
}

module.exports = { conAnotaciones, anotarAlmacen, anotarCompartido };
